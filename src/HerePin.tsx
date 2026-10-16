import { pinClassName, pinGeometry } from '../shared/pin-shape';

/**
 * 「ここ」の丸。ペンで囲んだ一筆の、閉じきらない輪。
 * seed（コメント id）から回転・大きさ・始点のズレが決まり、同じ seed はいつも同じ形。
 * draw = 置いた瞬間に一筆で描く。ghost = 前の版の痕跡として薄く残す（中心の点なし）。
 */
export function HerePin({ seed, size = 40, draw = false, ghost = false }: { seed: string; size?: number; draw?: boolean; ghost?: boolean }) {
  const { d, start, transform } = pinGeometry(seed);
  return <svg className={pinClassName({ draw, ghost })} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <g transform={transform}>
      <path className="here-ring-edge" d={d} pathLength={1}/>
      <path className="here-ring" d={d} pathLength={1}/>
      <circle className="here-dab" cx={start[0]} cy={start[1]} r="2.6"/>
    </g>
    {!ghost && <circle className="here-dot" cx="20" cy="20" r="3"/>}
  </svg>;
}
