import { t, getLocale, useLocale, LanguageSwitch, errorMessage } from './i18n';
import { useEffect, useRef, useState, useCallback, type ReactNode, type PointerEvent } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CornerDownRight, Link, LoaderCircle, Pause, Play, Scissors, SkipBack, SkipForward, Upload, Volume2, VolumeX, X } from 'lucide-react';
import type { ProjectCard, ReviewProject, Version, Comment, Pin, Change, RequestNotification } from '../shared/types';
import { timeLabel, mergeRanges } from '../shared/types';
import { api, post, cn, mediaUrl, containRect, captureFrame, savedAuthor } from './api';
import { ReviewFlow } from './ReviewFlow';
import { DirectionAssist, DirectionSummary, TempoChips } from './DirectionAssist';
import { HerePin } from './HerePin';
import { commentText, directionForScope, type Direction } from '../shared/directions';
import { decision } from '../shared/review-flow';
import { commentActions, commentBody, dockAction, notificationCard, primaryAction, showByline, showFilter, statusMark, toolbarTones } from '../shared/review-ui';
import { relativeTime } from '../shared/relative-time';
import { plainSnapshotName } from '../shared/frame';

/** 高さ 24px 専用のロゴ（小さい用）。暗いテーマでは暗い用に切り替わる。 */
function Brand() { return <a className="brand" href="/" aria-label={t("KokoCheck ホーム")}><picture><source media="(prefers-color-scheme: dark)" srcSet="/kokocheck-lockup-small-dark.svg"/><img src="/kokocheck-lockup-small-light.svg" alt="KokoCheck" width="159" height="24"/></picture></a>; }
function ErrorMessage({ children }: { children: ReactNode }) { return children ? <p className="error" role="alert"><CircleAlert size={16}/>{typeof children === 'string' ? errorMessage(children) : children}</p> : null; }
function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  return <Dialog.Root open={open} onOpenChange={o => !o && onClose()}><Dialog.Portal><Dialog.Backdrop className="modal-backdrop"/><Dialog.Popup className={cn('modal', wide && 'modal-wide')}><div className="modal-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="icon-button" aria-label={t("閉じる")}><X size={20}/></Dialog.Close></div>{children}</Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
/** 通知の結果は見出し1行と、理由か次の手を1文まで。届かなかった時だけ、押せるボタンを2つ出す。 */
function NotificationNotice({ notification, onResend, onCancel }: { notification: RequestNotification; onResend?: () => void; onCancel?: () => void }) {
  const card = notificationCard(notification.state, notification.provider === 'claude' ? 'Claude Code' : 'Codex');
  return <div className="notice" role="status"><div className="notice-head">{card.attention && <CircleAlert size={18}/>}<div><strong>{t(card.title)}</strong><p className={cn(card.attention && !card.actions.length && 'attention')}>{t(card.description, ...card.values)}</p></div></div>{card.actions.length > 0 && onResend && onCancel && <div className="notice-actions"><button className="button primary" onClick={onResend}>{t("もう一度知らせる")}</button><button className="button danger" onClick={onCancel}>{t("依頼を取り消す")}</button></div>}</div>;
}
const errorText = (e: unknown) => e instanceof Error ? e.message : t("処理に失敗しました。");
async function copyLink(url: string) { await navigator.clipboard.writeText(url); }
const newSeed = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function App() {
  useLocale();
  const match = location.pathname.match(/^\/r\/([a-z0-9-]+)$/);
  return match ? <Review id={match[1]}/> : <Library/>;
}

function Library() {
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [login, setLogin] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const load = useCallback(async (append = false, offset = 0) => {
    const result = await api<{ projects: ProjectCard[]; hasMore: boolean }>(`/projects?offset=${offset}`);
    setProjects(p => append ? [...p, ...result.projects] : result.projects); setHasMore(result.hasMore); setLogin(false);
  }, []);
  useEffect(() => { void (async () => { try { await post('/local-session', {}).catch(() => {}); await load(); } catch (e) { setLogin(true); setError(errorText(e)); } finally { setLoading(false); } })(); }, [load]);
  async function create() {
    if (!file || !title.trim()) return;
    setBusy(true); setUploadError('');
    const body = new FormData(); body.append('video', file); body.append('title', title.trim()); body.append('mode', 'mp4');
    try { const result = await api<{ reviewUrl: string }>('/projects', { method: 'POST', body }); location.assign(result.reviewUrl); }
    catch (e) { setUploadError(errorText(e)); setBusy(false); }
  }
  const displayed = projects.filter(p => p.title.toLowerCase().includes(query.toLowerCase()));
  const openUpload = () => { setUploadError(''); setUploadOpen(true); };
  return <div className="app"><header className="topbar"><Brand/><LanguageSwitch/></header><main className="library">
    <div className="library-heading"><h1>{t("レビュー")}</h1>{!login && (projects.length > 0 || query) && <div className="library-tools"><input className="search-input" aria-label={t("動画を検索")} placeholder={t("動画を検索")} value={query} onChange={e => setQuery(e.target.value)}/><button className="button primary" onClick={openUpload} disabled={loading}>{t("動画を取り込む")}</button></div>}</div>
    {login ? <form className="login-panel" onSubmit={e => { e.preventDefault(); setError(''); void post('/login', { token: adminKey }).then(() => load()).catch(e => setError(errorText(e))); }}><h2>{t("制作側としてログイン")}</h2><p className="muted">{t("共有リンクをお持ちの場合は、そのリンクからレビューを開けます。")}</p><label>{t("管理キー")}<input type="password" autoComplete="current-password" value={adminKey} onChange={e => setAdminKey(e.target.value)} required/></label><ErrorMessage>{error}</ErrorMessage><button className="button primary">{t("ログイン")}</button></form> : <>
      {loading ? <div className="skeleton-grid" aria-label={t("読み込み中")} aria-busy="true">{[1,2,3].map(n => <div className="skeleton-card" key={n}/>)}</div> : displayed.length ? <div className="project-grid">{displayed.map(p => {
        const key = new URLSearchParams(new URL(p.reviewUrl).hash.slice(1)).get('key') || '';
        return <article className="project-card" key={p.id}><a href={p.reviewUrl} className="project-cover"><img src={mediaUrl(p.id, p.latest.poster, key)} alt=""/><span className="cover-play"><Play size={24} fill="currentColor"/></span><span className="duration-badge">{timeLabel(p.latest.duration)}</span><span className="version-badge">v{p.latest.number}</span></a><div className="project-info"><span className="small-label">{p.mode === 'source' ? t("生成元と接続") : 'MP4'} · {new Date(p.updatedAt).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' })}</span><h3><a href={p.reviewUrl}>{p.title}</a></h3><div className="project-bottom"><span>{p.comments ? t("{0}件の指摘", p.comments) : t("レビューをはじめる")}</span><button className="icon-button" aria-label={t("{0}のリンクをコピー", p.title)} onClick={() => void copyLink(p.reviewUrl).then(() => setCopied(p.id)).catch(e => setError(errorText(e)))}>{copied === p.id ? <Check size={18}/> : <Link size={18}/>}</button></div></div></article>;
      })}</div> : query ? <div className="empty-state"><p>{t("該当する動画がありません")}</p></div> : <div className="empty-state"><p>{t("MP4 を入れるとレビューを始められます。")}</p><button className="button primary" onClick={openUpload}>{t("MP4 を取り込む")}</button></div>}
      {hasMore && <button className="button secondary" onClick={() => void load(true, projects.length).catch(e => setError(errorText(e)))}>{t("もっと見る")}</button>}<ErrorMessage>{error}</ErrorMessage>
    </>}
  </main>
  <Modal open={uploadOpen} onClose={() => !busy && setUploadOpen(false)} title={t("動画を取り込む")}><Dialog.Description className="muted">{t("取り込みが終わると、レビュー用のリンクができます。")}</Dialog.Description><form onSubmit={e => { e.preventDefault(); void create(); }}>
    <label className={cn('upload-zone', file && 'has-file')}><Upload size={28}/><strong>{file ? file.name : t("MP4ファイルを選ぶ")}</strong><span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : t("H.264 / AAC · 最大512MB・2時間")}</span><input type="file" accept="video/mp4,.mp4" aria-label={t("動画ファイル")} disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); if (!title) setTitle(f.name.replace(/\.mp4$/i, '')); } }}/></label>
    <label>{t("動画の名前")}<input autoComplete="off" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder={t("例：プロダクト紹介 — 第1稿")} required disabled={busy}/></label><ErrorMessage>{uploadError}</ErrorMessage><button className="button primary full-width" disabled={!file || !title.trim() || busy}>{busy ? <><LoaderCircle size={18}/>{t("取り込み中…")}</> : t("レビューを作成")}</button>
  </form></Modal></div>;
}

type Draft = { direction?: Direction | null; scope?: 'all'; versionId: string; start: number; end: number | null; pin: Pin | null; followupOf: string | null; seed: string };

function Review({ id }: { id: string }) {
  const [project, setProject] = useState<ReviewProject | null>(null);
  const [error, setError] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [author, setAuthor] = useState(() => savedAuthor() || t("レビュー担当"));
  const [busy, setBusy] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [composeError, setComposeError] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [target, setTarget] = useState<'any' | 'codex' | 'claude'>('any');
  const [compare, setCompare] = useState<{ version: Version; change: Change } | null>(null);
  const [copied, setCopied] = useState(false);
  const [playlist, setPlaylist] = useState<{ start: number; end: number }[]>([]);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [draftImage, setDraftImage] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toast, setToast] = useState('');
  // 最後に見た最新版。これより新しい版が届いても、自動では切り替えず、バナーで知らせる。
  const [ack, setAck] = useState<string | null>(null);
  const [freshId, setFreshId] = useState('');
  const [sent, setSent] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const load = useCallback(async () => { const p = await api<ReviewProject>(`/projects/${id}`); setProject(p); }, [id]);
  useEffect(() => { void load().catch(e => setError(errorText(e))); const timer = setInterval(() => { if (!document.hidden) void load().catch(e => setError(errorText(e))); }, 6000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (project && !ack) setAck(project.versions.at(-1)!.id); }, [project, ack]);
  const version = project?.versions.find(v => v.id === (selectedVersion ?? ack)) || project?.versions.at(-1);
  const lastVersionId = project?.versions.at(-1)?.id;
  const arrivedId = version && lastVersionId && lastVersionId !== ack && version.id !== lastVersionId ? lastVersionId : null;
  useEffect(() => { const base = document.title.replace(/^● /, ''); document.title = arrivedId ? `● ${base}` : base; return () => { document.title = base; }; }, [arrivedId]);
  const latest = version?.id === project?.versions.at(-1)?.id;
  useEffect(() => {
    if (!surfaceRef.current || !version) return;
    const observer = new ResizeObserver(entries => { const box = entries[0].contentRect; setBounds(containRect(box, version.width, version.height)); });
    observer.observe(surfaceRef.current); return () => observer.disconnect();
  }, [version?.id]);
  useEffect(() => { setTime(0); setPlaying(false); setPlaylist([]); if (videoRef.current) videoRef.current.playbackRate = speed; }, [version?.id]);
  function seek(t: number) { if (videoRef.current) { videoRef.current.currentTime = t; setTime(t); } }
  async function togglePlay() { if (!videoRef.current) return; if (videoRef.current.paused) { try { await videoRef.current.play(); } catch { setError(t("再生できません。動画形式を確認してください。")); } } else videoRef.current.pause(); }
  function beginComment(pin: Pin | null = null, followupOf: string | null = null, direction: Direction | null = null, scope?: 'all') {
    if (!version || !latest) return;
    videoRef.current?.pause(); setPlaylist([]); setComposeError(''); setHistoryOpen(true);
    const start = Math.min(videoRef.current?.currentTime ?? time, Math.max(0, version.duration - 0.05));
    setSelectedVersion(version.id);
    const video = videoRef.current;
    setDraftImage('');
    if (video) void captureFrame(video).then(setDraftImage);
    setDraft({ versionId: version.id, start, end: null, pin, followupOf, direction, scope, seed: newSeed() }); setPinning(false);
    requestAnimationFrame(() => { textRef.current?.focus({ preventScroll: true }); if (innerWidth < 1000) sidebarRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' }); });
  }
  // 「ここ」と「全体」を行き来する。持ち越せない演出（冒頭と締め以外）は外れる。
  function setScope(next: 'here' | 'all') {
    if (!draft || (draft.scope === 'all') === (next === 'all')) return;
    setPinning(false); setDraft({ ...draft, scope: next === 'all' ? 'all' : undefined, direction: directionForScope(draft.direction, next) });
  }
  function placePinAt(pin: Pin) {
    if (draft) { setDraft({ ...draft, pin, ...(draft.scope === 'all' ? { scope: undefined, direction: directionForScope(draft.direction, 'here') } : {}), seed: newSeed() }); setPinning(false); textRef.current?.focus({ preventScroll: true }); }
    else beginComment(pin);
  }
  function placePin(event: PointerEvent<HTMLDivElement>) {
    if (!pinning || !version || !surfaceRef.current || bounds.width === 0 || (event.target as HTMLElement).closest('button')) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left - bounds.left) / bounds.width, y = (event.clientY - rect.top - bounds.top) / bounds.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    placePinAt({ x, y });
  }
  async function saveComment() {
    if (!draft || !version) return;
    setBusy(true); setComposeError('');
    try {
      localStorage.setItem('kokocheck.author', author);
      const c = await post<Comment>(`/projects/${id}/comments`, commentBody(draft, commentText(text, draft.direction, getLocale()), author));
      setDraft(null); setText(''); setSelected(c.id); setPinning(false); setFreshId(c.id); setTimeout(() => setFreshId(''), 900); await load();
    } catch (e) { setComposeError(errorText(e)); } finally { setBusy(false); }
  }
  function selectComment(c: Comment) { if (draft) { setComposeError(t("先にコメントを保存してください。")); return; } setSelected(c.id); setPlaylist([]); videoRef.current?.pause(); if (version?.id !== c.versionId) { pendingSeek.current = c.start; setSelectedVersion(c.versionId); } else seek(c.start); }
  function onTimeUpdate() {
    const current = videoRef.current?.currentTime ?? 0; setTime(current);
    const segment = playlist[playlistIndex];
    if (segment && current >= segment.end - 0.04) {
      if (playlistIndex + 1 < playlist.length) { setPlaylistIndex(playlistIndex + 1); seek(playlist[playlistIndex + 1].start); }
      else { videoRef.current?.pause(); setPlaylist([]); setPlaylistIndex(0); }
    }
  }
  async function changedOnly() {
    if (!version) return;
    const ranges = mergeRanges(version.changes.filter(c => c.outcome === 'addressed' && c.after).map(c => c.after!), version.duration);
    if (!ranges.length) return;
    setPlaylist(ranges); setPlaylistIndex(0); seek(ranges[0].start);
    try { await videoRef.current?.play(); } catch { setError(t("再生ボタンから再度お試しください。")); }
  }
  if (!project || !version) return <div className="app"><header className="topbar"><Brand/><LanguageSwitch/></header><main className="loading-review">{error ? <ErrorMessage>{error}</ErrorMessage> : <><div className="skeleton-player"/><p className="muted">{t("レビューを開いています…")}</p></>}</main></div>;
  const filterShown = showFilter(project.comments), bylineShown = showByline(project.comments);
  const historyShown = !version.changes.length || historyOpen || !!draft;
  const activeFilter = filterShown ? filter : 'all';
  const visibleComments = project.comments.filter(c => (activeFilter !== 'done' || c.status === 'accepted') && (activeFilter !== 'open' || !['accepted','superseded'].includes(c.status)));
  // 全体への指示は一覧の一番上。2件以上は1行に畳む（選んだ時と、押して開いた時だけ中身が見える）。
  const globals = visibleComments.filter(c => c.scope === 'all'), ordered = [...globals, ...visibleComments.filter(c => c.scope !== 'all')];
  const allFolded = globals.length > 1 && !allOpen && !globals.some(c => c.id === selected);
  const drafts = project.comments.filter(c => c.status === 'draft' && c.versionId === project.versions.at(-1)!.id);
  // 版が届いた画面では、依頼するコメントが無い間は「再調整を依頼」を出さない（塗りは「順番にチェック」）。
  const idleRequestShown = !version.changes.length || historyShown || drafts.length > 0;
  const activeRequest = project.requests.find(r => r.status === 'queued' || r.status === 'running');
  const lastRequest = project.requests.at(-1);
  const needsRecovery = lastRequest && (lastRequest.status === 'failed' || (lastRequest.status === 'running' && (lastRequest.leaseUntil || 0) < Date.now()));
  const selectedComment = project.comments.find(c => c.id === selected);
  const draftPin = draft?.scope === 'all' ? null : draft?.pin ?? null;
  const stagePin = draftPin || (selectedComment?.versionId === version.id && Math.abs(time - selectedComment.start) < 0.35 ? selectedComment.pin : null);
  const stageSeed = draftPin ? draft!.seed : selectedComment?.id ?? '';
  const mappedChanges = version.changes.filter(c => c.after && c.outcome === 'addressed');
  const complete = project.comments.length > 0 && project.comments.every(c => ['accepted','superseded'].includes(c.status));
  const doneCount = project.comments.filter(c => c.status === 'accepted').length;
  const pendingChecks = !!latest && version.changes.some(c => decision(project.comments, c.commentId) === 'pending');
  const fill = primaryAction({ drafting: !!draft, recovery: !!needsRecovery, activeRequest: activeRequest ? { status: activeRequest.status as 'queued' | 'running', notification: activeRequest.notification } : null, pendingChecks, draftCount: drafts.length, hasChanges: version.changes.length > 0 });
  const tones = toolbarTones(fill), dock = dockAction(fill), dockHidden = !!draft || !!compare || submitOpen || cancelOpen;
  const statusLabel = complete ? t("確認完了") : activeRequest?.status === 'running' ? t("調整中") : activeRequest ? t("受付済み・開始待ち") : '';
  const chooseVersion = (value: string) => { if (draft) { setComposeError(t("コメントを保存してから版を切り替えてください。")); return; } setSelectedVersion(value); setAck(project.versions.at(-1)!.id); setSelected(null); setCompare(null); };
  const startCheck = () => { videoRef.current?.pause(); setPlaylist([]); setCompare({version,change:version.changes.find(c => decision(project.comments,c.commentId)==='pending') || version.changes[0]}); };
  const requestAction = (action: string) => post(`/projects/${id}/requests/${activeRequest!.id}/${action}`, {});
  return <div className="app review-app"><header className="topbar"><a href="/" className="back-link"><ChevronLeft size={18}/>{t("レビュー一覧")}</a><LanguageSwitch/><div className="topbar-right"><button className="button plain compact" onClick={() => void copyLink(location.href).then(() => setCopied(true)).catch(e => setError(errorText(e)))}>{copied ? t("コピーしました") : t("共有リンク")}</button></div></header>
    <main className={cn('review-main', dock && 'has-dock')}><ErrorMessage>{error}</ErrorMessage><div className={cn("review-layout", version.changes.length > 0 && "revision-layout")}><section className="watch-column" aria-label={t("動画プレーヤー")}>
      <div className="review-heading"><h1>{project.title}</h1>{(statusLabel || project.versions.length > 1) && <div className="review-meta">{statusLabel && <span className={cn('review-status', complete && 'is-complete')}>{statusLabel}</span>}{project.versions.length > 1 && <label className="version-picker"><span className="sr-only">{t("動画の版")}</span><select value={version.id} onChange={e => chooseVersion(e.target.value)} disabled={!!draft}>{[...project.versions].reverse().map((v,i) => <option key={v.id} value={v.id}>v{v.number}{i === 0 ? '' : t(" · 過去の版")}</option>)}</select></label>}</div>}</div>
      <div className="player"><div className={cn('video-surface', pinning && 'pinning')} ref={surfaceRef} onPointerDown={placePin}>
        <video ref={videoRef} key={version.id} src={mediaUrl(id, version.file)} poster={mediaUrl(id, version.poster)} playsInline preload="metadata" muted={muted} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPlaylist([]); }} onTimeUpdate={onTimeUpdate} onLoadedMetadata={() => { if (videoRef.current) { videoRef.current.playbackRate = speed; if (pendingSeek.current !== null) { seek(pendingSeek.current); pendingSeek.current = null; } } }} onError={() => setError(t("動画を再生できません。H.264 MP4の対応状況を確認してください。"))} aria-label={t("{0} バージョン{1}", project.title, version.number)}/>
        {!playing && !pinning && !draft && <button className="center-play" onClick={() => void togglePlay()} aria-label={t("動画を再生")}><Play size={32} fill="currentColor"/></button>}
        {stagePin && <span className="stage-pin" style={{ left: bounds.left + stagePin.x * bounds.width, top: bounds.top + stagePin.y * bounds.height }}><HerePin key={stageSeed} seed={stageSeed} draw={!!draftPin}/><span className="sr-only">{t("指摘位置")}</span></span>}
        {arrivedId && <div className="version-banner" role="status"><span>{t("v{0} が届きました", project.versions.at(-1)!.number)}</span><button className="button secondary compact" onClick={() => chooseVersion(arrivedId)}>{t("確認する")}</button></div>}
        <span className="player-version">v{version.number}</span>{pinning && <div className="pin-instruction">{t("気になる場所をタップ")}<button onClick={e => { e.stopPropagation(); placePinAt({ x: 0.5, y: 0.5 }); }}>{t("中央に置く")}</button><button aria-label={t("ピンを置く操作を中止")} onClick={e => { e.stopPropagation(); setPinning(false); }}><X size={16}/></button></div>}
      </div><div className="player-bottom"><div className="scrubber"><label className="sr-only" htmlFor="timeline">{t("再生位置")}</label><input id="timeline" type="range" min="0" max={version.duration} step="0.01" value={Math.min(time, version.duration)} onChange={e => { setPlaylist([]); seek(Number(e.target.value)); }} style={{ '--progress': `${time / version.duration * 100}%` } as React.CSSProperties}/><div className="timeline-markers" aria-hidden="true">{project.comments.filter(c => c.versionId === version.id && c.scope !== 'all').map(c => <i key={c.id} className={cn(c.status === 'accepted' && 'done')} style={{ left: `${c.start / version.duration * 100}%` }}/>)}{mappedChanges.map(c => <b key={c.commentId} style={{ left: `${c.after!.start / version.duration * 100}%`, width: `${Math.max(0.6, (c.after!.end - c.after!.start) / version.duration * 100)}%` }}/>)}</div></div>
        <div className="playback-controls"><div className="playback-left"><button className="player-icon" aria-label={playing ? t("一時停止") : t("動画を再生")} onClick={() => void togglePlay()}>{playing ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor"/>}</button><button className="player-icon" aria-label={t("5秒戻る")} onClick={() => seek(Math.max(0, time - 5))}><SkipBack size={18}/></button><button className="player-icon" aria-label={t("5秒進む")} onClick={() => seek(Math.min(version.duration, time + 5))}><SkipForward size={18}/></button><span className="timecode">{timeLabel(time)}<span> / {timeLabel(version.duration)}</span></span></div><div className="playback-right"><label><span className="sr-only">{t("再生速度")}</span><select className="speed-select" value={speed} onChange={e => { const s = Number(e.target.value); setSpeed(s); if (videoRef.current) videoRef.current.playbackRate = s; }}>{[0.5,1,1.5,2].map(s => <option value={s} key={s}>{s}×</option>)}</select></label><button className="player-icon" aria-label={muted ? t("音声をオン") : t("ミュート")} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={19}/> : <Volume2 size={19}/>}</button></div></div>
      </div></div>
      <div className="annotation-toolbar">{version.changes.length > 0 && <><button className={cn('button', tones.check, tones.check === 'primary' && 'dock-twin')} disabled={!!draft} onClick={startCheck}>{t("順番にチェック")}</button><button className={cn('button', tones.play)} onClick={() => void changedOnly()} disabled={!mappedChanges.length || !!draft}>{playlist.length ? t("変更箇所を再生中") : t("変更箇所だけ再生")}</button></>}<button className={cn('button', tones.comment, tones.comment === 'primary' && 'dock-twin')} onClick={() => beginComment()} disabled={!latest || !!draft}>{version.changes.length ? t("指摘を追加") : t("{0} にコメント", timeLabel(time))}</button><button className={cn('button', tones.pin, pinning && 'active')} disabled={!latest} onClick={() => { videoRef.current?.pause(); setPinning(!pinning); }} aria-pressed={pinning}>{t("ここを指す")}</button></div>
      {!latest && <p className="context-note">{t("過去の版を表示中。新しい指摘は最新版に追加できます。")}</p>}
      {version.number > 1 && <section className="version-note"><p className="small-label">{t("この版の変更メモ")}</p><p className="version-note-body">{version.summary}</p><time dateTime={version.createdAt} title={new Date(version.createdAt).toLocaleString(getLocale())}>{relativeTime(version.createdAt, getLocale())}</time></section>}
      {version.changes.length > 0 && <section className="changes-section"><div className="section-bar"><h2>{t("今回の変更")}</h2></div><div className="changes-list">{version.changes.map(change => { const comment=project.comments.find(c=>c.id===change.commentId); const state=decision(project.comments,change.commentId); return <button className="change-row" key={change.commentId} disabled={!!draft} onClick={() => { videoRef.current?.pause(); setPlaylist([]); setCompare({ version, change }); }}><span className="change-time">{change.after ? timeLabel(change.after.start) : t("要相談")}</span><span className="change-copy"><strong>{comment?.text || t("修正内容")}</strong><small>{change.summary}</small></span><span className={cn('flow-status',state)}>{{ok:'OK',retry:t("再修正"),pending:t("未確認")}[state]}</span><ChevronRight size={16}/></button>; })}</div></section>}
      {playlist.length > 0 && <div className="playlist-bar"><Scissors size={16}/>{t("変更箇所")} {playlistIndex + 1} / {playlist.length}<button className="text-button" onClick={() => { videoRef.current?.pause(); setPlaylist([]); }}>{t("終了")}</button></div>}
    </section>
    <div className="side-column">
    <div className={cn("review-history", !version.changes.length && "initial-history", historyShown && "is-open")}><button type="button" className="history-summary" aria-expanded={historyShown} onClick={() => setHistoryOpen(!historyShown)}>{t("コメントと履歴")}<span className="count-plain">{project.comments.length}</span>{drafts.length > 0 && <span className="history-pending">{t("未送信 {0}件", drafts.length)}</span>}<ChevronDown size={16}/></button>{historyShown && <aside className="comments-panel" ref={sidebarRef} aria-label={t("指摘とコメント")}><div className="comments-heading"><h2>{t("コメント")}<span className="count-plain">{project.comments.length}</span></h2>{doneCount > 0 && <span className="small-label">{t('{0}件 OK', doneCount)}</span>}</div>{filterShown && <div className="filter-tabs" role="group" aria-label={t("コメントの絞り込み")}>{[['all',t("すべて")],['open',t("未完了")],['done','OK']].map(([value,label]) => <button key={value} className={cn(activeFilter === value && 'selected')} aria-pressed={activeFilter === value} onClick={() => setFilter(value as typeof filter)}>{label}</button>)}</div>}
      {draft && <form className="composer" onSubmit={e => { e.preventDefault(); void saveComment(); }}><div className="composer-top"><div className="composer-scope" role="group" aria-label={t("コメントの範囲")}><button type="button" className="composer-time" aria-pressed={draft.scope !== 'all'} disabled={busy} onClick={() => setScope('here')}>{timeLabel(draft.start)}{draft.pin && draft.scope !== 'all' && <HerePin seed={draft.seed} size={14}/>}</button><button type="button" aria-pressed={draft.scope === 'all'} disabled={busy} onClick={() => setScope('all')}>{t("全体")}</button></div>{draft.followupOf && <strong>{t("もう一度、調整を依頼")}</strong>}<button type="button" className="icon-button" aria-label={t("コメント入力を閉じる")} disabled={busy} onClick={() => text.trim() || draft.direction ? setCancelOpen(true) : (setDraft(null), setPinning(false))}><X size={17}/></button></div>{draftImage && draft.scope !== 'all' && <div className="draft-preview"><img src={draftImage} alt={t("コメント対象の停止フレーム")}/>{draft.pin && <span className="draft-pin" style={{ left: `${draft.pin.x * 100}%`, top: `${draft.pin.y * 100}%` }}><HerePin key={draft.seed} seed={draft.seed} size={32}/></span>}</div>}<DirectionAssist value={draft.direction} disabled={busy} frame={draftImage} pin={draft.scope === 'all' ? null : draft.pin} aspect={version.width / version.height} scope={draft.scope === 'all' ? 'all' : 'here'} at={draft.start / version.duration} onChange={direction => setDraft({...draft,direction})}/><label className="sr-only" htmlFor="comment-text">{draft.direction ? t("補足（任意）") : t("修正コメント")}</label><textarea id="comment-text" ref={textRef} value={text} onChange={e => setText(e.target.value)} placeholder={draft.scope === 'all' ? t("全体にテンポよく。") : draft.direction ? t("補足（任意）例：この人だけ、もう少しゆっくり") : t("ここ、0.5秒早く。")} maxLength={4000} required={!draft.direction} rows={3} disabled={busy}/>{draft.scope === 'all' && <TempoChips value={draft.direction} disabled={busy} onChange={direction => setDraft({...draft,direction})}/>}{draft.scope !== 'all' && <details className="composer-more"><summary>{t("時間範囲・ピンの位置・表示名")}<ChevronDown size={14}/></summary><div className="range-field"><label><input type="checkbox" checked={draft.end !== null} onChange={e => setDraft({ ...draft, end: e.target.checked ? Math.min(version.duration, draft.start + 3) : null })}/>{t("時間範囲を指定")}</label>{draft.end !== null && <label className="end-input">{t("終了（秒）")}<input type="number" min={draft.start + 0.01} max={version.duration} step="any" inputMode="decimal" required value={draft.end} onChange={e => setDraft({ ...draft, end: Number(e.target.value) })}/></label>}</div>{draft.pin && <div className="pin-coordinates"><span>{t("ピンの位置")}</span><label>{t("横")}<input aria-label={t("ピンの横位置（パーセント）")} type="number" min="0" max="100" value={Math.round(draft.pin.x * 100)} onChange={e => setDraft({ ...draft, pin: { x: Math.max(0, Math.min(100, Number(e.target.value))) / 100, y: draft.pin!.y } })}/>%</label><label>{t("縦")}<input aria-label={t("ピンの縦位置（パーセント）")} type="number" min="0" max="100" value={Math.round(draft.pin.y * 100)} onChange={e => setDraft({ ...draft, pin: { x: draft.pin!.x, y: Math.max(0, Math.min(100, Number(e.target.value))) / 100 } })}/>%</label></div>}<label className="author-field">{t("表示名")}<input value={author} onChange={e => setAuthor(e.target.value)} maxLength={60} required/></label></details>}<ErrorMessage>{composeError}</ErrorMessage><button className="button primary full-width" disabled={busy || !commentText(text, draft.direction, getLocale()) || !author.trim()}>{busy ? t("保存中…") : t("コメントを保存")}</button></form>}
      <div className="comments-list">{visibleComments.length === 0 ? <p className="empty-comments">{activeFilter === 'done' ? t("OK した指摘はここに。") : t("止めて、ここを指す。")}</p> : <>{allFolded && <button type="button" className="all-fold" aria-expanded="false" onClick={() => setAllOpen(true)}><span className="all-chip">{t("全体")}</span><span className="all-first">{globals[0].text}</span><span className="all-more">{t("ほか{0}件", globals.length - 1)}<ChevronRight size={16}/></span></button>}{ordered.filter(c => !(allFolded && c.scope === 'all')).map((c,index) => <CommentCard key={c.id} comment={c} index={index + 1} selected={selected === c.id} fresh={freshId === c.id} projectId={id} versionNumber={project.versions.find(v => v.id === c.versionId)?.number || 1} currentVersionNumber={version.number} showByline={bylineShown} onSelect={() => selectComment(c)} onRefresh={load} onCompare={() => { const v = [...project.versions].reverse().find(v => v.changes.some(ch => ch.commentId === c.id)); const change = v?.changes.find(ch => ch.commentId === c.id); if (v && change) { videoRef.current?.pause(); setCompare({ version: v, change }); } }} onReopen={() => { if (!latest) { setError(t("最新版を選んでから、位置を指定してください。")); return; } if (draft) { setComposeError(t("先にコメントを保存してください。")); return; } setText(t("再調整：{0}", c.text)); beginComment(null, c.id, c.direction ?? null, c.scope); }}/>)}{globals.length > 1 && allOpen && !globals.some(c => c.id === selected) && <button type="button" className="text-button all-close" onClick={() => setAllOpen(false)}>{t("全体をたたむ")}</button>}</>}</div>
    </aside>}</div>{(idleRequestShown || needsRecovery || activeRequest) && <div className="request-footer">{needsRecovery ? <div className="notice"><div className="notice-head"><CircleAlert size={18}/><div><strong>{lastRequest.status === 'failed' ? t("再調整が止まりました") : t("制作側との接続が切れています")}</strong><p>{(lastRequest.failure ? (project.isAdmin ? lastRequest.failure : errorMessage(lastRequest.failure)) : null) || t("自動では再開しません。")}</p></div></div>{project.isAdmin ? <button className="button primary full-width" onClick={() => void post(`/projects/${id}/requests/${lastRequest.id}/requeue`, {}).then(load).catch(e => setError(errorText(e)))}>{t("依頼を再受付する")}</button> : <p className="muted small">{t("制作側が確認して再受付します。")}</p>}</div> : activeRequest?.notification && activeRequest.status === 'queued' ? <NotificationNotice notification={activeRequest.notification} onResend={() => void requestAction('renotify').then(load).catch(e => setError(errorText(e)))} onCancel={() => void requestAction('cancel').then(() => { setToast(t("コメントを下書きに戻しました")); return load(); }).catch(e => setError(errorText(e)))}/> : activeRequest ? <div className="notice"><div className="notice-head"><div><strong>{activeRequest.status === 'running' ? t("制作側が調整中です") : t("受付済み・開始待ち")}</strong><p>{activeRequest.status === 'running' ? t("修正版が届くと、ここで確認できます。") : t("接続したCodex／Claudeが依頼を取得すると始まります。")}</p></div></div></div> : <>{toast ? <p className="request-toast" role="status">{toast}</p> : <p className="request-hint">{drafts.length ? t("{0}件を依頼できます", drafts.length) : complete ? t("確認しました") : t("コメントを保存すると依頼できます")}</p>}<button className={cn('button full-width', tones.request, tones.request === 'primary' && 'dock-twin')} disabled={!drafts.length || !!draft} onClick={() => setSubmitOpen(true)}>{t("再調整を依頼")}</button></>}</div>}
    </div></div></main>
    {dock && <div className={cn('dock', dockHidden && 'is-hidden')} aria-hidden={dockHidden || undefined} inert={dockHidden || undefined}><button className="button primary" disabled={dock === 'comment' ? !latest : dock === 'request' ? !drafts.length : false} onClick={dock === 'comment' ? () => beginComment() : dock === 'request' ? () => setSubmitOpen(true) : startCheck}>{dock === 'comment' ? t("{0} にコメント", timeLabel(time)) : dock === 'request' ? t("再調整を依頼") : t("順番にチェック")}</button></div>}
    <Modal open={submitOpen} onClose={() => !busy && setSubmitOpen(false)} title={t("再調整を依頼")}><Dialog.Description className="muted">{t("{0}件のコメントをv{1}に送ります。", drafts.length, project.versions.at(-1)!.number)}</Dialog.Description><p className="muted small">{t("送信後に追加したコメントは、次の依頼に含まれます。")}</p><div className="request-summary">{drafts.map(c => <div key={c.id}><span className="time-label">{c.scope === 'all' ? t("全体") : timeLabel(c.start)}</span><div><p>{c.text}</p><DirectionSummary value={c.direction} text={c.text}/></div></div>)}</div>{project.chatNotification ? <div className="notice"><div className="notice-head"><div><strong>{t("{0}元の{1}チャットへ通知", project.chatNotification.testOnly ? t("接続テスト · ") : '', project.chatNotification.provider === 'claude' ? 'Claude Code' : 'Codex')}</strong><p>{t("この会話の続きで指摘を確認します。動画の修正は確認後に進めます。")}</p></div></div></div> : <label>{t("依頼先")}<select value={target} onChange={e => setTarget(e.target.value as typeof target)}><option value="any">{t("接続中の制作エージェント")}</option><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>}<ErrorMessage>{composeError}</ErrorMessage><button className="button primary full-width" disabled={busy || sent} aria-label={sent ? t("依頼を保存しました") : undefined} onClick={() => { setBusy(true); setComposeError(''); void post(`/projects/${id}/requests`, { versionId: project.versions.at(-1)!.id, commentIds: drafts.map(c => c.id), target: project.chatNotification?.provider ?? target }).then(async () => { setSent(true); navigator.vibrate?.(8); await new Promise(r => setTimeout(r, 450)); setSubmitOpen(false); setSent(false); await load(); }).catch(e => setComposeError(errorText(e))).finally(() => setBusy(false)); }}><span key={sent ? 'sent' : busy ? 'busy' : 'idle'} className="fade-in">{sent ? <svg className="draw-check" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1}/></svg> : busy ? <LoaderCircle className="spin" size={20} aria-label={t("依頼中…")}/> : project.chatNotification ? t("{0}件の依頼を保存して知らせる", drafts.length) : t("{0}件の再調整を依頼", drafts.length)}</span></button></Modal>
    <AlertDialog.Root open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialog.Portal><AlertDialog.Backdrop className="modal-backdrop"/><AlertDialog.Popup className="modal"><AlertDialog.Title>{t("入力を閉じますか？")}</AlertDialog.Title><AlertDialog.Description className="muted">{t("保存していないコメントは消えます。")}</AlertDialog.Description><div className="modal-actions"><button className="button danger" onClick={() => { setText(''); setDraft(null); setPinning(false); setCancelOpen(false); }}>{t("保存せず閉じる")}</button><AlertDialog.Close className="button primary">{t("入力に戻る")}</AlertDialog.Close></div></AlertDialog.Popup></AlertDialog.Portal></AlertDialog.Root>
    {compare && <ReviewFlow key={compare.version.id} project={project} version={project.versions.find(v=>v.id===compare.version.id)!} initialId={compare.change.commentId} onClose={() => setCompare(null)} onRefresh={load} onSend={() => { setCompare(null); setComposeError(''); setSubmitOpen(true); }}/> }
  </div>;
}

function CommentCard({ comment: c, index, selected, fresh, projectId, versionNumber, currentVersionNumber, showByline: bylineShown, onSelect, onRefresh, onCompare, onReopen }: { comment: Comment; index: number; selected: boolean; fresh: boolean; projectId: string; versionNumber: number; currentVersionNumber: number; showByline: boolean; onSelect: () => void; onRefresh: () => Promise<void>; onCompare: () => void; onReopen: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState('');
  const [edit, setEdit] = useState(false);
  const [editText, setEditText] = useState(c.text);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 十字なしの画像が無い古いコメントは、十字入りの画像のまま見せる（十字の上に丸は重ねない）。
  const [plainMissing, setPlainMissing] = useState(false);
  async function run(fn: () => Promise<unknown>) { setBusy(true); setError(''); try { await fn(); await onRefresh(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  const mark = statusMark(c.status), actions = commentActions(c.status, selected);
  return <article className={cn('comment-card', c.scope === 'all' && 'is-all', fresh && 'is-new', selected && 'is-selected', c.status === 'accepted' && 'is-accepted')}><div className="comment-top"><button className="comment-time" onClick={onSelect} aria-label={t("{0}の指摘を表示", c.scope === 'all' ? t("全体") : timeLabel(c.start))}>{c.scope === 'all' ? t("全体") : <>{timeLabel(c.start)}{c.end !== null && <>–{timeLabel(c.end)}</>}{c.pin && <HerePin seed={c.id} size={12}/>}</>}</button>{versionNumber !== currentVersionNumber && <span className="comment-version">v{versionNumber}</span>}{mark.kind === 'check' ? <span className="comment-status check" role="img" aria-label="OK"><Check size={16}/></span> : mark.kind === 'text' && <span className={cn('comment-status', mark.tone === 'accent' && 'accent', mark.tone === 'attention' && 'attention')}>{t(mark.label)}</span>}</div>{edit ? <form className="edit-form" onSubmit={e => { e.preventDefault(); void run(() => api(`/projects/${projectId}/comments/${c.id}`, { method: 'PATCH', body: JSON.stringify({ text: editText }) }).then(() => setEdit(false))); }}><label className="sr-only" htmlFor={`edit-${c.id}`}>{t("コメントを編集")}</label><textarea id={`edit-${c.id}`} value={editText} onChange={e => setEditText(e.target.value)} maxLength={4000} required/><div className="inline-actions"><button className="text-button" type="button" onClick={onReopen}>{t("位置を指定し直す")}</button><button className="text-button" type="button" onClick={() => setEdit(false)}>{t("戻る")}</button><button className="text-button accent" disabled={busy}>{t("保存")}</button></div></form> : <button className="comment-body" onClick={onSelect}>{c.text}</button>}
    <DirectionSummary value={c.direction} text={c.text}/>{bylineShown && <div className="comment-byline"><span>{c.author}</span><span className="comment-number">#{index}</span></div>}
    {selected && c.scope !== 'all' && <div className="comment-evidence">{c.pin && !plainMissing ? <span className="evidence-frame"><img src={mediaUrl(projectId, plainSnapshotName(c.snapshot))} alt={t("v{0} {1}の指摘画像{2}", versionNumber, timeLabel(c.start), t("（ピン付き）"))} onError={() => setPlainMissing(true)}/><span className="evidence-pin" style={{ left: `${c.pin.x * 100}%`, top: `${c.pin.y * 100}%` }}><HerePin seed={c.id} size={32}/></span></span> : <img src={mediaUrl(projectId, c.snapshot)} alt={t("v{0} {1}の指摘画像{2}", versionNumber, timeLabel(c.start), c.pin ? t("（ピン付き）") : '')}/>}</div>}
    {actions.length > 0 && !edit && <div className="comment-actions">{actions.map(action => action === 'edit' ? <button key={action} className="text-button" onClick={() => { setEditText(c.text); setEdit(true); }}>{t("編集")}</button> : action === 'reply' ? <button key={action} className="text-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? t("閉じる") : c.replies.length ? t("返信 {0}", c.replies.length) : t("返信")}</button> : action === 'compare' ? <button key={action} className="text-button" onClick={onCompare}>{t("前後を比較")}</button> : action === 'accept' ? <button key={action} className="text-button accent" disabled={busy} onClick={() => void run(() => api(`/projects/${projectId}/comments/${c.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) }))}>OK</button> : <button key={action} className="text-button" onClick={onReopen}>{t("もう一度")}</button>)}</div>}
    {(c.replies.length > 0 || (expanded && selected)) && <div className="reply-section">{c.replies.map(r => <div className="reply" key={r.id}><CornerDownRight size={14}/><div><strong>{r.author}</strong><p>{r.text}</p></div></div>)}{expanded && selected && <form onSubmit={e => { e.preventDefault(); void run(() => post(`/projects/${projectId}/comments/${c.id}/replies`, { text: reply, author: savedAuthor() || t("レビュー担当") }).then(() => setReply(''))); }}><label className="sr-only" htmlFor={`reply-${c.id}`}>{t("返信")}</label><input id={`reply-${c.id}`} value={reply} onChange={e => setReply(e.target.value)} placeholder={t("返信を書く")} maxLength={4000} required/><button className="icon-button" aria-label={t("返信を送る")} disabled={busy || !reply.trim()}><ChevronRight size={17}/></button></form>}</div>}<ErrorMessage>{error}</ErrorMessage></article>;
}
