import { errorMessages } from '../shared/errors.js';
import type { Locale } from '../shared/locale.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Project, Version, Comment, ReviewProject, Request as ReviewRequest } from '../shared/types.js';
import { check } from './store.js';
import { token } from './config.js';
import { isDirection, isGlobalDirection, commentInstruction, type Direction } from '../shared/directions.js';

export const now = () => new Date().toISOString();
export const equal = (a: string, b: string) => { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
// 意図的に控えめな上限。1レビューのJSONは更新のたびに丸ごと書き直すため 件数と長さを絞る。必要になったらここだけ変える。
export const limits = { comments: 500, repliesPerComment: 30, repliesPerReview: 500, replyText: 1000 };
export const id = () => randomUUID();
export const pinSchema = z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) }).strict();
export const commentSchema = z.object({
  versionId: z.string().uuid(), text: z.string().trim().min(1).max(4000),
  author: z.string().trim().min(1).max(60).default('レビュー担当'),
  start: z.number().finite().min(0), end: z.number().finite().min(0).nullable().default(null),
  direction: z.custom<Direction>(isDirection, 'invalid_direction').nullable().optional(),
  pin: pinSchema.nullable().default(null), followupOf: z.string().uuid().nullable().default(null),
  scope: z.literal('all').optional(),
}).strict().superRefine((v, ctx) => {
  // 全体向けの項目（テンポ・全体の字幕・冒頭と締めの複数指定）は scope: 'all' のコメントだけ。全体は時刻もピンも持たない。
  const bad = v.scope === 'all' ? v.start !== 0 || v.end !== null || v.pin !== null || (!!v.direction && !isGlobalDirection(v.direction)) : isGlobalDirection(v.direction);
  if (bad) ctx.addIssue({ code: 'custom', message: 'invalid_scope' });
});
export const rangeSchema = z.object({ start: z.number().finite().min(0), end: z.number().finite().min(0) }).strict()
  .refine(v => v.end >= v.start, 'invalid_range_end');
export const changeSchema = z.object({
  commentId: z.string().uuid(), summary: z.string().trim().min(1).max(2000),
  outcome: z.enum(['addressed', 'blocked']), before: rangeSchema, after: rangeSchema.nullable(),
}).strict();
export const publishSchema = z.object({
  requestId: z.string().uuid(), leaseToken: z.string().min(32), baseVersionId: z.string().uuid(),
  summary: z.string().trim().min(1).max(2000), changes: z.array(changeSchema).min(1).max(100),
}).strict();
export function newProject(title: string, mode: Project['mode'], sourceRef: string | null, version: Version): Project {
  check(mode !== 'source' || sourceRef, 400, 'source_ref_required');
  return { id: id(), title, mode, sourceRef, reviewToken: token(), createdAt: now(), updatedAt: now(), versions: [version], comments: [], requests: [] };
}
// Reviewers see fixed wording only: an agent-written failure reason may contain private paths or names.
export function publicProject(p: Project, admin = false, lang: Locale = 'ja'): ReviewProject {
  const { sourceRef: _source, reviewToken: _token, requests, ...rest } = p;
  return { ...rest, isAdmin: admin, requests: requests.map(({ leaseToken: _lease, comments: _comments, ...r }) =>
    admin ? r : { ...r, claimedBy: null, failure: r.failure ? errorMessages.producer_stopped[lang] : null }) };
}
export function validateTime(v: Version, start: number, end: number | null) {
  check(start < v.duration && (end === null || (end > start && end <= v.duration)), 400, 'invalid_time');
}
export function addComment(p: Project, given: z.infer<typeof commentSchema>, snapshot: string): Comment {
  const version = p.versions.find(v => v.id === given.versionId);
  check(version, 404, 'version_not_found');
  // 全体は 0〜末尾の区間として保存する（既存の依頼・報告の流れがそのまま使える）。
  const input = given.scope === 'all' ? { ...given, start: 0, end: version.duration, pin: null } : given;
  check(version.id === p.versions.at(-1)!.id, 409, 'new_version');
  check(p.comments.length < limits.comments, 400, 'comment_limit');
  validateTime(version, input.start, input.end);
  if (input.followupOf) {
    const original = p.comments.find(c => c.id === input.followupOf);
    check(original, 400, 'original_not_found');
    check(['draft','addressed','accepted','blocked'].includes(original.status), 409, 'followup_conflict');
    original.status = 'superseded';
  }
  const instruction = commentInstruction(input);
  const c: Comment = { ...input, ...(instruction ? { directionInstruction: instruction } : {}), id: id(), snapshot, status: 'draft', createdAt: now(), replies: [] };
  p.comments.push(c); return c;
}
export function submitRequest(p: Project, versionId: string, commentIds: string[], target: 'codex' | 'claude' | 'any') {
  check(p.versions.at(-1)!.id === versionId, 409, 'latest_required');
  check(!p.requests.some(r => r.status === 'queued' || r.status === 'running'), 409, 'request_in_progress');
  check(commentIds.length > 0 && commentIds.length <= 100 && new Set(commentIds).size === commentIds.length, 400, 'comment_selection');
  const comments = commentIds.map(cid => {
    const c = p.comments.find(c => c.id === cid);
    check(c && c.status === 'draft' && c.versionId === versionId, 409, 'drafts_only');
    return c;
  });
  const request: ReviewRequest = { id: id(), versionId, comments: structuredClone(comments), target, status: 'queued', createdAt: now(), claimedBy: null, leaseToken: null, leaseUntil: null, failure: null, resultVersionId: null };
  comments.forEach(c => c.status = 'requested');
  p.requests.push(request); return request;
}
export function claimRequest(p: Project, requestId: string, worker: string, agent: 'codex' | 'claude') {
  const r = p.requests.find(r => r.id === requestId);
  check(r, 404, 'request_not_found');
  check(r.status === 'queued', 409, 'already_claimed');
  check(r.target === 'any' || r.target === agent, 409, 'wrong_agent');
  r.status = 'running'; r.claimedBy = worker; r.leaseToken = token(); r.leaseUntil = Date.now() + 120_000;
  return structuredClone(r);
}
export function activeLease(p: Project, requestId: string, leaseToken: string) {
  const r = p.requests.find(r => r.id === requestId);
  check(r && r.status === 'running' && r.leaseToken && equal(r.leaseToken, leaseToken) && r.leaseUntil && r.leaseUntil > Date.now(), 409, 'lease_expired');
  return r;
}
// The holder of the lease can hand the work back. An expired lease is also accepted here as long as nobody
// else has claimed it: the token still proves the caller is the previous holder.
export function releaseRequest(p: Project, requestId: string, leaseToken: string) {
  const r = p.requests.find(r => r.id === requestId);
  check(r && r.status === 'running' && r.leaseToken && equal(r.leaseToken, leaseToken), 409, 'release_conflict');
  r.status = 'queued'; r.leaseToken = null; r.leaseUntil = null; r.claimedBy = null;
  return { status: r.status };
}
// A notification that certainly never left (state failed) can be sent again or withdrawn. uncertain never can.
export function unsentRequest(p: Project, requestId: string) {
  const r = p.requests.find(r => r.id === requestId);
  check(r, 404, 'request_not_found');
  check(r.status === 'queued' && r.notification?.state === 'failed', 409, 'notification_not_unsent');
  return r;
}
export function cancelUnsentRequest(p: Project, requestId: string) {
  const r = unsentRequest(p, requestId);
  r.status = 'cancelled'; r.leaseToken = null; r.leaseUntil = null;
  // Frozen copies stay in the request for the record. The live comments return to drafts so they can be sent again.
  for (const frozen of r.comments) {
    const live = p.comments.find(c => c.id === frozen.id);
    if (live?.status === 'requested') live.status = 'draft';
  }
  return { status: r.status };
}
export function publishVersion(p: Project, input: z.infer<typeof publishSchema>, version: Version) {
  const r = activeLease(p, input.requestId, input.leaseToken);
  check(r.versionId === input.baseVersionId && p.versions.at(-1)!.id === input.baseVersionId, 409, 'base_version_mismatch');
  const requested = new Set(r.comments.map(c => c.id));
  check(input.changes.length === requested.size && new Set(input.changes.map(c => c.commentId)).size === requested.size && input.changes.every(c => requested.has(c.commentId)), 400, 'change_reports_required');
  const base = p.versions.at(-1)!;
  for (const change of input.changes) {
    const original = r.comments.find(c => c.id === change.commentId)!;
    check(change.before.start <= base.duration, 400, 'before_range');
    // An agent that widens the range by a fixed margin near the end of a video is not wrong: clamp the end.
    change.before.end = Math.min(change.before.end, base.duration);
    check(change.before.start <= original.start && change.before.end >= (original.end ?? original.start), 400, 'before_missing_comment');
    if (change.after) {
      check(change.after.start < version.duration, 400, 'after_range');
      change.after.end = Math.min(change.after.end, version.duration);
    }
  }
  version.number = p.versions.length + 1; version.changes = input.changes; version.requestId = r.id; version.summary = input.summary;
  p.versions.push(version);
  for (const c of input.changes) p.comments.find(x => x.id === c.commentId)!.status = c.outcome;
  r.status = 'completed'; r.resultVersionId = version.id; r.leaseToken = null; r.leaseUntil = null;
  return version;
}
