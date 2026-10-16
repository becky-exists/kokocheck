import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp } from '../server/app.js';
import { newProject, addComment, submitRequest, claimRequest, publishVersion, releaseRequest, cancelUnsentRequest, activeLease, publicProject, commentSchema, limits, id, now } from '../server/domain.js';
import { allowedExisting, allowedNew } from '../server/allowed-paths.js';
import { sweepOld } from '../server/housekeeping.js';
import type { Version } from '../shared/types.js';

const exec = promisify(execFile);
const admin = 'hardening-' + 'a'.repeat(48);
const version = (duration = 12): Version => ({ id: id(), number: 1, duration, width: 1280, height: 720, hasAudio: true, size: 100, file: `${id()}.mp4`, poster: `${id()}.jpg`, createdAt: now(), summary: 'Original', requestId: null, changes: [] });
function setup(duration = 12, start = 2, end: number | null = 4) {
  const p = newProject('Test', 'source', 'fixture.ts', version(duration));
  const c = addComment(p, { versionId: p.versions[0].id, text: 'Move this title', author: 'Reviewer', start, end, pin: null, followupOf: null }, 'evidence.jpg');
  return { p, c };
}
async function serve(options: { publicUrl?: string; localSession?: boolean } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'frame-hardening-'));
  const { app, store } = createApp({ dataDir, publicUrl: options.publicUrl ?? 'http://localhost:4391', adminToken: admin, ...(options.localSession === undefined ? {} : { localSession: options.localSession }) });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  return { dataDir, store, port, url: `http://127.0.0.1:${port}`, close: async () => { await new Promise<void>(r => server.close(() => r())); store.close(); } };
}
const rawGet = (port: number, path: string, headers: Record<string, string>) => new Promise<number | undefined>((done, reject) => {
  const r = httpRequest({ host: '127.0.0.1', port, path, headers }, response => { response.resume(); done(response.statusCode); }); r.on('error', reject); r.end();
});

test('a range running past the end of the video is clamped, a start past the end is refused', () => {
  // Last comment at 11.65s of a 12s video: an agent that widens by one second asks for 12.65s.
  const { p, c } = setup(12, 11.65, null);
  const r = submitRequest(p, p.versions[0].id, [c.id], 'any'); const lease = claimRequest(p, r.id, 'w', 'codex').leaseToken!;
  const manifest = { requestId: r.id, leaseToken: lease, baseVersionId: r.versionId, summary: 's', changes: [{ commentId: c.id, summary: 'x', outcome: 'addressed' as const, before: { start: 11.65, end: 12.65 }, after: { start: 11, end: 13 } }] };
  assert.throws(() => publishVersion(p, { ...manifest, changes: [{ ...manifest.changes[0], before: { start: 12.5, end: 13.5 } }] }, version()), /修正前の範囲が動画を超えています/);
  assert.throws(() => publishVersion(p, { ...manifest, changes: [{ ...manifest.changes[0], after: { start: 12.5, end: 13 } }] }, version()), /修正後の範囲/);
  publishVersion(p, manifest, version());
  assert.deepEqual(p.versions[1].changes[0].before, { start: 11.65, end: 12 }); assert.deepEqual(p.versions[1].changes[0].after, { start: 11, end: 12 });
});

test('only the holder of the lease can hand a request back, and it can be claimed again at once', () => {
  const { p, c } = setup(); const r = submitRequest(p, p.versions[0].id, [c.id], 'any');
  assert.throws(() => releaseRequest(p, r.id, 'x'.repeat(64)), /手放せる/); // not claimed yet
  const lease = claimRequest(p, r.id, 'w', 'codex').leaseToken!;
  assert.throws(() => releaseRequest(p, r.id, 'y'.repeat(64)), /手放せる/);
  assert.equal(r.status, 'running');
  assert.deepEqual(releaseRequest(p, r.id, lease), { status: 'queued' });
  assert.equal(r.leaseToken, null); assert.equal(r.claimedBy, null);
  assert.throws(() => activeLease(p, r.id, lease)); assert.throws(() => releaseRequest(p, r.id, lease));
  const next = claimRequest(p, r.id, 'w2', 'claude').leaseToken!;
  // The previous token is dead for good, even while the new lease is alive.
  assert.throws(() => releaseRequest(p, r.id, lease)); assert.equal(r.status, 'running');
  // An expired lease can still be handed back by its own holder until somebody else claims it.
  r.leaseUntil = Date.now() - 1; assert.deepEqual(releaseRequest(p, r.id, next), { status: 'queued' });
});

test('withdrawing needs a notification known to be unsent', () => {
  const { p, c } = setup(); const r = submitRequest(p, p.versions[0].id, [c.id], 'any');
  assert.throws(() => cancelUnsentRequest(p, r.id), /未送信/);
  for (const state of ['sending', 'queued', 'uncertain'] as const) { r.notification = { state, updatedAt: now() }; assert.throws(() => cancelUnsentRequest(p, r.id)); }
  r.notification = { state: 'failed', updatedAt: now() };
  assert.deepEqual(cancelUnsentRequest(p, r.id), { status: 'cancelled' });
  assert.equal(c.status, 'draft'); assert.equal(r.comments[0].text, 'Move this title');
  assert.doesNotThrow(() => submitRequest(p, p.versions[0].id, [c.id], 'any'));
});

test('reviewers see fixed failure wording and no worker name, the operator sees the real ones', () => {
  const { p, c } = setup(); const r = submitRequest(p, p.versions[0].id, [c.id], 'any'); claimRequest(p, r.id, 'worker-private-name', 'codex');
  r.status = 'failed'; r.failure = 'render failed in D:\\private\\project';
  const reviewer = JSON.stringify(publicProject(p)); assert.ok(!reviewer.includes('someone')); assert.ok(!reviewer.includes('render failed'));
  assert.equal(publicProject(p).requests[0].failure, '制作側で処理が止まりました。'); assert.equal(publicProject(p).requests[0].claimedBy, null);
  assert.equal(publicProject(p).isAdmin, false);
  assert.equal(publicProject(p, true).requests[0].failure, 'render failed in D:\\private\\project'); assert.equal(publicProject(p, true).isAdmin, true);
});

test('comment and reply counts are bounded inside the transaction', async () => {
  const { p } = setup();
  for (let i = p.comments.length; i < limits.comments; i++) addComment(p, commentSchema.parse({ versionId: p.versions[0].id, text: `n${i}`, start: 1 }), 's.jpg');
  assert.equal(p.comments.length, limits.comments);
  assert.throws(() => addComment(p, commentSchema.parse({ versionId: p.versions[0].id, text: 'one more', start: 1 }), 's.jpg'), /上限/);
  const s = await serve(); const q = setup().p; s.store.create(q);
  try {
    const headers = { 'Content-Type': 'application/json', 'X-Review-Token': q.reviewToken };
    const reply = (text: string) => fetch(`${s.url}/api/projects/${q.id}/comments/${q.comments[0].id}/replies`, { method: 'POST', headers, body: JSON.stringify({ text }) });
    assert.equal((await reply('x'.repeat(limits.replyText + 1))).status, 400);
    for (let i = 0; i < limits.repliesPerComment; i++) assert.equal((await reply(`r${i}`)).status, 200);
    assert.equal((await reply('too many')).status, 400); assert.equal(s.store.get(q.id).comments[0].replies.length, limits.repliesPerComment);
  } finally { await s.close(); }
});

test('local session is closed unless the public URL is loopback or the operator opted in', async () => {
  const openByDefault = await serve();
  const proxied = await serve({ publicUrl: 'https://review.example.com' });
  const explicit = await serve({ publicUrl: 'https://review.example.com', localSession: true });
  try {
    assert.equal((await fetch(`${openByDefault.url}/api/local-session`, { method: 'POST' })).status, 200);
    assert.equal((await rawGet(proxied.port, '/api/health', { Host: 'review.example.com' })), 200);
    const closed = await fetch(`${proxied.url}/api/local-session`, { method: 'POST' });
    assert.equal(closed.status, 403); assert.ok(!closed.headers.get('set-cookie'));
    assert.equal((await fetch(`${explicit.url}/api/local-session`, { method: 'POST' })).status, 200);
    // The admin key still works everywhere.
    assert.equal((await fetch(`${proxied.url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: admin }) })).status, 200);
  } finally { await openByDefault.close(); await proxied.close(); await explicit.close(); }
});

test('host and origin are compared as URLs, including the IPv6 loopback', async () => {
  const s = await serve();
  try {
    assert.equal(await rawGet(s.port, '/api/health', { Host: `[::1]:${s.port}` }), 200);
    assert.equal(await rawGet(s.port, '/api/health', { Host: `LOCALHOST:${s.port}` }), 200);
    assert.equal(await rawGet(s.port, '/api/health', { Host: 'localhost.evil.example' }), 403);
    assert.equal(await rawGet(s.port, '/api/health', { Host: '[::2]:4391' }), 403);
    assert.equal(await rawGet(s.port, '/api/health', { Host: 'localhost@evil.example' }), 403);
    assert.equal(await rawGet(s.port, '/api/health', { Host: '127.0.0.1', Origin: 'HTTP://LOCALHOST:4391' }), 200);
    assert.equal(await rawGet(s.port, '/api/health', { Host: '127.0.0.1', Origin: 'http://localhost:4391/' }), 200);
    assert.equal(await rawGet(s.port, '/api/health', { Host: '127.0.0.1', Origin: 'http://localhost:4392' }), 403);
    assert.equal(await rawGet(s.port, '/api/health', { Host: '127.0.0.1', Origin: 'null' }), 403);
  } finally { await s.close(); }
});

test('only the operator can reopen failed work, reviewers with a share link cannot', async () => {
  const s = await serve(); const { p, c } = setup(); s.store.create(p);
  try {
    const r = submitRequest(p, p.versions[0].id, [c.id], 'any'); r.status = 'failed'; r.failure = 'boom';
    s.store.mutate(p.id, project => { project.requests = [r]; project.comments = p.comments; });
    const asReviewer = await fetch(`${s.url}/api/projects/${p.id}/requests/${r.id}/requeue`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': p.reviewToken }, body: '{}' });
    assert.equal(asReviewer.status, 403); assert.equal(s.store.get(p.id).requests[0].status, 'failed');
    const view = await (await fetch(`${s.url}/api/projects/${p.id}`, { headers: { 'X-Review-Token': p.reviewToken, 'Accept-Language': 'ja' } })).json();
    assert.equal(view.isAdmin, false); assert.equal(view.requests[0].failure, '制作側で処理が止まりました。');
    const asAdmin = await fetch(`${s.url}/api/projects/${p.id}/requests/${r.id}/requeue`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` }, body: '{}' });
    assert.equal(asAdmin.status, 200); assert.equal(s.store.get(p.id).requests[0].status, 'queued');
    const adminView = await (await fetch(`${s.url}/api/projects/${p.id}`, { headers: { Authorization: `Bearer ${admin}` } })).json();
    assert.equal(adminView.isAdmin, true);
  } finally { await s.close(); }
});

test('operator sessions are capped and the oldest are dropped', async () => {
  const s = await serve();
  try {
    const cookies: string[] = [];
    for (let i = 0; i < 55; i++) {
      const res = await fetch(`${s.url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: admin }) });
      cookies.push((res.headers.get('set-cookie') ?? '').split(';')[0]);
    }
    assert.equal((await fetch(`${s.url}/api/projects`, { headers: { Cookie: cookies[0] } })).status, 401);
    assert.equal((await fetch(`${s.url}/api/projects`, { headers: { Cookie: cookies[54] } })).status, 200);
  } finally { await s.close(); }
});

test('startup removes stale upload leftovers and old job folders, and keeps recent ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frame-sweep-'));
  const stale = join(dir, 'incoming', 'old'), fresh = join(dir, 'incoming', 'new'), oldJob = join(dir, 'jobs', 'a'), freshJob = join(dir, 'jobs', 'b');
  for (const path of [stale, fresh]) { await mkdir(join(dir, 'incoming'), { recursive: true }); await writeFile(path, 'x'); }
  for (const path of [oldJob, freshJob]) await mkdir(path, { recursive: true });
  const old = new Date(Date.now() - 10 * 86400_000);
  await utimes(stale, old, old); await utimes(oldJob, old, old);
  const { store } = createApp({ dataDir: dir, publicUrl: 'http://localhost:4391', adminToken: admin }); store.close();
  assert.equal(existsSync(stale), false); assert.equal(existsSync(fresh), true); assert.equal(existsSync(oldJob), false); assert.equal(existsSync(freshJob), true);
  // A symlink is removed as a link and never followed.
  const outside = await mkdtemp(join(tmpdir(), 'frame-sweep-outside-')); await writeFile(join(outside, 'keep'), 'x');
  await symlink(outside, join(dir, 'incoming', 'link')); await utimes(join(dir, 'incoming', 'link'), old, old).catch(() => {});
  sweepOld(join(dir, 'incoming'), 1, Date.now() + 86400_000);
  assert.equal(existsSync(join(dir, 'incoming', 'link')), false); assert.equal(existsSync(join(outside, 'keep')), true);
});

test('MCP file paths can be limited to chosen folders, and are unrestricted when unset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'frame-paths-'));
  const allowed = join(root, 'allowed'), other = join(root, 'other');
  await mkdir(allowed); await mkdir(other); await writeFile(join(allowed, 'in.mp4'), 'x'); await writeFile(join(other, 'secret.mp4'), 'x');
  await symlink(other, join(allowed, 'escape'));
  const env = allowed;
  assert.ok(allowedExisting(join(allowed, 'in.mp4'), env).endsWith('in.mp4'));
  assert.throws(() => allowedExisting(join(other, 'secret.mp4'), env), /outside KOKOCHECK_MCP_ALLOWED_DIRS/);
  assert.throws(() => allowedExisting(join(allowed, 'escape', 'secret.mp4'), env), /outside/); // a symlink does not lead out
  assert.equal(allowedNew(join(allowed, 'out.mp4'), env).endsWith('out.mp4'), true);
  assert.throws(() => allowedNew(join(other, 'out.mp4'), env), /outside/);
  assert.throws(() => allowedNew(join(allowed, 'escape', 'out.mp4'), env), /outside/);
  assert.throws(() => allowedNew(join(allowed, '..', 'other', 'out.mp4'), env), /outside/);
  assert.ok(allowedExisting(join(other, 'secret.mp4'), '').endsWith('secret.mp4')); // unset or empty: as before
});

test('runner approval needs a terminal, and the MCP release tool hands a claimed request back', { timeout: 60_000 }, async () => {
  const s = await serve(); const { p, c } = setup(); s.store.create(p);
  try {
    // --approve without a terminal must refuse before anything is claimed.
    const refused = await exec(process.execPath, ['--import', 'tsx', 'server/runner.ts', '--agent', 'codex', '--once', '--approve', '--', process.execPath, '-e', ''], { env: { ...process.env, FR_SERVER_URL: s.url, FR_ADMIN_TOKEN: admin, FR_DATA_DIR: s.dataDir }, timeout: 10_000 }).then(() => null, e => e as { code: number; stderr: string });
    assert.equal(refused?.code, 2); assert.match(refused!.stderr, /interactive terminal/);
    // A flag that sits after `--` belongs to the adapter and is not ours.
    const passthrough = await exec(process.execPath, ['--import', 'tsx', 'server/runner.ts', '--agent', 'codex', '--once', '--', process.execPath, '-e', 'process.exit(1)', '--approve'], { env: { ...process.env, FR_SERVER_URL: s.url, FR_ADMIN_TOKEN: admin, FR_DATA_DIR: s.dataDir, FR_JOBS_DIR: join(s.dataDir, 'private-jobs') }, timeout: 10_000 });
    assert.equal(passthrough.stdout, ''); assert.equal(existsSync(join(s.dataDir, 'jobs')), false);

    s.store.mutate(p.id, project => { submitRequest(project, project.versions[0].id, [c.id], 'any'); });
    const requestId = s.store.get(p.id).requests[0].id;
    const mcp = new Client({ name: 'release-test', version: '1' });
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'server/mcp.ts'], cwd: process.cwd(), env: { ...process.env as Record<string, string>, FR_SERVER_URL: s.url, FR_ADMIN_TOKEN: admin, FR_DATA_DIR: s.dataDir }, stderr: 'pipe' }));
    try {
      assert.ok((await mcp.listTools()).tools.some(t => t.name === 'frame_release_request'));
      const claimed = JSON.parse(((await mcp.callTool({ name: 'frame_claim_request', arguments: { projectId: p.id, requestId, worker: 'w', agent: 'claude' } })).content as { text: string }[])[0].text);
      const bad = await mcp.callTool({ name: 'frame_release_request', arguments: { projectId: p.id, requestId, leaseToken: 'z'.repeat(64) } });
      assert.equal(bad.isError, true); assert.equal(s.store.get(p.id).requests[0].status, 'running');
      const ok = await mcp.callTool({ name: 'frame_release_request', arguments: { projectId: p.id, requestId, leaseToken: claimed.request.leaseToken } });
      assert.ok(!ok.isError); assert.equal(s.store.get(p.id).requests[0].status, 'queued');
      assert.ok(!(await mcp.callTool({ name: 'frame_claim_request', arguments: { projectId: p.id, requestId, worker: 'w2', agent: 'claude' } })).isError);
      // A destination outside the allowed folders is refused before any download starts.
      const restricted = new Client({ name: 'restricted', version: '1' });
      const allowedDir = await mkdtemp(join(tmpdir(), 'frame-mcp-allowed-'));
      await restricted.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'server/mcp.ts'], cwd: process.cwd(), env: { ...process.env as Record<string, string>, FR_SERVER_URL: s.url, FR_ADMIN_TOKEN: admin, FR_DATA_DIR: s.dataDir, FR_MCP_ALLOWED_DIRS: allowedDir }, stderr: 'pipe' }));
      try {
        const outside = await restricted.callTool({ name: 'frame_download_video', arguments: { projectId: p.id, file: `${id()}.mp4`, destination: join(tmpdir(), 'frame-outside.mp4') } });
        assert.equal(outside.isError, true); assert.match((outside.content as { text: string }[])[0].text, /KOKOCHECK_MCP_ALLOWED_DIRS/);
        const upload = await restricted.callTool({ name: 'frame_register_video', arguments: { videoPath: join(tmpdir(), 'whatever.mp4'), title: 't', mode: 'mp4' } });
        assert.equal(upload.isError, true);
      } finally { await restricted.close(); }
    } finally { await mcp.close(); }
  } finally { await s.close(); }
});
