import { isDirection, type Direction } from './directions.js';
import type { Comment, Pin } from './types.js';

export type ReviewDraft = { text: string; start: number; end: number | null; pin: Pin | null; editing: boolean; direction?: Direction | null };
export type ReviewDrafts = Record<string, ReviewDraft>;
export function decision(comments: Comment[], id: string) {
  const comment = comments.find(c => c.id === id);
  if (comment?.status === 'accepted') return 'ok';
  if (comment?.status === 'superseded') return 'retry';
  return 'pending';
}
// Only locally authored drafts are restored. Validate stale or malformed storage.
export function restoreDrafts(raw: string | null, duration: number): ReviewDrafts {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, d]) => {
      if (!/^[a-f0-9-]{36}$/.test(id) || !d || typeof d !== 'object') return false;
      return typeof d.text === 'string' && d.text.length <= 4000 && typeof d.editing === 'boolean'
        && Number.isFinite(d.start) && d.start >= 0 && d.start < duration
        && (d.end === null || (Number.isFinite(d.end) && d.end >= d.start && d.end <= duration))
        && (d.direction == null || isDirection(d.direction))
        && (d.pin === null || (Number.isFinite(d.pin?.x) && Number.isFinite(d.pin?.y)
          && d.pin.x >= 0 && d.pin.x <= 1 && d.pin.y >= 0 && d.pin.y <= 1));
    })) as ReviewDrafts;
  } catch { return {}; }
}
export function mappedTime(time: number, from: {start: number; end: number}, to: {start: number; end: number}) {
  const progress = from.end > from.start ? Math.max(0, Math.min(1, (time - from.start) / (from.end - from.start))) : 0;
  return to.start + progress * (to.end - to.start);
}
