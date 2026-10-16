import { t, getLocale } from './i18n';
import { useEffect, useRef, type CSSProperties } from 'react';
import type { Caption } from '../shared/directions';

/**
 * 字幕の見本。いま止めているコマの上に、実際の画面幅に対する比率（cqw）で載せる。
 * 字幕が顔や資料を隠さないかが、そのコマで分かる。一覧は完成形の止め絵で、選んだ 1 枚だけ 1 回動く。
 * 見本の文言は入力した文言ではない（保存も送信もしない）。
 */
const yellow = '#ffc857';
export function CaptionPreview({ preset, text, frame, aspect, play, reduced }: { preset: Caption['preset']; text?: string; frame?: string; aspect: number; play: number; reduced: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const isCard = preset === 'question-card';
  const custom = text?.trim();
  const fullText = custom || (isCard ? t("質問がここに入ります") : t("ここに字幕が入ります"));
  const content = Array.from(fullText).length > 40 ? Array.from(fullText).slice(0, 39).join('') + '…' : fullText;
  // 長い文言も、意味のある語句で区切って全文を読める形で出す。
  const phrases: string[] = [];
  for (const { segment } of new Intl.Segmenter(getLocale(), { granularity: 'word' }).segment(content)) {
    if (phrases.length && Array.from(phrases.at(-1)! + segment).length <= 5) phrases[phrases.length - 1] += segment;
    else phrases.push(segment);
  }
  const defaults = getLocale() === 'ja' ? ['ここに', '字幕が', '入ります'] : ['Your caption', 'goes here'];
  const chunks = preset === 'reaction' && !custom ? [t("ここに一言")] : !custom && !isCard ? defaults : phrases;
  // 完成形（止め絵）。highlight は 2 つ目、karaoke は 1 つ目まで色が付いた形。
  const painted = (i: number) => (preset === 'highlight' && i === 1) || (preset === 'karaoke' && i === 0);

  useEffect(() => {
    const node = root.current;
    if (!play || !node) return;
    const spans = [...node.querySelectorAll<HTMLElement>('.cap')], box = node.querySelector<HTMLElement>('.caption-text')!;
    const animations: Animation[] = [];
    const go = (el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => animations.push(el.animate(frames, { fill: 'backwards', ...options }));
    if (reduced) go(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    else if (preset === 'words') spans.forEach((el, i) => go(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: i * 500 }));
    else if (preset === 'karaoke') spans.forEach((el, i) => go(el, [{ backgroundPosition: '100% 0' }, { backgroundPosition: '0 0' }], { duration: 500, delay: i * 550 }));
    else if (preset === 'reaction') go(box, [{ transform: 'rotate(-6deg) scale(.6)' }, { transform: 'rotate(-6deg) scale(1.06)', offset: .6 }, { transform: 'rotate(-6deg) scale(1)' }], { duration: 220 });
    else if (isCard) go(box, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
    else if (preset === 'highlight') spans.forEach((el, i) => i === 1 && go(el, [{ color: '#fff' }, { color: yellow }], { duration: 400, delay: 300 }));
    else go(box, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    return () => animations.forEach(a => a.cancel());
  }, [play]);

  return <span className="dir-stage"><span ref={root} className={`dir-frame caption-preview caption-${preset}`} style={{ '--aspect': aspect } as CSSProperties} aria-hidden="true">
    <span className="dir-image" style={frame ? { backgroundImage: `url("${frame}")` } : undefined}/>
    <span className="caption-text" key={content}>{chunks.map((part, i) => <span className={`cap${preset === 'karaoke' ? ' is-karaoke' : ''}`} key={i} style={preset === 'karaoke' ? { backgroundPosition: painted(i) ? '0 0' : '100% 0' } : painted(i) ? { color: yellow } : undefined}>{part}</span>)}</span>
  </span></span>;
}
