/**
 * 「ここ」の丸。ペンでぐるっと囲んだ一筆の形を、コメント id から決める。
 * 同じ id はいつ見ても同じ形（乱数で作り直さない）。
 */
export type PinShape = { rotate: number; scale: number; variant: 0 | 1 | 2 };

/** FNV-1a に最後の攪拌を足した 32bit ハッシュ。 */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return h >>> 0;
}

/** 回転 0〜359°、大きさ 0.94〜1.06、始点と終点のズレ 3 通り。 */
export function pinShape(seed: string): PinShape {
  const h = hashSeed(seed);
  return { rotate: h % 360, scale: 0.94 + ((h >>> 9) % 121) / 1000, variant: ((h >>> 20) % 3) as 0 | 1 | 2 };
}

// sweep = 描く角度（360 を超え、終点が始点の横を並走して二重線の溜まりができる）、drift = 終点の半径のズレ、squash = 縦横のゆがみ。
const variants = [
  { sweep: 396, drift: -3.2, squash: .05 },
  { sweep: 410, drift: -4, squash: .04 },
  { sweep: 388, drift: 3.4, squash: .06 },
] as const;

/** 40×40 の viewBox に収まる一筆の path。始点は真上（回転は呼び出し側）。 */
export function pinPath(variant: 0 | 1 | 2): { d: string; start: [number, number] } {
  const { sweep, drift, squash } = variants[variant];
  const points: [number, number][] = [];
  for (let angle = 0; angle <= sweep; angle += 8) {
    const t = angle / sweep, radius = 15 + drift * t, a = (angle - 90) * Math.PI / 180;
    points.push([20 + Math.cos(a) * radius * (1 + squash), 20 + Math.sin(a) * radius * (1 - squash)]);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { d: points.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join(''), start: [round(points[0][0]), round(points[0][1])] };
}

/** 描画に必要なもの一式。回転・大きさは中心(20,20)まわりで掛ける。 */
export function pinGeometry(seed: string) {
  const { rotate, scale, variant } = pinShape(seed);
  const { d, start } = pinPath(variant);
  return { d, start, transform: `rotate(${rotate} 20 20) translate(20 20) scale(${scale}) translate(-20 -20)` };
}

/** draw = 置いた瞬間に一筆で描く、ghost = 前の版の痕跡として薄く残す（中心の点なし）。 */
export const pinClassName = ({ draw = false, ghost = false } = {}) => ['here-pin', draw && 'is-drawing', ghost && 'is-ghost'].filter(Boolean).join(' ');
