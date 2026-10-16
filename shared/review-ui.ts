import type { CommentStatus, Pin, RequestNotification } from './types.js';
import type { Direction } from './directions.js';

/** 塗りのボタンは画面に常に1つ。次にやることが動くにつれて、塗りが移る。 */
export type Fill = 'save' | 'resend' | 'requeue' | 'check' | 'request' | 'comment' | 'none';
export type Tone = 'primary' | 'secondary' | 'plain';

export function primaryAction(s: {
  drafting: boolean; recovery: boolean;
  activeRequest: { status: 'queued' | 'running'; notification?: Pick<RequestNotification, 'state'> } | null;
  pendingChecks: boolean; draftCount: number; hasChanges: boolean;
}): Fill {
  if (s.drafting) return 'save';
  if (s.recovery) return 'requeue';
  if (s.activeRequest) return s.activeRequest.status === 'queued' && s.activeRequest.notification?.state === 'failed' ? 'resend' : 'none';
  if (s.pendingChecks) return 'check';
  if (s.draftCount > 0) return 'request';
  return s.hasChanges ? 'none' : 'comment';
}

/** スマホの下端ドックに置く1つ。次にやることが「コメント・依頼・チェック」の時だけ。 */
export const dockAction = (fill: Fill): 'comment' | 'request' | 'check' | null => fill === 'comment' || fill === 'request' || fill === 'check' ? fill : null;

/** 画面下のボタン群の濃さ。塗り（primary）になるのは fill が指す1つだけ。 */
export function toolbarTones(fill: Fill): { comment: Tone; pin: Tone; request: Tone; check: Tone; play: Tone } {
  return {
    comment: fill === 'comment' ? 'primary' : fill === 'check' ? 'plain' : 'secondary',
    pin: fill === 'comment' ? 'secondary' : 'plain',
    request: fill === 'request' ? 'primary' : 'secondary',
    check: fill === 'check' ? 'primary' : 'secondary',
    play: 'secondary',
  };
}

export type NotificationCard = { title: string; description: string; values: string[]; attention: boolean; actions: ('resend' | 'cancel')[] };
/** 通知カードの文言（日本語がそのまま辞書のキー）。結果だけ言い、実装の事情は書かない。 */
export function notificationCard(state: RequestNotification['state'], providerName: string): NotificationCard {
  if (state === 'failed') return { title: 'チャットに届きませんでした', description: '依頼は保存してあります。', values: [], attention: true, actions: ['resend', 'cancel'] };
  if (state === 'uncertain') return { title: '届いたか確認できません', description: '制作側で確認してください。', values: [], attention: true, actions: [] };
  if (state === 'sending') return { title: 'チャットに知らせています', description: '依頼は保存してあります。', values: [], attention: false, actions: [] };
  return { title: 'チャットに知らせました', description: '{0} の返事待ち。', values: [providerName], attention: false, actions: [] };
}

/** 状態の出し方。下書きは既定なので何も出さず、OK は小さなチェックだけ。 */
export type StatusMark = { kind: 'none' } | { kind: 'check' } | { kind: 'text'; label: string; tone: 'muted' | 'accent' | 'attention' };
export function statusMark(status: CommentStatus): StatusMark {
  switch (status) {
    case 'draft': return { kind: 'none' };
    case 'accepted': return { kind: 'check' };
    case 'requested': return { kind: 'text', label: '依頼済み', tone: 'muted' };
    case 'addressed': return { kind: 'text', label: '確認待ち', tone: 'accent' };
    case 'blocked': return { kind: 'text', label: '要相談', tone: 'attention' };
    case 'superseded': return { kind: 'text', label: '引き継ぎ済み', tone: 'muted' };
  }
}

/** 操作行は選択中のカードだけ。下書きに返信は要らないので編集だけ。 */
export type CommentAction = 'edit' | 'reply' | 'compare' | 'accept' | 'again';
export function commentActions(status: CommentStatus, selected: boolean): CommentAction[] {
  if (!selected) return [];
  if (status === 'draft') return ['edit'];
  const actions: CommentAction[] = ['reply'];
  if (['addressed', 'accepted', 'blocked'].includes(status)) actions.push('compare');
  if (status === 'addressed') actions.push('accept');
  if (['addressed', 'accepted', 'blocked'].includes(status)) actions.push('again');
  return actions;
}

const isClosed = (status: CommentStatus) => status === 'accepted' || status === 'superseded';
/** フィルタは、終わったものと残っているものが両方ある時だけ出す。 */
export const showFilter = (comments: { status: CommentStatus }[]) => comments.some(c => c.status === 'accepted') && comments.some(c => !isClosed(c.status));
/** 投稿者が2人以上いる時だけ byline を出す。 */
export const showByline = (comments: { author: string }[]) => new Set(comments.map(c => c.author)).size > 1;

/**
 * コメント保存で送る body。サーバーの comment スキーマは strict なので、画面だけで使う値（丸の seed など）を
 * 混ぜないよう、送るキーをここで1つずつ選ぶ。下書きを丸ごと展開して送らないこと。
 */
export function commentBody(draft: { versionId: string; start: number; end: number | null; pin: Pin | null; followupOf: string | null; direction?: Direction | null; scope?: 'all' }, text: string, author: string) {
  // 全体は時刻もピンも持たない（画面の下書きに残っていても送らない）。
  const where = draft.scope === 'all' ? { start: 0, end: null, pin: null, scope: 'all' as const } : { start: draft.start, end: draft.end, pin: draft.pin };
  return { versionId: draft.versionId, text, author, ...where, followupOf: draft.followupOf, direction: draft.direction ?? null };
}
