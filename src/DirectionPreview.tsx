import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { t } from './i18n';
import { HerePin } from './HerePin';
import type { DirectionId, SingleDirection } from '../shared/directions';
import type { Pin } from '../shared/types';
import { blurSize, cropOrigin, cropRect, focusOrigin, holdBar, motionTimeline, panRects, previewScale, type Origin } from '../shared/direction-preview';

/**
 * 演出の見本。ユーザー自身の止めたコマの上に、仕上がりの「切り取り枠」を描く。
 * コマは画面の中のデータ URL だけで、保存も送信もしない。コマが無い時は薄い面に同じ記号を描く。
 */
type Base = { frame?: string; pin?: Pin | null; aspect: number };
type Rect = { left: number; top: number; width: number; height: number };
const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;
const image = (frame?: string): CSSProperties => frame ? { backgroundImage: `url("${frame}")` } : {};
const crop = (frame: string | undefined, o: Origin, scale: number): CSSProperties => ({ ...image(frame), backgroundSize: `${scale * 100}% ${scale * 100}%`, backgroundPosition: `${o.x * 100}% ${o.y * 100}%` });

function Stage({ aspect, className, children }: { aspect: number; className?: string; children: ReactNode }) {
  return <span className="dir-stage"><span className={['dir-frame', className].filter(Boolean).join(' ')} style={{ '--aspect': aspect } as CSSProperties}>{children}</span></span>;
}
const Box = ({ rect, dashed }: { rect: Rect; dashed?: boolean }) => <span className={dashed ? 'dir-crop is-dashed' : 'dir-crop'} style={{ left: pct(rect.left), top: pct(rect.top), width: pct(rect.width), height: pct(rect.height) }}/>;
/** 仕上がりの範囲の外側を 45% 暗くする（範囲の穴をあけた面）。 */
function Dim({ rect }: { rect: Rect }) {
  const l = pct(rect.left), tp = pct(rect.top), r = pct(rect.left + rect.width), b = pct(rect.top + rect.height);
  return <span className="dir-dim" style={{ clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l} ${tp}, ${r} ${tp}, ${r} ${b}, ${l} ${b}, ${l} ${tp})` }}/>;
}
const Mark = ({ at, seed }: { at: Origin; seed: string }) => <span className="dir-pin" style={{ left: pct(at.x), top: pct(at.y) }}><HerePin seed={seed} size={18}/></span>;

/** 構図 2 種と動き 6 種。選んだ 1 枚だけ、選んだ時に 1 回動く（play が変わるたびに 1 回）。 */
export function MotionPreview({ preset, strength, side, frame, pin, aspect, play, reduced }: Base & { preset: DirectionId; strength: SingleDirection['strength']; side?: 'left' | 'right'; play: number; reduced: boolean }) {
  const o = focusOrigin(pin), origin = cropOrigin(preset, o);
  const scale = previewScale(preset, strength);
  const timeline = motionTimeline(preset, strength, side);
  const imageRef = useRef<HTMLSpanElement>(null), blurRef = useRef<HTMLSpanElement>(null), headRef = useRef<HTMLSpanElement>(null), endRef = useRef<HTMLSpanElement>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!play || !timeline) return;
    let animation: Animation | undefined;
    const run = (node: HTMLElement | null, frames: Keyframe[], duration: number) => {
      if (!node) return;
      setRunning(true); animation = node.animate(frames, { duration, fill: 'none' });
      animation.finished.then(() => setRunning(false), () => {});
    };
    if (reduced) { // 動かさず、開始の枠 → 仕上がりの枠を 200ms で切り替えるだけ
      if (timeline.target === 'image') run(endRef.current, [{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .8 }, { opacity: 0 }], 1000);
      else if (timeline.target === 'blur') run(blurRef.current, [{ opacity: 0 }, { opacity: 1 }], 200);
    } else run({ image: imageRef.current, blur: blurRef.current, head: headRef.current }[timeline.target], timeline.frames as Keyframe[], timeline.duration);
    return () => { animation?.cancel(); setRunning(false); };
  }, [play]);

  const transformOrigin = preset === 'pan' ? undefined : `${origin.x * 100}% ${origin.y * 100}%`;
  const last = timeline?.frames.at(-1)?.transform as string | undefined;
  let overlay: ReactNode = null;
  if (preset === 'pan') {
    const { start, end } = panRects(side, strength);
    overlay = <><Dim rect={start}/><Box rect={end} dashed/><Box rect={start}/><Mark at={{ x: start.left + start.width / 2, y: start.top + start.height / 2 }} seed={preset}/></>;
  } else if (scale) {
    const rect = cropRect(origin, scale);
    overlay = <><Dim rect={rect}/>{(preset === 'slow-in' || preset === 'out') && <span className="dir-outer"/>}<Box rect={rect}/><Mark at={{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }} seed={preset}/></>;
  } else if (preset === 'soft-background') {
    overlay = <><span className="dir-ellipse" style={{ left: pct(o.x), top: pct(o.y) }}/><Mark at={o} seed={preset}/></>;
  }
  const bar = preset === 'hold' ? holdBar(strength) : null;
  return <Stage aspect={aspect} className={running ? 'is-running' : undefined}>
    <span ref={imageRef} className="dir-image" style={{ ...image(frame), transformOrigin }}/>
    {preset === 'soft-background' && <span ref={blurRef} className="dir-image dir-blur" style={{ ...image(frame), '--blur': `${blurSize(strength)}cqw`, '--ox': pct(o.x), '--oy': pct(o.y) } as CSSProperties}/>}
    {timeline?.target === 'image' && <span ref={endRef} className="dir-image dir-end" style={{ ...image(frame), transformOrigin, transform: last }}/>}
    <span className="dir-overlay">{overlay}</span>
    {bar && <span className="dir-bar" aria-hidden="true"><span className="dir-track"/><span className="dir-hold" style={{ left: pct(bar.at), width: pct(bar.span) }}/><span className="dir-pause" style={{ left: pct(bar.at) }}/><span ref={headRef} className="dir-head" style={{ transform: 'translateX(-80%)' }}/></span>}
  </Stage>;
}

function Slot({ label, style, lines }: { label: string; style: CSSProperties; lines?: boolean }) {
  return <span className="dir-slot" style={style}><span>{label}</span>{lines && <span className="dir-lines"><i/><i/><i/></span>}</span>;
}
/** 1 コマでは見せられない 5 種は、映像のふりをせず、区画の図にする。コマは「いま見ているもの」として 1 区画だけ。 */
export function LayoutPreview({ preset, frame, pin }: { preset: DirectionId; frame?: string; pin?: Pin | null }) {
  const o = focusOrigin(pin), portrait = preset === 'stack';
  const part = (rect: Rect, scale = 1.6): ReactNode => <span className="dir-region" style={{ left: pct(rect.left), top: pct(rect.top), width: pct(rect.width), height: pct(rect.height), ...crop(frame, o, scale) }}/>;
  const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height });
  return <Stage aspect={portrait ? 9 / 16 : 16 / 9}>
    {preset === 'two' && <>{part(rect(0, 0, .5, 1))}<Slot label={t("もう一人")} style={{ left: '50%', top: 0, width: '50%', height: '100%' }}/></>}
    {preset === 'sides' && <>{part(rect(0, 0, .5, 1), 1)}<Slot label={t("もう一方")} style={{ left: '50%', top: 0, width: '50%', height: '100%' }}/><span className="dir-divider"/></>}
    {preset === 'stack' && <><Slot label={t("資料")} style={{ left: 0, top: 0, width: '100%', height: '50%' }}/>{part(rect(0, .5, 1, .5))}</>}
    {preset === 'overlay' && <><Slot label={t("資料")} style={{ left: 0, top: 0, width: '100%', height: '100%' }}/>{part(rect(.62, .56, .34, .38), 1.4)}</>}
    {preset === 'side-info' && <>{part(rect(0, 0, .55, 1))}<Slot label={t("説明の場所")} lines style={{ left: '55%', top: 0, width: '45%', height: '100%' }}/></>}
  </Stage>;
}
