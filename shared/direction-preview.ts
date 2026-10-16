import { tempoRules, type SingleDirection } from './directions.js';

/**
 * 演出の見本は、ユーザー自身の止めたコマの上に描く（保存も送信もしない、画面の中だけの絵）。
 * ここは「どこをどれだけ切り取るか」「どう動かすか」を決める純粋な計算。
 */
export type Origin = { x: number; y: number };
type Strength = SingleDirection['strength'];
const level: Record<Strength, 0 | 1 | 2> = { subtle: 0, normal: 1, strong: 2 };
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** 寄り先。ピンがあればピンの位置、無ければ中央（顔検出はしない）。 */
export const focusOrigin = (pin?: Origin | null): Origin => pin ?? { x: .5, y: .5 };

const scales: Record<string, [number, number, number]> = {
  face: [1.8, 2.2, 2.6], 'upper-body': [1.3, 1.5, 1.8], 'slow-in': [1.15, 1.3, 1.5], 'snap-in': [1.2, 1.4, 1.7], out: [1.3, 1.5, 1.8],
};
export const previewScale = (preset: string, strength: Strength) => scales[preset]?.[level[strength]];
/** 上半身は寄り先の少し上寄りに枠を置く。 */
export const cropOrigin = (preset: string, o: Origin): Origin => preset === 'upper-body' ? { x: o.x, y: clamp01(o.y - .1) } : o;

/** 拡大は transform-origin = 寄り先 の scale。内側の点を中心に拡大するので、見える範囲は常に枠の内側に収まる。 */
export function cropRect(o: Origin, scale: number) {
  const w = 1 / scale;
  return { left: o.x * (1 - w), top: o.y * (1 - w), width: w, height: w };
}

export const panShift = (strength: Strength) => [.08, .12, .18][level[strength]];
export const PAN_SCALE = 1.4;
export function panRects(side: 'left' | 'right' | undefined, strength: Strength) {
  const w = 1 / PAN_SCALE, start = (1 - w) / 2, direction = side === 'left' ? -1 : 1;
  const end = start + direction * panShift(strength) / PAN_SCALE;
  return { start: { left: start, top: start, width: w, height: w }, end: { left: end, top: start, width: w, height: w } };
}
/** ぼかしの量（cqw）、止める長さ（秒）。 */
export const blurSize = (strength: Strength) => [.8, 1.6, 2.4][level[strength]];
export const holdSeconds = (strength: Strength) => [.8, 1.5, 2.5][level[strength]];
/** 再生バー上の「止める」位置（0〜1）と、止める区間の幅（全体 6 秒に対する割合）。 */
export const holdBar = (strength: Strength) => ({ at: .45, span: holdSeconds(strength) / 6 });

type Frames = { [property: string]: string | number }[];
export type Timeline = { duration: number; frames: Frames; target: 'image' | 'blur' | 'head' };
const zoom = (s: number) => `scale(${s})`;

/** 選んだ1枚だけが、選んだ時に1回だけ動く。transform と opacity だけを動かす（ぼかしは複製レイヤーの opacity）。 */
export function motionTimeline(preset: string, strength: Strength, side?: 'left' | 'right'): Timeline | null {
  const s = previewScale(preset, strength);
  switch (preset) {
    case 'face': case 'upper-body':
      return { target: 'image', duration: 2000, frames: [{ transform: zoom(1), offset: 0 }, { transform: zoom(1), offset: .4 }, { transform: zoom(s), offset: .4 }, { transform: zoom(s), offset: 1 }] };
    case 'slow-in':
      return { target: 'image', duration: 2800, frames: [{ transform: zoom(1), offset: 0 }, { transform: zoom(1), offset: .1, easing: 'ease-in-out' }, { transform: zoom(s), offset: .8 }, { transform: zoom(s), offset: 1 }] };
    case 'snap-in': // 0.9 秒止まり → 0.18 秒で寄る → 0.9 秒止まる
      return { target: 'image', duration: 1980, frames: [{ transform: zoom(1), offset: 0 }, { transform: zoom(1), offset: 900 / 1980, easing: 'ease-out' }, { transform: zoom(s), offset: 1080 / 1980 }, { transform: zoom(s), offset: 1 }] };
    case 'out':
      return { target: 'image', duration: 2800, frames: [{ transform: zoom(s), offset: 0 }, { transform: zoom(s), offset: .1, easing: 'ease-in-out' }, { transform: zoom(1), offset: .8 }, { transform: zoom(1), offset: 1 }] };
    case 'pan': {
      const shift = (side === 'left' ? -1 : 1) * panShift(strength) * 100;
      return { target: 'image', duration: 2800, frames: [{ transform: `translateX(0%) ${zoom(PAN_SCALE)}`, offset: 0 }, { transform: `translateX(0%) ${zoom(PAN_SCALE)}`, offset: .1, easing: 'ease-in-out' }, { transform: `translateX(${shift}%) ${zoom(PAN_SCALE)}`, offset: .8 }, { transform: `translateX(${shift}%) ${zoom(PAN_SCALE)}`, offset: 1 }] };
    }
    case 'soft-background':
      return { target: 'blur', duration: 1600, frames: [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .1 }, { opacity: 1, offset: .5 }, { opacity: 1, offset: 1 }] };
    case 'hold': { // 再生ヘッドが「止める」位置で止まり、また進む
      const hold = holdSeconds(strength) * 1000, run = 3000, at = holdBar(strength).at, total = run + hold;
      const pause = `translateX(${at * 100 - 100}%)`;
      return { target: 'head', duration: total, frames: [{ transform: 'translateX(-100%)', offset: 0 }, { transform: pause, offset: run * at / total }, { transform: pause, offset: (run * at + hold) / total }, { transform: 'translateX(0%)', offset: 1 }] };
    }
    default: return null; // 二人・左右・上下・重ね・横に余白は、動かさない枠の図
  }
}
export const isDiagram = (preset: string) => ['two', 'sides', 'stack', 'overlay', 'side-info'].includes(preset);

/** 1コマでは見せられないもの（音・つなぎ・速さ・表情合わせ・冒頭と締め）は、時間軸の帯で見せる（§9-3）。 */
export const bandIds = ['tighten', 'keep-pause', 'speed', 'sfx-in', 'sfx-hit', 'sfx-punch', 'bgm-duck', 'beat-cut', 'insert', 'match-expression', 'reframe', 'open-conclusion', 'close-summary', 'call-to-action', 'loop-end'];
export const isBand = (preset: string) => bandIds.includes(preset);

/** 帯の中の「話している区間」の箱。start / len は帯の幅に対する割合（0〜1）。 */
export type Box = { start: number; len: number };
export const speechBoxes: Box[] = [{ start: .03, len: .17 }, { start: .27, len: .13 }, { start: .5, len: .18 }, { start: .78, len: .16 }];
const gapKept = { subtle: tempoRules.soft, normal: tempoRules.normal, strong: tempoRules.tight };
/** 間を詰めた後の箱。箱と箱の隙間が、テンポの目安（0.4秒→0.2秒 なら半分）と同じ比率で縮む。 */
export function tightenedBoxes(boxes: Box[], strength: Strength): Box[] {
  const rule = gapKept[strength], keep = Number(rule.to) / Number(rule.from);
  let shift = 0;
  return boxes.map((b, i) => {
    if (i > 0) shift += (b.start - boxes[i - 1].start - boxes[i - 1].len) * (1 - keep);
    return { start: b.start - shift, len: b.len };
  });
}
/** 速さを変えた後の箱。index の箱だけが 1/factor 倍の長さになり、後ろの箱は押される。帯の外にはみ出す分は切る。 */
export function retimedBoxes(boxes: Box[], factor: number, index = 1): Box[] {
  const delta = boxes[index].len * (1 / factor - 1);
  return boxes.flatMap((b, i) => {
    const moved = i < index ? b : i === index ? { start: b.start, len: b.len / factor } : { start: b.start + delta, len: b.len };
    const len = Math.min(moved.len, 1 - moved.start);
    return len > .02 ? [{ start: moved.start, len }] : [];
  });
}
const clamp = (n: number) => Math.max(.02, Math.min(.98, n));
/** 冒頭と締めの印の位置（帯の幅に対する割合）。「ここ」で開いた時は、今の時刻の位置に出す。 */
export function bookendX(preset: string, at?: number): number {
  const fallback = preset === 'open-conclusion' ? .04 : .96;
  return clamp(at ?? fallback);
}
/** 音の印の位置と、拍の線・切れ目の印の位置（固定の見本）。 */
export const soundX: Record<string, number> = { 'sfx-in': .2, 'sfx-hit': .5, 'sfx-punch': .82 };
export const beatLines = [.125, .25, .375, .5, .625, .75, .875];
export const beatCuts = [.25, .5, .875];
