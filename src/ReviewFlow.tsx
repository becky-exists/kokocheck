import { t, getLocale, errorMessage } from './i18n';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ChevronLeft, ChevronRight, CircleAlert, Pause, Play, X } from 'lucide-react';
import type { Comment, ReviewProject, Version } from '../shared/types';
import { timeLabel } from '../shared/types';
import { decision, mappedTime, restoreDrafts, type ReviewDraft, type ReviewDrafts } from '../shared/review-flow';
import { api, captureFrame, cn, containRect, mediaUrl, post, savedAuthor } from './api';
import { DirectionAssist, DirectionSummary, TempoChips } from './DirectionAssist';
import { HerePin } from './HerePin';
import { commentText } from '../shared/directions';
import { commentBody } from '../shared/review-ui';
import { useVisibleViewport } from './useVisibleViewport';

export function ReviewFlow({ project, version, initialId, onClose, onRefresh, onSend }: {
  project: ReviewProject; version: Version; initialId: string; onClose: () => void;
  onRefresh: () => Promise<void>; onSend: () => void;
}) {
  const viewport = useVisibleViewport(true);
  const changes = version.changes;
  const [index, setIndex] = useState(Math.max(0, changes.findIndex(c => c.commentId === initialId)));
  const [finished, setFinished] = useState(false);
  const [side, setSide] = useState<'before' | 'after'>('after');
  const [playing, setPlaying] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const key = `kokocheck.review-drafts.${project.id}.${version.id}`, legacyKey = `frame.review-drafts.${project.id}.${version.id}`;
  const [drafts, setDrafts] = useState<ReviewDrafts>(() => {
    try { return restoreDrafts(localStorage.getItem(key) ?? localStorage.getItem(legacyKey), version.duration); } catch { return {}; }
  });
  const [surfaces, setSurfaces] = useState({before:{width:0,height:0},after:{width:0,height:0}});
  const [times, setTimes] = useState({ before: 0, after: 0 });
  const [placed, setPlaced] = useState(0);
  const beforeRef = useRef<HTMLVideoElement>(null);
  const afterRef = useRef<HTMLVideoElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{x: number; y: number} | null>(null);
  const change = changes[index];
  const original = project.comments.find(c => c.id === change.commentId);
  const before = project.versions.find(v => v.id === original?.versionId);
  // 動画全体への指示の再修正は、時刻もピンも持たない全体のまま続ける。
  const wholeVideo = original?.scope === 'all';
  const latest = version.id === project.versions.at(-1)?.id;
  const state = decision(project.comments, change.commentId);
  const draft = drafts[change.commentId];
  const editing = !!draft?.editing;
  const followup = [...project.comments].reverse().find(c => c.followupOf === change.commentId);
  const okCount = changes.filter(c => decision(project.comments, c.commentId) === 'ok').length;
  const retryCount = changes.filter(c => decision(project.comments, c.commentId) === 'retry').length;
  const remaining = changes.length - okCount - retryCount;
  const unsaved = Object.values(drafts).filter(d => d.text.trim() || d.pin || d.direction).length;
  const hasLocalDraft = !!(draft?.text.trim() || draft?.pin || draft?.direction);
  const sendCount = project.comments.filter(c => c.versionId === project.versions.at(-1)?.id && c.status === 'draft').length;

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(drafts)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [drafts, key]);
  // 映像の枠は Dialog の中で後から現れるので、ref の付いた時点で大きさを測り始める（丸の位置に必要）。
  const [cells, setCells] = useState<{ before: HTMLElement | null; after: HTMLElement | null }>({ before: null, after: null });
  const beforeCell = useCallback((el: HTMLElement | null) => setCells(c => c.before === el ? c : { ...c, before: el }), []);
  const afterCell = useCallback((el: HTMLElement | null) => setCells(c => c.after === el ? c : { ...c, after: el }), []);
  useEffect(() => {
    const observers = (['before', 'after'] as const).map(which => {
      const element = cells[which];
      if (!element) return null;
      const observer = new ResizeObserver(([entry]) => setSurfaces(s => ({...s,[which]:{width:entry.contentRect.width,height:entry.contentRect.height}})));
      observer.observe(element); return observer;
    });
    return () => observers.forEach(o => o?.disconnect());
  }, [cells]);
  useEffect(() => () => { beforeRef.current?.pause(); afterRef.current?.pause(); }, []);
  function pause() { beforeRef.current?.pause(); afterRef.current?.pause(); setPlaying(false); }
  function close() { if (!busy) { pause(); onClose(); } }
  function navigate(next: number) {
    if (busy || next < 0 || next >= changes.length) return;
    pause(); setIndex(next); setFinished(false); setError(''); setPinning(false); setSide('after');
    bodyRef.current?.scrollTo({ top: 0 });
  }
  function advance() {
    pause(); setPinning(false); setError('');
    if (index + 1 < changes.length) { setIndex(index + 1); setSide('after'); }
    else setFinished(true);
    bodyRef.current?.scrollTo({ top: 0 });
  }
  function editDraft(next: Partial<ReviewDraft>) {
    setDrafts(ds => ({ ...ds, [change.commentId]: { ...(ds[change.commentId] || { text: '', start: change.after?.start ?? 0, end: null, pin: null, editing: true }), ...next } }));
  }
  function clearDraft() { setDrafts(ds => { const next = { ...ds }; delete next[change.commentId]; return next; }); }
  function startRetry() {
    pause(); setSide('after');
    const start = Math.max(0, Math.min(afterRef.current?.currentTime ?? change.after?.start ?? 0, version.duration - .05));
    editDraft(draft ? { editing: true } : { editing: true, start });
    requestAnimationFrame(() => { composerRef.current?.scrollIntoView({block:'start'}); textRef.current?.focus({ preventScroll: true }); });
  }
  async function accept() {
    if (!latest || busy) return;
    if (state === 'ok') { advance(); return; }
    setBusy(true); setError('');
    try {
      await api(`/projects/${project.id}/comments/${change.commentId}`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) });
      clearDraft(); await onRefresh(); advance();
    } catch (e) { setError(e instanceof Error ? e.message : t("保存できませんでした")); }
    finally { setBusy(false); }
  }
  async function saveRetry() {
    if (!draft || !commentText(draft.text, draft.direction, getLocale()) || busy || !latest) return;
    if (draft.end !== null && (!Number.isFinite(draft.end) || draft.end < draft.start || draft.end > version.duration)) { setError(t("終了は開始以降で動画の長さ以内にしてください")); return; }
    pause(); setBusy(true); setError('');
    try {
      await post<Comment>(`/projects/${project.id}/comments`, commentBody({ versionId: version.id, followupOf: change.commentId, start: draft.start, end: draft.end, pin: draft.pin, direction: draft.direction, scope: original?.scope }, commentText(draft.text, draft.direction, getLocale()), savedAuthor() || t("レビュー担当")));
      clearDraft(); await onRefresh(); advance();
    } catch (e) { setError(e instanceof Error ? e.message : t("保存できませんでした")); }
    finally { setBusy(false); }
  }
  async function togglePlay() {
    if (playing) { pause(); return; }
    setError('');
    const items = [{ ref: beforeRef, range: change.before }, { ref: afterRef, range: change.after }];
    for (const {ref, range} of items) if (ref.current && range) ref.current.currentTime = range.start;
    try { await Promise.all(items.filter(i => i.range).map(i => i.ref.current?.play())); setPlaying(true); }
    catch { pause(); setError(t("再生できませんでした。もう一度お試しください。")); }
  }
  function seek(value: number) {
    pause(); const own = side === 'after' ? change.after : change.before;
    const other = side === 'after' ? change.before : change.after;
    const ref = side === 'after' ? afterRef : beforeRef;
    const otherRef = side === 'after' ? beforeRef : afterRef;
    if (ref.current) ref.current.currentTime = value;
    if (own && other && otherRef.current) otherRef.current.currentTime = mappedTime(value, own, other);
  }
  function placePin(event: PointerEvent<HTMLDivElement>) {
    if (!pinning || !editing || side !== 'after' || !afterRef.current || afterRef.current.readyState < 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const bounds = containRect(rect, version.width, version.height);
    const x = (event.clientX - rect.left - bounds.left) / bounds.width;
    const y = (event.clientY - rect.top - bounds.top) / bounds.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    pause(); const start = Math.min(afterRef.current.currentTime, version.duration - .05); editDraft({ pin: { x, y }, start, end: draft?.end !== null && (draft?.end ?? 0) >= start ? draft!.end : null }); setPlaced(n => n + 1); setPinning(false);
  }
  const activeRange = side === 'before' ? change.before : change.after;
  const initialTime = (which: 'before' | 'after') => {
    if (which === 'after' && editing) return draft.start;
    const t = original?.start ?? change.before.start;
    return which === 'before' ? t : change.after ? mappedTime(t, change.before, change.after) : 0;
  };
  return <Dialog.Root open onOpenChange={open => !open && close()}><Dialog.Portal><Dialog.Backdrop className="modal-backdrop"/><Dialog.Popup className={cn("review-flow", editing && !finished && "is-editing")} style={viewport.style} data-compact={viewport.compact || undefined}>
    <header className="flow-header"><Dialog.Title>{t("修正チェック")}</Dialog.Title><div className="flow-pager">{!finished && <button className="icon-button" aria-label={t("前の修正")} disabled={busy || index === 0} onClick={() => navigate(index - 1)}><ChevronLeft size={20}/></button>}<button className="flow-counter text-button" aria-label={t("確認状況を見る")} disabled={busy} onClick={() => { pause(); setFinished(true); }}>{finished ? t("確認状況") : `${index + 1} / ${changes.length}`}</button>{!finished && <button className="icon-button" aria-label={t("次の修正")} disabled={busy || index === changes.length - 1} onClick={() => navigate(index + 1)}><ChevronRight size={20}/></button>}</div><button className="icon-button" onClick={close} aria-label={t("修正チェックを閉じる")} disabled={busy}><X size={20}/></button></header>
    <Dialog.Description className="sr-only">{t("指摘と対応を比較してOKまたは再修正を保存できます")}</Dialog.Description>
    <div className="flow-body" ref={bodyRef} onPointerDown={event => {
      if (event.pointerType !== 'touch' || (event.target as HTMLElement).closest('button,input,textarea,select,video,.flow-video')) return;
      swipe.current = { x: event.clientX, y: event.clientY };
    }} onPointerUp={event => { const start = swipe.current; swipe.current = null; if (!start || finished) return; const dx = event.clientX - start.x, dy = event.clientY - start.y; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) navigate(index + (dx < 0 ? 1 : -1)); }} onPointerCancel={() => { swipe.current = null; }}>
    {finished ? <div className="flow-finish"><h2>{remaining ? t("未確認が残っています") : t("確認しました")}</h2><div className="flow-totals"><span className="flow-status ok">{t("OK {0}件", okCount)}</span><span className="flow-status retry">{t("再修正 {0}件", retryCount)}</span><span className="flow-status">{t("未確認 {0}件", remaining)}</span></div>{unsaved > 0 && <p className="flow-warning">{t("入力中のコメントが{0}件あります", unsaved)}</p>}
      <div className="finish-cards">{changes.map((c,i) => <button key={c.commentId} onClick={() => navigate(i)}><span>{i + 1}. {project.comments.find(x => x.id === c.commentId)?.text || t("修正内容")}</span><span className={cn("flow-status", (drafts[c.commentId]?.editing || drafts[c.commentId]?.text.trim() || drafts[c.commentId]?.pin || drafts[c.commentId]?.direction) ? "retry" : decision(project.comments,c.commentId))}>{(drafts[c.commentId]?.editing || drafts[c.commentId]?.text.trim() || drafts[c.commentId]?.pin || drafts[c.commentId]?.direction) ? t("入力中") : { ok: 'OK', retry: t("再修正"), pending: t("未確認") }[decision(project.comments, c.commentId)]}<ChevronRight size={16}/></span></button>)}</div>
    </div> : <>
      {editing && <form id="flow-retry" ref={composerRef} className="flow-composer" onSubmit={e => {e.preventDefault(); void saveRetry();}}><DirectionAssist value={draft.direction} disabled={busy} capture={() => afterRef.current ? captureFrame(afterRef.current) : Promise.resolve('')} pin={wholeVideo ? null : draft.pin} aspect={version.width / version.height} scope={wholeVideo ? 'all' : 'here'} onChange={direction => editDraft({direction})}/><label htmlFor="flow-comment">{draft.direction ? t("補足（任意）") : t("再修正コメント")}</label><textarea id="flow-comment" ref={textRef} value={draft.text} onChange={e => editDraft({text:e.target.value})} required={!draft.direction} maxLength={4000} rows={3} placeholder={draft.direction ? t("例：この人だけ、もう少しゆっくり") : t("例：顔がもう少し大きく見えるように")} disabled={busy}/>{wholeVideo && <TempoChips value={draft.direction} disabled={busy} onChange={direction => editDraft({direction})}/>}{!wholeVideo && <><div className="flow-pin-tools"><button type="button" className={cn('button secondary compact',pinning && 'active')} aria-pressed={pinning} disabled={busy} onClick={() => { pause(); textRef.current?.blur(); setSide('after'); setPinning(!pinning); if (!pinning) requestAnimationFrame(() => afterRef.current?.parentElement?.scrollIntoView({block:'center'})); }}>{pinning ? t("指すのをやめる") : draft.pin ? t("指し直す") : t("ここを指す")}</button>{pinning && !draft.pin && <button type="button" className="text-button" onClick={() => { editDraft({pin:{x:.5,y:.5}}); setPlaced(n => n + 1); setPinning(false); }}>{t("中央に置く")}</button>}{draft.pin && <button type="button" className="text-button" disabled={busy} onClick={() => editDraft({pin:null})}>{t("ピンを外す")}</button>}<button type="button" className="text-button" disabled={busy} onClick={() => { pause(); editDraft({ start: Math.min(afterRef.current?.currentTime ?? 0,version.duration-.05),end:null }); }}>{t("現在位置を使う")}</button></div>
        <div className="flow-range"><label>{t("開始（秒）")}<input aria-label={t("再修正の開始秒")} type="number" inputMode="decimal" step="any" min="0" max={version.duration-.01} value={Math.round(draft.start*100)/100} required disabled={busy} onChange={e => { const n=e.target.valueAsNumber; if (Number.isFinite(n)) editDraft({start:n}); }}/></label><label><input type="checkbox" checked={draft.end!==null} disabled={busy} onChange={e => editDraft({end:e.target.checked ? Math.min(version.duration,draft.start+3):null})}/>{t("範囲を指定")}</label>{draft.end!==null && <label>{t("終了（秒）")}<input type="number" aria-label={t("再修正の終了秒")} step="any" inputMode="decimal" min={draft.start} max={version.duration} value={draft.end} required disabled={busy} onChange={e => editDraft({end:e.target.valueAsNumber})}/></label>}</div>
        {draft.pin && <div className="flow-pin-tools"><span className="small muted">{t("ピン位置")}</span>{(['x','y'] as const).map(axis => <label key={axis}>{axis==='x'?t("横"):t("縦")} %<input type="number" aria-label={t("再修正のピン{0}位置", axis==='x'?t("横"):t("縦"))} min="0" max="100" value={Math.round(draft.pin![axis]*100)} disabled={busy} onChange={e => editDraft({pin:{...draft.pin!,[axis]:Math.max(0,Math.min(100,e.target.valueAsNumber || 0))/100}})}/></label>)}</div>}
        </>}
        <p className="small muted">{t("カードを移動しても入力は残ります")}</p>
      </form>}
      <div className="flow-reading-status"><span className={cn('flow-status', editing || hasLocalDraft || change.outcome === 'blocked' ? 'retry' : state)}>{editing || hasLocalDraft ? t("入力中") : {ok:'OK',retry:t("再修正"),pending: change.outcome === 'blocked' ? t("要相談") : t("未確認")}[state]}</span><span className="muted small">{t("あと{0}件", remaining)}</span></div>
      <div className="flow-exchange"><div><span className="small-label">{t("前回のコメント")}</span><p>{original?.text || t("元のコメントが見つかりません")}</p><DirectionSummary value={original?.direction} text={original?.text}/></div><div><span className="small-label">{t("修正コメント")}</span><p>{change.summary}</p></div></div>
      <div className="flow-videos">{([{which:'before',v:before,ref:beforeRef,range:change.before},{which:'after',v:version,ref:afterRef,range:change.after}] as const).map(item => {
        const pin = item.which === 'before' && Math.abs(times.before - (original?.start ?? 0)) < .35 ? original?.pin : item.which === 'after' && editing && Math.abs(times.after - draft.start) < .35 ? draft.pin : null;
        // 直した場所の前の丸を、修正後の映像に薄く残す（前の版の痕跡）。
        const trace = item.which === 'after' && original?.pin && change.after && Math.abs(times.after - mappedTime(original.start, change.before, change.after)) < .35 ? original.pin : null;
        return <div key={`${change.commentId}-${item.which}`} className={cn('flow-video-cell', side !== item.which && 'flow-inactive')}><div ref={item.which === 'before' ? beforeCell : afterCell} className={cn('flow-video', pinning && item.which === 'after' && 'pinning')} style={{ '--ratio': item.v ? item.v.width / item.v.height : 16 / 9 } as CSSProperties} onPointerDown={item.which === 'after' ? placePin : undefined}><span className="flow-video-label">{item.which === 'before' ? t("修正前") : t("修正後")}</span>
          {item.v && <video ref={item.ref} src={mediaUrl(project.id,item.v.file)} playsInline preload="auto" muted={side !== item.which} aria-label={item.which === 'before' ? t("修正前の動画") : t("修正後の動画")} onLoadedMetadata={() => { if (item.ref.current) { item.ref.current.currentTime = initialTime(item.which); setTimes(t => ({...t,[item.which]:initialTime(item.which)})); } }} onTimeUpdate={() => { const v = item.ref.current; if (!v) return; setTimes(t => ({...t,[item.which]:v.currentTime})); if (item.range && v.currentTime >= item.range.end) v.pause(); if (beforeRef.current?.paused && afterRef.current?.paused) setPlaying(false); }} onEnded={() => { if (beforeRef.current?.paused && afterRef.current?.paused) setPlaying(false); }} onError={() => setError(t("動画を読み込めませんでした。画面を開き直してください。"))}/>}
          {(pin || trace) && item.v && <div className="flow-pin-layer" style={containRect(surfaces[item.which],item.v.width,item.v.height)}>{trace && <span className="flow-pin" style={{left:`${trace.x*100}%`,top:`${trace.y*100}%`}}><HerePin seed={change.commentId} ghost/></span>}{pin && <span className="flow-pin" style={{left:`${pin.x*100}%`,top:`${pin.y*100}%`}}><HerePin key={item.which === 'after' ? placed : 0} seed={item.which === 'after' ? `${change.commentId}:draft` : change.commentId} draw={item.which === 'after'}/></span>}</div>}
          {pinning && item.which === 'after' && <span className="flow-pin-hint">{t("映像をタップしてピンを置く")}</span>}
        </div></div>;
      })}</div>
      <div className="flow-scrub"><span className="timecode">{timeLabel(times[side])}</span><label className="sr-only" htmlFor="flow-seek">{t("比較の再生位置")}</label><input id="flow-seek" type="range" min={activeRange?.start ?? 0} max={activeRange?.end ?? version.duration} step="0.01" value={Math.max(activeRange?.start ?? 0,Math.min(times[side],activeRange?.end ?? version.duration))} onChange={e => seek(Number(e.target.value))}/></div>

      {!change.after && <p className="flow-warning">{t("修正後の位置は未登録です")}</p>}

      {state === 'retry' && followup && <div className="flow-followup"><span className="small-label">{t("再修正コメント ·")} {followup.status === 'draft' ? t("送信待ち") : t("依頼済み")}</span><p>{followup.text}</p><DirectionSummary value={followup.direction} text={followup.text}/>{followup.pin && <span className="small muted">{t("ピンあり ·")} {timeLabel(followup.start)}</span>}</div>}

      {!latest && <p className="flow-warning">{t("過去の版です。判断や再修正は最新版から行えます。")}</p>}
    </>}
    {storageError && <p className="flow-warning" role="alert">{t("端末に途中保存できません。この画面を閉じる前に保存してください。")}</p>}
    {error && <p className="error" role="alert"><CircleAlert size={16}/>{errorMessage(error)}</p>}
    </div>
    <footer className="flow-footer">{!finished && <div className="flow-controls"><div className="flow-tabs" role="group" aria-label={t("比較する版")}>{(['before','after'] as const).map(x => <button key={x} aria-pressed={side === x} className={cn(side === x && 'selected')} onClick={() => { setSide(x); setPinning(false); }}>{x === 'before' ? t("修正前 · v{0}", before?.number ?? '?') : t("修正後 · v{0}", version.number)}</button>)}</div><button className="flow-play" aria-label={playing ? t("一時停止") : t("この区間を再生")} onClick={() => void togglePlay()} disabled={!change.after || pinning}>{playing ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}</button></div>}<div className="flow-actions">{finished ? <><button className="button secondary" onClick={() => navigate(Math.max(0,changes.findIndex(c => decision(project.comments,c.commentId)==='pending')))}>{t("カードに戻る")}</button><button className="button primary" disabled={!sendCount || !!unsaved || !latest} onClick={() => { pause(); onSend(); }}>{t("再修正を依頼")}</button></> : editing ? <><button className="button plain" disabled={busy} onClick={() => { editDraft({editing:false}); setPinning(false); }}>{t("入力を閉じる")}</button><button className="button primary" type="submit" form="flow-retry" disabled={busy || !commentText(draft.text, draft.direction, getLocale()) || !latest}>{busy ? t("保存中…") : index===changes.length-1 ? t("保存して確認を終える") : t("保存して次へ")}</button></> : <><button className="button secondary" disabled={busy || !latest || state==='retry'} onClick={startRetry}>{state==='retry' ? t("再修正を保存済み") : hasLocalDraft ? t("入力を再開") : t("再修正")}</button><button className="button primary" disabled={busy || hasLocalDraft || (!latest && state!=='ok') || (change.outcome==='blocked' && state!=='retry')} onClick={() => { if(state==='retry'||!latest)advance(); else void accept(); }}>{busy ? t("保存中…") : state==='retry' ? t("次へ") : index===changes.length-1 ? t("OKで確認を終える") : t("OK → 次へ")}</button></>}
    </div></footer>
  </Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
