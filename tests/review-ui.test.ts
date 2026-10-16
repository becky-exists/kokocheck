import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pinShape, pinPath, pinGeometry, pinClassName } from '../shared/pin-shape.js';
import { commentBody, dockAction, primaryAction, toolbarTones, notificationCard, statusMark, commentActions, showFilter, showByline, type Fill } from '../shared/review-ui.js';
import { isBlankFrame } from '../shared/frame.js';
import { relativeTime } from '../shared/relative-time.js';
import { englishMessages } from '../shared/ui-messages.js';
import type { CommentStatus } from '../shared/types.js';
import { newProject, addComment, commentSchema, id as newId, now } from '../server/domain.js';

const statuses: CommentStatus[] = ['draft', 'requested', 'addressed', 'accepted', 'blocked', 'superseded'];

test('the circle for "here" is decided by the comment id and never re-rolled', () => {
  const id = '48e1e6ee-01c2-45f6-9332-a0b4a13300ad';
  assert.deepEqual(pinShape(id), pinShape(id));
  assert.deepEqual(pinGeometry(id), pinGeometry(id));
  const seen = new Set<string>(), variants = new Set<number>();
  for (let i = 0; i < 600; i++) {
    const shape = pinShape(`comment-${i}`);
    assert.ok(shape.rotate >= 0 && shape.rotate < 360, 'rotation 0-359');
    assert.ok(shape.scale >= 0.94 && shape.scale <= 1.06, 'size 0.94-1.06');
    seen.add(`${shape.rotate}/${shape.scale}/${shape.variant}`); variants.add(shape.variant);
  }
  assert.ok(seen.size > 500, 'different comments get different circles');
  assert.equal(variants.size, 3, 'all three start/end gaps are used');
});

test('the circle is one open stroke whose end overlaps its start without closing', () => {
  for (const variant of [0, 1, 2] as const) {
    const { d, start } = pinPath(variant);
    assert.equal(d.match(/M/g)?.length, 1, 'a single stroke');
    const points = [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
    const end = points.at(-1)!;
    const gap = Math.hypot(end[0] - start[0], end[1] - start[1]);
    assert.ok(gap > 0.5 && gap < 12, `variant ${variant}: the end runs alongside the start without joining it (${gap.toFixed(2)})`);
    for (const [x, y] of points) assert.ok(x > 0 && x < 40 && y > 0 && y < 40, 'stays inside the viewBox');
  }
});

test('the placed circle draws itself once, a ghost is the same circle drawn faintly', () => {
  const id = 'abc';
  assert.equal(pinClassName(), 'here-pin');
  assert.equal(pinClassName({ draw: true }), 'here-pin is-drawing');
  assert.equal(pinClassName({ ghost: true }), 'here-pin is-ghost');
  assert.match(pinGeometry(id).transform, new RegExp(`^rotate\\(${pinShape(id).rotate} 20 20\\)`));
  assert.notEqual(pinGeometry('a').transform, pinGeometry('b').transform);
});

test('exactly one filled button at a time, and it moves with the next thing to do', () => {
  const base = { drafting: false, recovery: false, activeRequest: null, pendingChecks: false, draftCount: 0, hasChanges: false };
  const cases: [string, Parameters<typeof primaryAction>[0], Fill][] = [
    ['v1, no comments', base, 'comment'],
    ['comments saved', { ...base, draftCount: 2 }, 'request'],
    ['typing a comment', { ...base, draftCount: 2, drafting: true }, 'save'],
    ['request sent, waiting', { ...base, draftCount: 1, activeRequest: { status: 'queued', notification: { state: 'queued' } } }, 'none'],
    ['notification failed', { ...base, activeRequest: { status: 'queued', notification: { state: 'failed' } } }, 'resend'],
    ['notification uncertain', { ...base, activeRequest: { status: 'queued', notification: { state: 'uncertain' } } }, 'none'],
    ['revision arrived', { ...base, hasChanges: true, pendingChecks: true }, 'check'],
    ['revision all checked', { ...base, hasChanges: true }, 'none'],
    ['request stopped', { ...base, recovery: true, draftCount: 1 }, 'requeue'],
  ];
  for (const [name, state, fill] of cases) assert.equal(primaryAction(state), fill, name);
  for (const fill of ['save', 'resend', 'requeue', 'check', 'request', 'comment', 'none'] as Fill[]) {
    const filled = Object.values(toolbarTones(fill)).filter(tone => tone === 'primary').length;
    assert.equal(filled, ['check', 'request', 'comment'].includes(fill) ? 1 : 0, `toolbar fills for ${fill}`);
  }
  assert.deepEqual((['comment', 'request', 'check', 'save', 'resend', 'requeue', 'none'] as Fill[]).map(dockAction), ['comment', 'request', 'check', null, null, null, null], 'the dock mirrors only comment / request / check');
  assert.deepEqual(toolbarTones('comment'), { comment: 'primary', pin: 'secondary', request: 'secondary', check: 'secondary', play: 'secondary' });
  assert.equal(toolbarTones('request').comment, 'secondary'); assert.equal(toolbarTones('request').pin, 'plain');
  assert.equal(toolbarTones('check').comment, 'plain');
});

test('a failed notification offers exactly two buttons; every other state only reports', () => {
  assert.deepEqual(notificationCard('failed', 'Codex').actions, ['resend', 'cancel']);
  for (const state of ['uncertain', 'sending', 'queued'] as const) assert.deepEqual(notificationCard(state, 'Codex').actions, [], state);
  assert.equal(notificationCard('failed', 'Codex').attention, true);
  assert.equal(notificationCard('queued', 'Claude Code').attention, false);
  assert.deepEqual(notificationCard('queued', 'Claude Code').values, ['Claude Code']);
  for (const state of ['failed', 'uncertain', 'sending', 'queued'] as const) {
    const card = notificationCard(state, 'Codex');
    for (const key of [card.title, card.description]) {
      assert.ok(englishMessages[key], `missing English for ${key}`);
      assert.doesNotMatch(key, /重複|自動で再送|着信/, 'no implementation excuses on screen');
    }
  }
});

test('comment cards stay quiet: no badge for drafts, a check for OK, actions only when selected', () => {
  assert.deepEqual(statusMark('draft'), { kind: 'none' });
  assert.deepEqual(statusMark('accepted'), { kind: 'check' });
  assert.deepEqual(statusMark('blocked'), { kind: 'text', label: '要相談', tone: 'attention' });
  assert.deepEqual(statusMark('addressed'), { kind: 'text', label: '確認待ち', tone: 'accent' });
  for (const status of statuses) {
    assert.deepEqual(commentActions(status, false), [], `${status}: no action row while unselected`);
    const mark = statusMark(status); if (mark.kind === 'text') assert.ok(englishMessages[mark.label], mark.label);
  }
  assert.deepEqual(commentActions('draft', true), ['edit'], 'a draft has nobody to reply to');
  assert.deepEqual(commentActions('addressed', true), ['reply', 'compare', 'accept', 'again']);
  assert.deepEqual(commentActions('requested', true), ['reply']);
});

test('the filter and the byline appear only once they say something', () => {
  const c = (status: CommentStatus, author = 'a') => ({ status, author });
  assert.equal(showFilter([c('draft')]), false);
  assert.equal(showFilter([c('draft'), c('requested')]), false);
  assert.equal(showFilter([c('accepted')]), false);
  assert.equal(showFilter([c('draft'), c('accepted')]), true);
  assert.equal(showByline([c('draft'), c('draft')]), false);
  assert.equal(showByline([c('draft', 'a'), c('draft', 'b')]), true);
});

test('relative time reads like a person and falls back to a date after a week', () => {
  const now = Date.parse('2026-10-16T12:00:00Z'), ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(relativeTime(ago(10_000), 'ja', now), 'たった今');
  assert.equal(relativeTime(ago(5 * 60_000), 'ja', now), '5分前');
  assert.equal(relativeTime(ago(3 * 3600_000), 'ja', now), '3時間前');
  assert.equal(relativeTime(ago(30 * 3600_000), 'ja', now), '昨日');
  assert.equal(relativeTime(ago(3 * 86400_000), 'ja', now), '3日前');
  assert.equal(relativeTime(ago(5 * 60_000), 'en', now), '5 minutes ago');
  assert.equal(relativeTime(ago(30 * 3600_000), 'en', now), 'yesterday');
  assert.match(relativeTime(ago(20 * 86400_000), 'en', now), /Sep/);
  assert.equal(relativeTime('not a date', 'ja', now), '');
});

test('on-screen copy has no half-width spaces between Japanese words, and no orange, chips or stray shadows remain', async () => {
  for (const file of ['src/App.tsx', 'src/ReviewFlow.tsx', 'src/DirectionAssist.tsx', 'shared/review-ui.ts']) {
    const source = await readFile(file, 'utf8');
    for (const [, literal] of source.matchAll(/\bt\(["']([^"']+)["']/g)) assert.doesNotMatch(literal, /[぀-鿿] [぀-鿿]/, `${file}: ${literal}`);
  }
  const css = (await Promise.all(['src/styles.css', 'src/direction-assist.css'].map(f => readFile(f, 'utf8')))).join('\n');
  const tsx = (await Promise.all(['src/App.tsx', 'src/ReviewFlow.tsx', 'src/DirectionAssist.tsx'].map(f => readFile(f, 'utf8')))).join('\n');
  const found = (re: RegExp, text: string) => text.match(re)?.[0] ?? '';
  assert.equal(found(/retry-action|review-retry|orange-|blue-\d|zinc-\d|font-size:\s*10px/, css + tsx), '');
  assert.equal(found(/box-shadow:\s*(?!\s|var\(--float\)|none)[^;]*/, css), '', 'shadows only for things that float');
  for (const [line] of css.matchAll(/backdrop-filter:[^;]*;/g)) assert.match(line, /blur\(20px\) saturate\(180%\)|none/);
  assert.equal(css.match(/backdrop-filter: blur[^}]*\}/g)?.length, 2, 'glass only on the phone dock and the phone top bar');
  const styles = await readFile('src/styles.css', 'utf8');
  for (const [, radius] of styles.matchAll(/border-radius:\s*([^;}]+)[;}]/g)) assert.match(radius.trim(), /^(0|4px|8px|12px|20px|50%|20px 20px 0 0)$/, `radius ${radius}`);
});

test('saving a comment sends only keys the strict server schema knows, so screen-only values never leak into the request', async () => {
  const version = { id: newId(), number: 1, duration: 12, width: 720, height: 1280, hasAudio: false, size: 1, file: 'f.mp4', poster: 'f.jpg', createdAt: now(), summary: 'x', requestId: null, changes: [] };
  const project = newProject('Body', 'mp4', null, version);
  // 画面の下書きは seed を持つ。そのまま展開して送ると 400 になる（実際に起きた不具合）。
  const draft = { versionId: version.id, start: 0, end: null, pin: { x: 0.5, y: 0.5 }, followupOf: null, direction: null, seed: '8654msx3mvasxrvo' };
  assert.equal(commentSchema.safeParse({ ...draft, text: 'ここ', author: 'レビュー担当' }).success, false, 'the schema stays strict');
  const body = commentBody(draft, 'ここ、0.5秒早く。', 'レビュー担当');
  assert.ok(!('seed' in body));
  const comment = addComment(project, commentSchema.parse(body), 's.jpg');
  assert.deepEqual(comment.pin, { x: 0.5, y: 0.5 });
  // 再修正（ReviewFlow）と、演出つきのコメントも同じ関数を通る
  const followup = commentBody({ versionId: version.id, followupOf: comment.id, start: 1, end: 2, pin: null, direction: { preset: 'face', strength: 'normal' } }, '再調整', 'a');
  assert.ok(commentSchema.safeParse(followup).success);
  for (const file of ['src/App.tsx', 'src/ReviewFlow.tsx']) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /\bpost(<[^>]*>)?\([^;]*\.\.\.draft/, `${file}: do not spread the draft into a request`);
  }
});

test('a frame that was not painted yet (all black) is told apart from a real picture', () => {
  assert.equal(isBlankFrame(new Uint8ClampedArray(4 * 64)), true);
  const picture = new Uint8ClampedArray(4 * 64); picture[4 * 40] = 200;
  assert.equal(isBlankFrame(picture), false);
  assert.equal(isBlankFrame(new Uint8ClampedArray(4 * 64).fill(255)), false);
});

test('a whole-video draft sends no time, no pin and no range, even when the screen still holds them', () => {
  const draft = { versionId: newId(), start: 7.5, end: 9, pin: { x: .3, y: .4 }, followupOf: null, direction: { version: 3 as const, tempo: 'normal' as const }, scope: 'all' as const, seed: 'abc' };
  const body = commentBody(draft, 'テンポ · ふつう', 'a');
  assert.deepEqual([body.start, body.end, body.pin, body.scope], [0, null, null, 'all']);
  assert.ok(commentSchema.safeParse(body).success);
  const here = commentBody({ ...draft, scope: undefined, direction: null }, 'ここ', 'a');
  assert.deepEqual([here.start, here.end, here.pin], [7.5, 9, { x: .3, y: .4 }]); assert.ok(!('scope' in here));
});
