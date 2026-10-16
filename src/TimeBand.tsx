import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { t } from './i18n';
import type { Pin } from '../shared/types';
import { speedFactor, type SingleDirection } from '../shared/directions';
import { beatCuts, beatLines, bookendX, cropOrigin, focusOrigin, retimedBoxes, soundX, speechBoxes, tightenedBoxes, type Box } from '../shared/direction-preview';

/**
 * 時間軸の帯。1コマでは見せられないもの（音・つなぎ・速さ・表情合わせ・冒頭と締め）を、映像のふりをせず1本の細い帯で見せる。
 * 止め絵。選んだ時に帯の中の変化を 1 回だけ 400ms で見せるのは「間を詰める」だけ（reduced-motion では完成形だけ）。
 */
type Props = { preset: string; strength?: SingleDirection['strength']; mode?: SingleDirection['mode']; frame?: string; pin?: Pin | null; aspect: number; at?: number; play: number; reduced: boolean };
const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;
const BAND = 84; // 帯の幅（見本の幅に対する %）。動かす量を cqw で出すのに使う。
const image = (frame?: string): CSSProperties => frame ? { backgroundImage: `url("${frame}")` } : {};

function Band({ boxes, children, bandRef, className }: { boxes: Box[]; children?: ReactNode; bandRef?: React.Ref<HTMLSpanElement>; className?: string }) {
  return <span ref={bandRef} className={['tb-band', className].filter(Boolean).join(' ')}>{boxes.map((b, i) => <i key={i} style={{ left: pct(b.start), width: pct(b.len) }}/>)}{children}</span>;
}
const Mark = ({ x, label }: { x: number; label?: string }) => <span className="tb-mark" style={{ left: pct(x) }}><span className="tb-dot"/>{label && <span className="tb-name">{label}</span>}</span>;
const gap = (a: Box, b: Box) => ({ left: a.start + a.len, width: b.start - a.start - a.len });

export function TimeBand({ preset, strength = 'normal', mode, frame, pin, aspect, at, play, reduced }: Props) {
  const after = useRef<HTMLSpanElement>(null);
  const strengthOf = { strength, mode };
  const tight = tightenedBoxes(speechBoxes, strength);
  useEffect(() => {
    if (preset !== 'tighten' || !play || reduced || !after.current) return;
    const animations = [...after.current.querySelectorAll('i')].map((el, i) => el.animate([{ transform: `translateX(${(speechBoxes[i].start - tight[i].start) * BAND}cqw)` }, { transform: 'translateX(0)' }], { duration: 400, easing: 'ease-out' }));
    return () => animations.forEach(a => a.cancel());
  }, [play]);

  let rows: ReactNode;
  switch (preset) {
    case 'tighten':
      rows = <><Band boxes={speechBoxes}/><Band boxes={tight} bandRef={after}/></>;
      break;
    case 'keep-pause': {
      const g = gap(speechBoxes[1], speechBoxes[2]);
      rows = <Band boxes={speechBoxes}><span className="tb-keep" style={{ left: pct(g.left), width: pct(g.width) }}/></Band>;
      break;
    }
    case 'speed': {
      const factor = speedFactor(strengthOf), boxes = retimedBoxes(speechBoxes, factor);
      rows = <><Band boxes={speechBoxes}/><Band boxes={boxes}><span className="tb-name tb-factor" style={{ left: pct(boxes[1].start) }}>{factor}×</span></Band></>;
      break;
    }
    case 'sfx-in': case 'sfx-hit': case 'sfx-punch':
      rows = <Band boxes={speechBoxes}><Mark x={soundX[preset]} label={{ 'sfx-in': t("ポン・シュッ"), 'sfx-hit': t("ドドン"), 'sfx-punch': t("チリーン") }[preset]}/></Band>;
      break;
    case 'bgm-duck': { // 声の箱の所だけ、音楽の線が下がる
      const edges = [0, ...speechBoxes.flatMap(b => [b.start, b.start + b.len]), 1];
      rows = <><Band boxes={speechBoxes}/><span className="tb-music">{edges.slice(1).map((to, i) => <i key={i} className={i % 2 === 1 ? 'is-low' : undefined} style={{ left: pct(edges[i]), width: pct(to - edges[i]) }}/>)}</span></>;
      break;
    }
    case 'beat-cut':
      rows = <Band boxes={speechBoxes}>{beatLines.map(x => <b key={x} className="tb-beat" style={{ left: pct(x) }}/>)}{beatCuts.map(x => <b key={x} className="tb-cut" style={{ left: pct(x) }}/>)}</Band>;
      break;
    case 'insert': {
      const g = gap(speechBoxes[1], speechBoxes[3]);
      rows = <Band boxes={[speechBoxes[0], speechBoxes[1], speechBoxes[3]]}><span className="tb-insert" style={{ left: pct(g.left + .01), width: pct(g.width - .02) }}>{t("素材")}</span></Band>;
      break;
    }
    case 'match-expression':
      rows = <span className="tb-pair"><span className="tb-mini" style={{ ...image(frame), aspectRatio: aspect }}/><span className="tb-equal">=</span><Band boxes={[{ start: .1, len: .8 }]} className="tb-word"/></span>;
      break;
    case 'reframe': {
      const o = cropOrigin('face', focusOrigin(pin));
      rows = <span className="tb-pair">{[1.6, 1, 1.6].map((scale, i) => <span key={i} className="tb-mini" style={{ ...image(frame), aspectRatio: aspect, backgroundSize: `${scale * 100}% ${scale * 100}%`, backgroundPosition: `${o.x * 100}% ${o.y * 100}%` }}/>)}</span>;
      break;
    }
    default: { // 冒頭と締め
      const x = bookendX(preset, at);
      rows = <Band boxes={speechBoxes}><Mark x={x}/>{preset === 'loop-end' && <span className="tb-loop"/>}</Band>;
    }
  }
  return <span className="dir-stage tb-stage" aria-hidden="true"><span className="tb-rows">{rows}</span></span>;
}
