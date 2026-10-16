import type { Direction } from './directions.js';
export type Pin = { x: number; y: number };
export type CommentStatus = 'draft' | 'requested' | 'addressed' | 'accepted' | 'blocked' | 'superseded';
export type Media = { duration: number; width: number; height: number; hasAudio: boolean; size: number };
export type Change = {
  commentId: string; summary: string; outcome: 'addressed' | 'blocked';
  before: { start: number; end: number };
  after: { start: number; end: number } | null;
};
export type Version = Media & {
  id: string; number: number; file: string; createdAt: string;
  summary: string; requestId: string | null; changes: Change[]; poster: string;
};
export type Comment = {
  id: string; versionId: string; text: string; author: string;
  start: number; end: number | null; pin: Pin | null; snapshot: string;
  status: CommentStatus; createdAt: string; replies: { id: string; text: string; author: string; createdAt: string }[];
  followupOf: string | null;
  direction?: Direction | null; directionInstruction?: string;
  // 'all' = 動画全体への指示（区間は 0〜末尾、ピン無し）。無ければ時刻に刻んだふつうのコメント。
  scope?: 'all';
};
export type RequestNotification = {
  state: 'sending' | 'queued' | 'failed' | 'uncertain'; updatedAt: string; queueId?: string;
  provider?: 'codex' | 'claude';
};
export type Request = {
  id: string; versionId: string; comments: Comment[]; target: 'codex' | 'claude' | 'any';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; createdAt: string;
  claimedBy: string | null; leaseToken: string | null; leaseUntil: number | null;
  failure: string | null; resultVersionId: string | null;
  notification?: RequestNotification;
};
export type Project = {
  id: string; title: string; mode: 'source' | 'mp4'; sourceRef: string | null;
  reviewToken: string; createdAt: string; updatedAt: string;
  versions: Version[]; comments: Comment[]; requests: Request[];
};
export type ReviewProject = Omit<Project, 'sourceRef' | 'reviewToken' | 'requests'> & {
  requests: Omit<Request, 'leaseToken' | 'comments'>[];
  chatNotification?: { provider: 'codex' | 'claude'; testOnly: boolean };
  // True only for the operator (admin key or local session). Reviewers with a share link get false.
  isAdmin?: boolean;
};
export type ProjectCard = {
  id: string; title: string; mode: Project['mode']; createdAt: string; updatedAt: string;
  reviewUrl: string; latest: Version; comments: number; pending: number;
};
export function timeLabel(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function mergeRanges(ranges: { start: number; end: number }[], duration: number, padding = 1) {
  const sorted = ranges.map(r => ({ start: Math.max(0, r.start - padding), end: Math.min(duration, r.end + padding) }))
    .filter(r => r.end > r.start).sort((a,b) => a.start-b.start);
  const result: { start: number; end: number }[] = [];
  for (const r of sorted) {
    const previous = result.at(-1);
    if (previous && r.start <= previous.end) previous.end = Math.max(previous.end, r.end);
    else result.push({ ...r });
  }
  return result;
}
