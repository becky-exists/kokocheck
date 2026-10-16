import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cropRect, cropOrigin, focusOrigin, previewScale, panRects, motionTimeline, holdSeconds, isDiagram, isBand, blurSize, speechBoxes, tightenedBoxes, retimedBoxes, bookendX, bandIds } from '../shared/direction-preview.js';
import { directionPresets, directionInstruction, captionPresets } from '../shared/directions.js';
import { commentBody } from '../shared/review-ui.js';

const strengths = ['subtle', 'normal', 'strong'] as const;

test('the crop frame always stays inside the picture, wherever the pin is', () => {
  for (const preset of ['face', 'upper-body', 'slow-in', 'snap-in', 'out']) for (const strength of strengths) for (const x of [0, .25, .5, 1]) for (const y of [0, .5, 1]) {
    const rect = cropRect(cropOrigin(preset, { x, y }), previewScale(preset, strength));
    for (const edge of [rect.left, rect.top, rect.left + rect.width, rect.top + rect.height]) assert.ok(edge >= -1e-9 && edge <= 1 + 1e-9, `${preset}/${strength} (${x},${y}) edge ${edge}`);
  }
  assert.deepEqual(focusOrigin(null), { x: .5, y: .5 }, 'no pin: aim at the center, no face detection');
  assert.deepEqual(focusOrigin({ x: .2, y: .7 }), { x: .2, y: .7 });
  assert.ok(cropOrigin('upper-body', { x: .5, y: .5 }).y < .5, 'upper body sits a little above the pin');
  assert.ok(previewScale('face', 'strong') > previewScale('face', 'subtle'));
});

test('panning never moves the frame past the picture edge', () => {
  for (const side of ['left', 'right'] as const) for (const strength of strengths) {
    const { start, end } = panRects(side, strength);
    assert.ok(end.left >= 0 && end.left + end.width <= 1, `${side}/${strength}`);
    assert.equal(side === 'left' ? end.left < start.left : end.left > start.left, true);
  }
});

test('each moving sample plays once, using only transform and opacity', () => {
  for (const preset of directionPresets) for (const strength of strengths) {
    const timeline = motionTimeline(preset.id, strength, 'right');
    if (isDiagram(preset.id) || isBand(preset.id)) { assert.equal(timeline, null, `${preset.id} is a static diagram or a time band`); continue; }
    assert.ok(timeline, preset.id);
    let previous = 0;
    for (const frame of timeline.frames) {
      assert.ok(frame.offset as number >= previous && frame.offset as number <= 1, `${preset.id}: offsets rise`); previous = frame.offset as number;
      assert.deepEqual(Object.keys(frame).filter(k => !['offset', 'easing', 'transform', 'opacity'].includes(k)), [], `${preset.id}: no layout or paint properties`);
    }
    assert.ok(timeline.duration > 0 && timeline.duration <= 6000);
  }
  assert.equal(motionTimeline('snap-in', 'normal')!.duration, 1980, '0.9s still + 0.18s snap + 0.9s still');
  for (const strength of strengths) assert.equal(motionTimeline('hold', strength)!.duration, 3000 + holdSeconds(strength) * 1000);
  assert.deepEqual(directionPresets.filter(p => isDiagram(p.id)).map(p => p.id).sort(), ['overlay', 'side-info', 'sides', 'stack', 'two']);
  assert.ok(blurSize('strong') > blurSize('subtle'));
});

test('previews never touch what is saved or sent: no image in the request, no storage, no network in the preview code', async () => {
  const frame = 'data:image/jpeg;base64,AAAA';
  const draft = { versionId: '48e1e6ee-01c2-45f6-9332-a0b4a13300ad', start: 1, end: null, pin: { x: .3, y: .4 }, followupOf: null, direction: { preset: 'face' as const, strength: 'normal' as const }, frame };
  const body = JSON.stringify(commentBody(draft, 'テスト', 'a'));
  assert.ok(!body.includes('data:image') && !body.includes('frame'));
  for (const preset of directionPresets) assert.ok(!directionInstruction({ preset: preset.id, strength: 'normal' }).includes('data:'));
  for (const preset of captionPresets) assert.ok(!directionInstruction({ version: 2, caption: { preset: preset.id } }).includes('data:'));
  assert.match(directionInstruction({ preset: 'face', strength: 'normal' }), /Example illustrations are not source assets/);
  for (const file of ['src/DirectionAssist.tsx', 'src/DirectionPreview.tsx', 'src/CaptionPreview.tsx', 'src/TimeBand.tsx']) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|\bpost\(|sendBeacon|XMLHttpRequest|console\./, file);
  }
});

test('every id that one frame cannot show is drawn as a time band, and each band stays inside the bar', () => {
  const ids = directionPresets.map(p => p.id as string);
  for (const id of bandIds) assert.ok(ids.includes(id), `${id} is a real preset`);
  for (const id of ['tighten', 'keep-pause', 'speed', 'sfx-in', 'sfx-hit', 'sfx-punch', 'bgm-duck', 'beat-cut', 'insert', 'match-expression', 'reframe', 'open-conclusion', 'close-summary', 'call-to-action', 'loop-end']) assert.ok(isBand(id), id);
  const edge = (boxes: { start: number; len: number }[]) => boxes.every((b, i) => b.start >= 0 && b.len > 0 && b.start + b.len <= 1 + 1e-9 && (i === 0 || b.start >= boxes[i - 1].start + boxes[i - 1].len - 1e-9));
  assert.ok(edge(speechBoxes));
  const end = (boxes: { start: number; len: number }[]) => boxes.at(-1)!.start + boxes.at(-1)!.len;
  for (const strength of strengths) { const after = tightenedBoxes(speechBoxes, strength); assert.ok(edge(after) && end(after) < end(speechBoxes), `tighten/${strength} shortens the whole`); assert.deepEqual(after.map(b => b.len), speechBoxes.map(b => b.len), 'the speech itself keeps its length'); }
  assert.ok(end(tightenedBoxes(speechBoxes, 'strong')) < end(tightenedBoxes(speechBoxes, 'subtle')), 'a tighter level removes more');
  for (const factor of [.25, .5, .75, 1.25, 1.5, 2]) { const boxes = retimedBoxes(speechBoxes, factor); assert.ok(edge(boxes), `x${factor}`); assert.ok((boxes[1].len > speechBoxes[1].len) === (factor < 1)); }
  assert.equal(bookendX('open-conclusion') < .1 && bookendX('close-summary') > .9, true);
  assert.equal(bookendX('call-to-action', .5), .5, 'pinned at the current time when asked from a moment');
  assert.ok(bookendX('open-conclusion', -3) >= 0 && bookendX('loop-end', 9) <= 1);
});
