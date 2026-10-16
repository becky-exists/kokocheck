import { env } from './env.js';
import { localizeDirectionComments } from '../shared/directions.js';
import { errorMessages, errorMessageFor, type ErrorCode } from '../shared/errors.js';
import { negotiateLocale } from '../shared/locale.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { Store, HttpError, check } from './store.js';
import { id, now, equal, limits, newProject, publicProject, commentSchema, addComment, submitRequest, claimRequest, activeLease, releaseRequest, unsentRequest, cancelUnsentRequest, publishSchema, publishVersion, validateTime } from './domain.js';
import { importVideo, snapshot, discardVersion } from './media.js';
import { plainSnapshotName } from '../shared/frame.js';
import { maxUpload, token } from './config.js';
import type { Project, Version, RequestNotification } from '../shared/types.js';
import { loadNotifyConfig, notificationMessage, queueNotification } from './notify.js';
import { loadClaudeConfig, notifyClaude } from './claude-notify.js';
import { sweepOld } from './housekeeping.js';

// localSession: whether POST /api/local-session may hand the operator a session. Unset means: only when the public URL is loopback
// or KOKOCHECK_ALLOW_LOCAL_SESSION=1 (formerly FR_ALLOW_LOCAL_SESSION) says so explicitly.
type Options = { dataDir: string; publicUrl: string; adminToken: string; localSession?: boolean };
type Role = 'viewer' | 'moderator' | 'super_admin';
const SESSION_MS = 8 * 3600_000, MAX_SESSIONS = 50;
const loopbackNames = new Set(['localhost', '127.0.0.1', '[::1]']);
// Host headers are compared as URLs so that `[::1]:4391`, case and default ports behave the same everywhere.
function parseHost(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(`http://${value}`);
    return url.username || url.password || url.search || url.hash || url.pathname !== '/' ? null : { hostname: url.hostname, host: url.host };
  } catch { return null; }
}
const isLoopbackHost = (value: string | undefined) => loopbackNames.has(parseHost(value)?.hostname ?? '');
const normalizedOrigin = (value: string) => { try { return new URL(value).origin; } catch { return null; } };
const param = (req: Request, name: string) => String(req.params[name]);
export function createApp(options: Options) {
  // Configuration is read on every use so adding a review never needs a restart. A broken file stops the request, not the server.
  function destination(projectId: string) {
    let codexConfig: ReturnType<typeof loadNotifyConfig>, claudeConfig: ReturnType<typeof loadClaudeConfig>;
    try { codexConfig = loadNotifyConfig(options.dataDir); claudeConfig = loadClaudeConfig(options.dataDir); }
    catch { throw new HttpError(500, 'notification_config'); }
    const codex = codexConfig?.bindings[projectId], claude = claudeConfig?.bindings[projectId];
    check(!(codex && claude), 409, 'notification_ambiguous');
    return { codexConfig, codex, claude, provider: claude ? 'claude' as const : codex ? 'codex' as const : null, testOnly: (claude ?? codex)?.testOnly };
  }
  const configCheck = () => { const codex = loadNotifyConfig(options.dataDir), claude = loadClaudeConfig(options.dataDir);
    for (const projectId of Object.keys(claude?.bindings ?? {})) if (codex?.bindings[projectId]) throw new Error("A review cannot notify both Codex and Claude. Choose one destination."); };
  configCheck();
  const localSession = options.localSession ?? (loopbackNames.has(new URL(options.publicUrl).hostname) || env('ALLOW_LOCAL_SESSION') === '1');
  const app = express();
  app.disable('x-powered-by');
  const mediaDir = join(options.dataDir, 'media');
  const tempDir = join(options.dataDir, 'incoming');
  mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  // Leftovers from a crashed upload, and job folders the runner used to keep inside the data directory.
  sweepOld(tempDir, 3600_000); sweepOld(join(options.dataDir, 'jobs'), 7 * 86400_000);
  const store = new Store(join(options.dataDir, 'reviews.sqlite'));
  // A crash after queue acceptance may precede saving its receipt. Never resend on restart.
  const interrupted = store.db.prepare("SELECT DISTINCT projects.id FROM projects, json_each(projects.data, '$.requests') r WHERE json_extract(r.value, '$.notification.state') = 'sending'").all();
  for (const row of interrupted) store.mutate(String(row.id), p => {
    for (const r of p.requests) if (r.notification?.state === 'sending') r.notification = { ...r.notification, state: 'uncertain', updatedAt: now() };
  });
  const sessions = new Map<string, number>();
  const origin = new URL(options.publicUrl).origin;
  const originHost = new URL(options.publicUrl).host;
  const upload = multer({ dest: tempDir, limits: { fileSize: maxUpload, files: 1, fields: 8, fieldSize: 100_000 }, fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.mp4')) cb(new HttpError(400, 'mp4_required'));
    else cb(null, true);
  } });
  app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.vary('Accept-Language');
    // Explicit host/origin checks protect loopback services from browser DNS rebinding and CSRF.
    if (!isLoopbackHost(req.headers.host) && parseHost(req.headers.host)?.host !== originHost) return next(new HttpError(403, 'host_forbidden'));
    if (req.headers.origin && normalizedOrigin(req.headers.origin) !== origin) return next(new HttpError(403, 'origin_forbidden'));
    if (req.headers['sec-fetch-site'] === 'cross-site') return next(new HttpError(403, 'origin_forbidden'));
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  function isAdmin(req: Request) {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (equal(bearer, options.adminToken)) return true;
    const cookie = req.headers.cookie?.split(';').map(c => c.trim()).map(c => c.match(/^(?:kokocheck_session|frame_session)=(.*)$/)?.[1]).find(Boolean) ?? '';
    const until = sessions.get(cookie);
    if (!until) return false;
    if (until < Date.now()) { sessions.delete(cookie); return false; }
    return true;
  }
  function requireAuth(minimumRole: Role) {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const admin = isAdmin(req);
        if (req.params.id) {
          const p = store.get(param(req, 'id'));
          const key = req.headers['x-review-token'] ?? req.query.key;
          check(admin || (typeof key === 'string' && equal(key, p.reviewToken)), 403, 'review_access');
          res.locals.project = p;
        } else check(admin, 401, 'admin_login');
        if (minimumRole === 'super_admin') check(admin, 403, 'admin_required');
        res.locals.admin = admin; next();
      } catch (e) { next(e); }
    };
  }
  function startSession(res: Response) {
    const nowMs = Date.now();
    for (const [key, until] of sessions) if (until < nowMs) sessions.delete(key);
    while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
    const key = token(); sessions.set(key, nowMs + SESSION_MS);
    res.cookie('kokocheck_session', key, { httpOnly: true, sameSite: 'strict', secure: origin.startsWith('https:'), maxAge: SESSION_MS });
  }
  const reviewUrl = (p: Project) => `${options.publicUrl}/r/${p.id}#key=${p.reviewToken}`;
  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));
  app.post('/api/local-session', (req, res) => {
    // Closed unless the public URL is loopback or KOKOCHECK_ALLOW_LOCAL_SESSION=1 (formerly FR_ALLOW_LOCAL_SESSION): behind a same-machine proxy every visitor looks local.
    check(localSession, 403, 'local_session_disabled');
    const address = req.socket.remoteAddress;
    const local = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    check(local && isLoopbackHost(req.headers.host) && !req.headers.forwarded && !req.headers['x-forwarded-for'], 403, 'local_only');
    startSession(res);
    res.json({ ok: true });
  });
  app.post('/api/login', (req, res) => {
    const key = z.object({ token: z.string().max(200) }).parse(req.body).token;
    check(equal(key, options.adminToken), 401, 'invalid_admin_key');
    startSession(res);
    res.json({ ok: true });
  });
  app.get('/api/projects', requireAuth('super_admin'), (req, res) => {
    const { limit, offset } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    const { projects, total } = store.list(limit, offset);
    res.json({ total, hasMore: offset + limit < total, projects: projects.map(p => ({ id: p.id, title: p.title, mode: p.mode, createdAt: p.createdAt, updatedAt: p.updatedAt, reviewUrl: reviewUrl(p), latest: p.versions.at(-1), comments: p.comments.length, pending: p.comments.filter(c => !['accepted','superseded'].includes(c.status)).length })) });
  });
  app.post('/api/projects', requireAuth('super_admin'), upload.single('video'), async (req, res) => {
    let version: Version | undefined;
    try {
      const input = z.object({ title: z.string().trim().min(1).max(120), mode: z.enum(['source', 'mp4']).default('mp4'), sourceRef: z.string().trim().max(2000).optional() }).strict().parse(req.body);
      check(req.file, 400, 'video_required');
      check(input.mode !== 'source' || input.sourceRef, 400, 'source_required');
      version = await importVideo(req.file.path, mediaDir);
      const p = store.create(newProject(input.title, input.mode, input.sourceRef || null, version));
      res.status(201).json({ project: publicProject(p, false, negotiateLocale(req.headers['accept-language'])), reviewUrl: reviewUrl(p) });
    } catch (e) { await discardVersion(mediaDir, version); throw e; }
    finally { if (req.file) await unlink(req.file.path).catch(() => {}); }
  });
  app.get('/api/projects/:id', requireAuth('viewer'), (_req, res) => {
    const p = res.locals.project as Project;
    // A broken settings file must not make the review unreadable.
    let dest: ReturnType<typeof destination> | null = null;
    try { dest = destination(p.id); } catch (e) { console.error('Notification settings unavailable:', e instanceof Error ? e.name : 'UnknownError'); }
    res.json({ ...publicProject(p, res.locals.admin === true, negotiateLocale(_req.headers['accept-language'])), ...(dest?.provider ? { chatNotification: { provider: dest.provider, testOnly: dest.testOnly! } } : {}) });
  });
  app.get('/api/projects/:id/media/:file', requireAuth('viewer'), (req, res) => {
    const p = res.locals.project as Project;
    const file = param(req, 'file');
    check(p.versions.some(v => v.file === file || v.poster === file) || p.comments.some(c => c.snapshot === file || (c.pin && plainSnapshotName(c.snapshot) === file)), 404, 'file_not_found');
    res.sendFile(file, { root: mediaDir, acceptRanges: true, cacheControl: false });
  });
  app.post('/api/projects/:id/comments', requireAuth('moderator'), async (req, res) => {
    const input = commentSchema.parse(req.body);
    const p = store.get(param(req, 'id'));
    // Cheap early refusal before FFmpeg runs. The exclusive check is inside addComment.
    check(p.comments.length < limits.comments, 400, 'comment_limit');
    const version = p.versions.find(v => v.id === input.versionId);
    check(version, 404, 'version_not_found');
    validateTime(version, input.start, input.end);
    const image = await snapshot(mediaDir, version.file, input.start, input.pin);
    // 画面用に、十字を焼かない同じコマを並べて作る。無くても保存は進める（画面は十字入りの画像に戻る）。
    const plain = input.pin ? await snapshot(mediaDir, version.file, input.start, null, plainSnapshotName(image)).catch(() => null) : null;
    try { res.status(201).json(store.mutate(p.id, project => addComment(project, input, image))); }
    catch (e) { await Promise.all([image, plain].map(file => file && unlink(join(mediaDir, file)).catch(() => {}))); throw e; }
  });
  app.patch('/api/projects/:id/comments/:commentId', requireAuth('moderator'), (req, res) => {
    const input = z.object({ text: z.string().trim().min(1).max(4000).optional(), status: z.literal('accepted').optional() }).strict().refine(v => (v.text !== undefined) !== (v.status !== undefined)).parse(req.body);
    res.json(store.mutate(param(req, 'id'), p => {
      const c = p.comments.find(c => c.id === param(req, 'commentId'));
      check(c, 404, 'comment_not_found');
      if (input.text !== undefined) { check(c.status === 'draft', 409, 'comment_frozen'); c.text = input.text; }
      if (input.status) { check(c.status === 'addressed', 409, 'accept_reported_only'); c.status = 'accepted'; }
      return c;
    }));
  });
  app.post('/api/projects/:id/comments/:commentId/replies', requireAuth('moderator'), (req, res) => {
    const input = z.object({ text: z.string().trim().min(1).max(limits.replyText), author: z.string().trim().min(1).max(60).default('レビュー担当') }).strict().parse(req.body);
    res.json(store.mutate(param(req, 'id'), p => {
      const c = p.comments.find(c => c.id === param(req, 'commentId'));
      check(c, 404, 'comment_not_found');
      check(c.replies.length < limits.repliesPerComment && p.comments.reduce((n, x) => n + x.replies.length, 0) < limits.repliesPerReview, 400, 'reply_limit');
      const reply = { ...input, id: id(), createdAt: now() }; c.replies.push(reply); return reply;
    }));
  });
  app.post('/api/projects/:id/requests', requireAuth('moderator'), async (req, res) => {
    const input = z.object({ versionId: z.string().uuid(), commentIds: z.array(z.string().uuid()).min(1).max(100), target: z.enum(['codex','claude','any']).default('any') }).strict().parse(req.body);
    const projectId = param(req, 'id');
    const dest = destination(projectId);
    check(!dest.provider || input.target === 'any' || input.target === dest.provider, 409, 'chat_connected');
    const r = store.mutate(projectId, p => {
      const request = submitRequest(p, input.versionId, input.commentIds, dest.provider ?? input.target);
      if (dest.provider) request.notification = { state: 'sending', provider: dest.provider, updatedAt: now() };
      return request;
    });
    // The saved request is the durable deduplication boundary, even if HTTP disconnects.
    if (dest.provider) r.notification = await deliver(projectId, r.id, dest);
    res.status(201).json({ id: r.id, status: r.status, notification: r.notification });
  });
  async function deliver(projectId: string, requestId: string, dest: ReturnType<typeof destination>): Promise<RequestNotification> {
    const notification: RequestNotification = dest.claude
      ? await notifyClaude(dest.claude, projectId, requestId, options.publicUrl)
      : { ...await queueNotification(dest.codexConfig!, dest.codex!, notificationMessage(projectId, requestId, dest.codex!, options.publicUrl)), provider: 'codex' };
    store.mutate(projectId, p => { p.requests.find(request => request.id === requestId)!.notification = notification; });
    return notification;
  }
  // Only a notification known never to have left (failed) can be sent again. uncertain would risk a duplicate.
  app.post('/api/projects/:id/requests/:requestId/renotify', requireAuth('moderator'), async (req, res) => {
    const projectId = param(req, 'id'), requestId = param(req, 'requestId');
    const dest = destination(projectId);
    check(dest.provider, 409, 'chat_not_connected');
    store.mutate(projectId, p => {
      const r = unsentRequest(p, requestId);
      check(r.target === dest.provider, 409, 'destination_changed');
      r.notification = { state: 'sending', provider: dest.provider!, updatedAt: now() };
    });
    res.json({ id: requestId, status: 'queued', notification: await deliver(projectId, requestId, dest) });
  });
  app.post('/api/projects/:id/requests/:requestId/cancel', requireAuth('moderator'), (req, res) => {
    res.json(store.mutate(param(req, 'id'), p => cancelUnsentRequest(p, param(req, 'requestId'))));
  });
  app.get('/api/agent/requests', requireAuth('super_admin'), (req, res) => {
    const { limit, offset } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    // SQLite JSON query bounds the response without loading the whole library.
    const rows = store.db.prepare("SELECT projects.id AS projectId, json_extract(projects.data, '$.title') AS title, json_extract(projects.data, '$.mode') AS mode, json_extract(projects.data, '$.sourceRef') AS sourceRef, r.value AS request FROM projects, json_each(projects.data, '$.requests') r WHERE json_extract(r.value, '$.status') IN ('queued', 'running') ORDER BY json_extract(r.value, '$.createdAt') LIMIT ? OFFSET ?").all(limit + 1, offset);
    res.json({ hasMore: rows.length > limit, nextOffset: rows.length > limit ? offset + limit : null, requests: rows.slice(0, limit).map(row => {
      const r = JSON.parse(row.request as string) as Project['requests'][number];
      return { projectId: row.projectId, title: row.title, mode: row.mode, sourceRef: row.sourceRef, requestId: r.id, target: r.target, status: r.status, delivery: r.notification ? 'chat' : 'agent', leaseExpired: r.status === 'running' && (r.leaseUntil ?? 0) < Date.now(), commentCount: r.comments.length };
    }) });
  });
  app.post('/api/agent/projects/:id/requests/:requestId/claim', requireAuth('super_admin'), (req, res) => {
    const { worker, agent } = z.object({ worker: z.string().trim().min(1).max(100), agent: z.enum(['codex','claude']) }).strict().parse(req.body);
    const dest = destination(param(req, 'id'));
    const lang = (agent === 'claude' ? dest.claude : dest.codex)?.lang ?? 'en';
    const request = store.mutate(param(req, 'id'), p => claimRequest(p, param(req, 'requestId'), worker, agent));
    request.comments = localizeDirectionComments(request.comments, lang);
    const p = store.get(param(req, 'id'));
    res.json({ projectId: p.id, title: p.title, mode: p.mode, sourceRef: p.sourceRef, request, version: p.versions.find(v => v.id === request.versionId), reviewUrl: reviewUrl(p), mediaBaseUrl: `${options.publicUrl}/api/projects/${p.id}/media/` });
  });
  app.post('/api/agent/projects/:id/requests/:requestId/heartbeat', requireAuth('super_admin'), (req, res) => {
    const { leaseToken } = z.object({ leaseToken: z.string().min(32) }).strict().parse(req.body);
    res.json(store.mutate(param(req, 'id'), p => { const r = activeLease(p, param(req, 'requestId'), leaseToken); r.leaseUntil = Date.now() + 120_000; return { leaseUntil: r.leaseUntil }; }));
  });
  app.post('/api/agent/projects/:id/requests/:requestId/fail', requireAuth('super_admin'), (req, res) => {
    const { leaseToken, reason } = z.object({ leaseToken: z.string().min(32), reason: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    res.json(store.mutate(param(req, 'id'), p => { const r = activeLease(p, param(req, 'requestId'), leaseToken); r.status = 'failed'; r.failure = reason; r.leaseToken = null; r.leaseUntil = null; return { status: r.status }; }));
  });
  app.post('/api/agent/projects/:id/requests/:requestId/release', requireAuth('super_admin'), (req, res) => {
    const { leaseToken } = z.object({ leaseToken: z.string().min(32) }).strict().parse(req.body);
    res.json(store.mutate(param(req, 'id'), p => releaseRequest(p, param(req, 'requestId'), leaseToken)));
  });
  // Re-opening failed work is an operator decision: a review link alone must not restart edits.
  app.post('/api/projects/:id/requests/:requestId/requeue', requireAuth('super_admin'), (req, res) => {
    res.json(store.mutate(param(req, 'id'), p => {
      const r = p.requests.find(r => r.id === param(req, 'requestId'));
      check(r && (r.status === 'failed' || (r.status === 'running' && (r.leaseUntil ?? 0) < Date.now())), 409, 'requeue_conflict');
      check(p.versions.at(-1)!.id === r.versionId && !p.requests.some(other => other.id !== r.id && (other.status === 'queued' || other.status === 'running')), 409, 'other_work_active');
      r.status = 'queued'; r.leaseToken = null; r.leaseUntil = null; r.claimedBy = null; r.failure = null;
      return { status: r.status };
    }));
  });
  app.post('/api/agent/projects/:id/versions', requireAuth('super_admin'), upload.single('video'), async (req, res) => {
    let version: Version | undefined;
    try {
      const input = publishSchema.parse(JSON.parse(z.string().max(100_000).parse(req.body.manifest)));
      check(req.file, 400, 'revision_required');
      activeLease(store.get(param(req, 'id')), input.requestId, input.leaseToken);
      version = await importVideo(req.file.path, mediaDir);
      const result = store.mutate(param(req, 'id'), p => publishVersion(p, input, version!));
      res.status(201).json({ version: result, reviewUrl: reviewUrl(store.get(param(req, 'id'))) });
    } catch (e) { await discardVersion(mediaDir, version); throw e; }
    finally { if (req.file) await unlink(req.file.path).catch(() => {}); }
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'api_not_found')));
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (req.file) void unlink(req.file.path).catch(() => {});
    const lang = negotiateLocale(req.headers['accept-language']);
    const send = (status: number, code: ErrorCode, details?: string[]) => res.status(status).json({ code, error: errorMessages[code][lang], ...(details ? { details } : {}) });
    if (error instanceof HttpError) send(error.status, error.code);
    else if (error instanceof z.ZodError) send(400, 'invalid_input', error.issues.map(i => `${i.path.join('.')}: ${errorMessageFor(i.message, lang) ?? errorMessages.invalid_input[lang]}`));
    else if (error instanceof multer.MulterError) send(400, error.code === 'LIMIT_FILE_SIZE' ? 'upload_size' : 'upload_format');
    else if (error instanceof SyntaxError) send(400, 'invalid_json');
    else { console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError'); send(500, 'internal_error'); }
  });
  return { app, store };
}
