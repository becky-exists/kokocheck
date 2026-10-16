import { t, getLocale } from './i18n';
import { useEffect, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Check, ChevronRight, Play, X } from 'lucide-react';
import { directionPresets, directionPreset, directionLabel, strengthLabels, directionBundle, directionCount, directionForScope, isGlobalDirection, captionPresetList, captionPreset, speedFactor, tempoIds, tempoLabels, tempoOf, tempoRules, strengthOfTempoId, bookendIds, slotKeys, type Direction, type DirectionBundle, type DirectionId, type Caption, type SingleDirection, type SlotKey, type Tempo } from '../shared/directions';
import { isBand, isDiagram } from '../shared/direction-preview';
import type { Pin } from '../shared/types';
import { cn } from './api';
import { CaptionPreview } from './CaptionPreview';
import { LayoutPreview, MotionPreview } from './DirectionPreview';
import { TimeBand } from './TimeBand';
import { useVisibleViewport } from './useVisibleViewport';

export function DirectionSummary({ value, text }: { value?: Direction | null; text?: string }) {
  return value && text !== directionLabel(value, getLocale()) ? <span className="direction-summary">{directionLabel(value, getLocale())}</span> : null;
}

/** カード1枚。preset = 「ここ」のスロットに入るもの、caption = テロップ、global = 全体向けの6つ。 */
type Item = { key: string; id: string; type: 'preset' | 'caption' | 'global'; group: string; label: string; hint: string; common: boolean };
const groups = [['shot', '構図・動き'], ['layout', '画面の組み方'], ['caption', 'テロップ'], ['sound', '音'], ['cut', 'つなぎ'], ['bookend', '冒頭と締め']] as const;
const hereItems: Item[] = [
  ...directionPresets.filter(p => !('retired' in p)).map(p => ({ key: p.id, id: p.id, type: 'preset' as const, group: p.group, label: p.label, hint: p.hint, common: 'common' in p })),
  ...captionPresetList.filter(p => !p.retired).map(p => ({ key: `caption-${p.id}`, id: p.id, type: 'caption' as const, group: 'caption', label: p.label, hint: p.hint, common: !!p.common })),
];
/** 全体向けの6つ（畳み無し）。後ろの4つは「ここ」の冒頭と締めと同じもの。 */
const allItems: Item[] = [
  { key: 'captionAll', id: 'captionAll', type: 'global', group: 'all', label: captionPreset('plain').label, hint: captionPreset('plain').hint, common: true },
  { key: 'voiceFirst', id: 'voiceFirst', type: 'global', group: 'all', label: '声を聞かせる', hint: 'BGMを控えめに', common: true },
  ...bookendIds.map(id => ({ key: id, id, type: 'global' as const, group: 'all', label: directionPreset(id).label, hint: directionPreset(id).hint, common: true })),
];
const orderOf = (items: Item[]) => [...items.filter(i => i.common), ...items.filter(i => !i.common)];
const commonItems = orderOf(hereItems).filter(i => i.common);
const strengthSubtitle = { size: '寄り引きの大きさ', hold: '止める長さ', blur: 'ぼかしの強さ', pan: '動かす幅', speed: '速さの変え方', sound: '音の大きさ', tempo: '詰める強さ' } as const;

function withTempo(value: Direction | null | undefined, tempo: Tempo | undefined): DirectionBundle | null {
  const base: DirectionBundle = value && 'version' in value && isGlobalDirection(value) ? { ...directionBundle(value), version: 3 } : { version: 3 };
  if (tempo) base.tempo = tempo; else delete base.tempo;
  return Object.keys(base).length > 1 ? base : null;
}
/** 「全体」の時だけ入力欄の下に出る、テンポの3つ。任意（押さなくても文章だけで依頼できる）。 */
export function TempoChips({ value, onChange, disabled = false }: { value?: Direction | null; onChange: (value: Direction | null) => void; disabled?: boolean }) {
  const tempo = value && 'version' in value ? value.tempo : undefined;
  const rule = tempo && tempoRules[tempo];
  return <div className="tempo-chips"><div className="direction-options" role="group" aria-label={t("テンポ")}>{tempoIds.map(id => <button type="button" key={id} aria-pressed={tempo === id} disabled={disabled} onClick={() => onChange(withTempo(value, tempo === id ? undefined : id))}>{t(tempoLabels[id])}</button>)}</div>{rule && <p className="tempo-note">{t("{0}秒より長い間を{1}秒に、同じ画角は{2}秒まで。目安です。", rule.from, rule.to, rule.shot)}</p>}</div>;
}

/**
 * 演出の見本は、いま止めているコマ（frame）の上に描くイメージ。コマは画面の中だけで使い、保存も送信もしない。
 * frame が無ければ capture で取る。取れなければ薄い面に同じ記号を描く。
 * scope='all' の時は全体向けの6つだけを出す（時刻もピンも持たない）。at は「ここ」の時の、動画の長さに対する今の時刻の位置（0〜1）。
 */
export function DirectionAssist({ value, onChange, disabled = false, frame, capture, pin, aspect, scope = 'here', at }: { value?: Direction | null; onChange: (value: Direction | null) => void; disabled?: boolean; frame?: string; capture?: () => Promise<string>; pin?: Pin | null; aspect: number; scope?: 'here' | 'all'; at?: number }) {
  const all = scope === 'all';
  const [open, setOpen] = useState(false);
  const viewport = useVisibleViewport(open);
  const start = (d?: Direction | null) => (all ? directionForScope(d, 'all') : null) ?? directionBundle(all ? null : d);
  const [choice, setChoice] = useState<DirectionBundle>(() => start(value));
  const [focus, setFocus] = useState<SlotKey | null>(null);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [shot, setShot] = useState(frame ?? '');
  const [play, setPlay] = useState({ id: '', n: 0 });
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(preference.matches);
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!open) return;
    if (frame) { setShot(frame); return; }
    let live = true; void capture?.().then(s => { if (live) setShot(s); });
    return () => { live = false; };
  }, [open, frame]);

  const count = directionCount(choice);
  const items = all ? allItems : orderOf(hereItems);
  const first = all ? items : items.filter(i => i.common);
  const rest = all ? [] : items.filter(i => !i.common);
  const slotOf = (item: Item): SlotKey => item.type === 'caption' ? 'caption' : directionPreset(item.id as DirectionId).slot;
  const picked = (item: Item) => item.type === 'caption' ? choice.caption?.preset === item.id : item.type === 'global' ? (item.id === 'captionAll' ? !!choice.captionAll : item.id === 'voiceFirst' ? !!choice.voiceFirst : !!choice.openClose?.includes(item.id as typeof bookendIds[number])) : choice[slotOf(item)]?.preset === item.id;
  const single = focus && focus !== 'caption' ? choice[focus] : undefined;
  const replay = (id: string) => setPlay(p => ({ id, n: p.n + 1 }));
  function remove(key: SlotKey) { setChoice(prev => { const next = { ...prev }; delete next[key]; return next; }); setFocus(f => f === key ? null : f); }
  function select(item: Item) {
    if (item.type === 'global') {
      setChoice(prev => {
        const next = { ...prev };
        if (item.id === 'captionAll' || item.id === 'voiceFirst') { if (next[item.id]) delete next[item.id]; else next[item.id] = true; }
        else { const id = item.id as typeof bookendIds[number], marks = next.openClose ?? []; const kept = marks.includes(id) ? marks.filter(m => m !== id) : [...marks, id]; if (kept.length) next.openClose = kept; else delete next.openClose; }
        return next;
      });
      replay(item.id); return;
    }
    const slot = slotOf(item);
    if (picked(item)) { remove(slot); return; }
    if (item.type === 'caption') setChoice({ ...choice, caption: { preset: item.id as Caption['preset'], text: choice.caption?.text || '' } });
    else {
      const p = directionPreset(item.id as DirectionId), before = choice[slot as Exclude<SlotKey, 'caption'>];
      const strength = before && directionPreset(before.preset).kind === p.kind ? before.strength : 'normal';
      setChoice({ ...choice, [slot]: { preset: p.id, strength, ...(p.kind === 'speed' ? { mode: 'slow' } : {}) } });
    }
    setFocus(slot); replay(item.id);
  }
  const labelOf = (key: SlotKey) => key === 'caption' ? captionPreset(choice.caption!.preset).label : directionPreset(choice[key]!.preset).label;
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...slotKeys.filter(key => choice[key]).map(key => ({ key, label: labelOf(key), remove: () => remove(key) })),
    ...(choice.captionAll ? [{ key: 'captionAll', label: captionPreset('plain').label, remove: () => select(allItems[0]) }] : []),
    ...(choice.voiceFirst ? [{ key: 'voiceFirst', label: '声を聞かせる', remove: () => select(allItems[1]) }] : []),
    ...(choice.openClose ?? []).map(id => ({ key: id, label: directionPreset(id).label, remove: () => select(allItems.find(i => i.id === id)!) })),
  ];
  const apply = () => {
    const keep = count ? choice : all && choice.tempo ? { version: 3 as const, tempo: choice.tempo } : null;
    onChange(keep ? { ...keep, version: 3 } : null); setOpen(false);
  };
  function card(item: Item) {
    const on = picked(item), isAttention = item.id === 'insert';
    const sel = on && item.type === 'preset' ? choice[slotOf(item) as Exclude<SlotKey, 'caption'>] : undefined;
    const running = on && play.id === item.id ? play.n : 0;
    const bandId = item.type === 'global' ? (item.id === 'voiceFirst' ? 'bgm-duck' : item.id) : item.id;
    const diagram = item.type === 'preset' && isDiagram(item.id), band = item.type !== 'caption' && !(item.id === 'captionAll') && isBand(bandId);
    const preview = item.type === 'caption' || item.id === 'captionAll'
      ? <CaptionPreview preset={(item.id === 'captionAll' ? 'plain' : item.id) as Caption['preset']} text={choice.caption?.text} frame={shot} aspect={aspect} play={running} reduced={reduced}/>
      : band ? <TimeBand preset={bandId} strength={sel?.strength} mode={sel?.mode} frame={shot} pin={pin} aspect={aspect} at={all ? undefined : at} play={running} reduced={reduced}/>
      : diagram ? <LayoutPreview preset={item.id as DirectionId} frame={shot} pin={pin}/>
      : <MotionPreview preset={item.id as DirectionId} strength={sel?.strength || 'normal'} side={sel?.side || 'right'} frame={shot} pin={pin} aspect={aspect} play={running} reduced={reduced}/>;
    return <div className="direction-cell" key={item.key}>
      <button type="button" className={cn('direction-card', on && 'selected')} aria-pressed={on} onClick={() => select(item)}>
        {preview}
        <span className="direction-card-title">{t(item.label)}{on && <Check size={15}/>}</span><span className={cn('direction-hint', isAttention && 'is-attention')}>{t(item.hint)}</span>
      </button>
      {on && !diagram && (!band || item.id === 'tighten') && <button type="button" className="dir-replay" aria-label={t("もう一度見る")} onClick={() => replay(item.id)}><Play size={14} fill="currentColor"/></button>}
    </div>;
  }
  const attached = value ? directionLabel(value, getLocale(), { tempo: false }) : '';
  const attachedValue = all && value && 'version' in value && value.tempo ? { version: 3 as const, tempo: value.tempo } : null;
  return <div className="direction-assist">
    <Dialog.Root open={open} onOpenChange={next => { if (next) { setChoice(start(value)); setFocus(null); } setOpen(next); }}>
      <Dialog.Trigger type="button" className="direction-trigger" disabled={disabled}>{attached ? t("演出を変更") : t("演出を選ぶ")}<ChevronRight size={16}/></Dialog.Trigger>
      <Dialog.Portal><Dialog.Backdrop className="modal-backdrop"/><Dialog.Popup className="direction-dialog" style={viewport.style} data-compact={viewport.compact || undefined}>
        <header className="direction-header"><Dialog.Title>{t("演出")}</Dialog.Title><Dialog.Close className="icon-button" aria-label={t("演出選びを閉じる")}><X size={20}/></Dialog.Close></header>
        <div className="direction-body">
          <div className="direction-scroll">
            <div className="direction-notice"><p>{t("あなたのコマで描いたイメージです。仕上がりそのものではありません。")}</p>{!all && <p>{pin ? t("寄り先: ピンの位置") : t("寄り先: 中央（ピンを置くと変えられます）")}</p>}</div>
            <div className="direction-grid" role="group" aria-label={t("よく使う演出")}>{first.map(card)}</div>
            {rest.length > 0 && <details className="dir-more"><summary><span>{t("ほかの演出 {0}", rest.length)}</span><ChevronRight size={16}/></summary>
              <div className="dir-groups">{groups.map(([id, name]) => { const inGroup = rest.filter(i => i.group === id), n = inGroup.filter(picked).length;
                return <details name="direction-group" className="dir-group" key={id}><summary><span>{t(name)}</span>{n > 0 && <span className="dir-count">{n}</span>}<ChevronRight size={16}/></summary><div className="direction-grid" role="group" aria-label={t("{0}の見本", t(name))}>{inGroup.map(card)}</div></details>; })}</div>
            </details>}
          </div>
          <div className="direction-settings">
            {choice.caption && !all && <label className="direction-caption-field">{t("入れたい言葉（任意）")}<input value={choice.caption.text || ''} maxLength={120} placeholder={t("空欄なら今のテロップの文言")} onChange={e => setChoice({ ...choice, caption: { ...choice.caption!, text: e.target.value } })}/>{Array.from(choice.caption.text || '').length > 40 && <span className="small muted">{t("見本では長い文言を一部省略します")}</span>}</label>}
            {single && focus && focus !== 'caption' && strengthPanel(single, focus)}
            {chips.length > 0 ? <div className="direction-picked" aria-label={t("組み合わせた演出")}>{chips.map(chip => <button type="button" key={chip.key} aria-label={t("{0}の選択を外す", t(chip.label))} onClick={chip.remove}><span>{t(chip.label)}</span><X size={13}/></button>)}</div> : <p className="muted small">{t("見本を押して選べます")}</p>}
          </div>
        </div>
        <footer className="direction-footer">
          <button type="button" className="button primary full-width" disabled={!count && !value} onClick={apply}>{count ? t("{0}つの演出を追加", count) : value ? t("演出を外す") : t("演出を選んで追加")}</button>
          {!all && <p className="direction-footnote">{t("時間・ピン・補足と一緒に伝わります")}</p>}
        </footer>
      </Dialog.Popup></Dialog.Portal>
    </Dialog.Root>
    {attached && <div className="direction-attached"><span className="direction-summary">{attached}</span><button type="button" className="icon-button" disabled={disabled} aria-label={t("選んだ演出を外す")} onClick={() => onChange(attachedValue)}><X size={16}/></button></div>}
  </div>;

  function strengthPanel(d: SingleDirection, slot: Exclude<SlotKey, 'caption'>) {
    const p = directionPreset(d.preset);
    if (p.kind === 'none') return null;
    const set = (patch: Partial<SingleDirection>) => { setChoice({ ...choice, [slot]: { ...d, ...patch } }); replay(p.id); };
    const options = p.kind === 'tempo' ? tempoIds.map(id => ({ strength: strengthOfTempoId(id), text: t(tempoLabels[id]) })) : (['subtle', 'normal', 'strong'] as const).map(strength => ({ strength, text: p.kind === 'speed' ? `${speedFactor({ strength, mode: d.mode })}×` : t(strengthLabels[strength]) }));
    return <>
      <div className="direction-selection"><strong>{t(p.label)}</strong><span>{t(strengthSubtitle[p.kind])}</span></div>
      {p.kind === 'speed' && <div className="direction-options" role="group" aria-label={t("速さの向き")}>{(['slow', 'fast'] as const).map(mode => <button type="button" key={mode} aria-pressed={(d.mode ?? 'slow') === mode} onClick={() => set({ mode })}>{mode === 'slow' ? t("遅く") : t("速く")}</button>)}</div>}
      <div className="direction-options" role="group" aria-label={t("演出の強さ")}>{options.map(o => <button type="button" key={o.strength} aria-pressed={d.strength === o.strength} onClick={() => set({ strength: o.strength })}>{o.text}</button>)}</div>
      {p.kind === 'tempo' && <p className="tempo-note">{t("{0}秒より長い間を{1}秒に、同じ画角は{2}秒まで。目安です。", tempoRules[tempoOf(d)].from, tempoRules[tempoOf(d)].to, tempoRules[tempoOf(d)].shot)}</p>}
      {p.kind === 'pan' && <div className="direction-options" role="group" aria-label={t("動かす方向")}>{(['left', 'right'] as const).map(side => <button type="button" key={side} aria-pressed={(d.side || 'right') === side} onClick={() => set({ side })}>{side === 'left' ? t("左へ") : t("右へ")}</button>)}</div>}
    </>;
  }
}
