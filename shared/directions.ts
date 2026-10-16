import type { Locale } from './locale.js';
import { translate } from './translate.js';
import { timeLabel } from './types.js';

/**
 * 演出の選択肢。1コメントに付けられるのは 6 スロット（構図 / 動き / テロップ / 音 / つなぎ / 冒頭と締め）に1つずつ。
 * `retired` は選択肢の一覧から外しただけで、前に付いたコメントの表示・送信には今まで通り使う。
 * `v3` は version 3 の束（と、そこに入る単体）でだけ受け付ける id。
 */
type Slot = 'frame' | 'motion' | 'sound' | 'cut' | 'bookend';
/** ダイアログの畳んだ分類（スロットとは別）。テロップは captionPresets 側。 */
type Group = 'shot' | 'layout' | 'sound' | 'cut' | 'bookend';
/** 強さの意味。none は強さを持たない。 */
type Kind = 'size' | 'hold' | 'blur' | 'pan' | 'speed' | 'sound' | 'tempo' | 'none';
type PresetDef = { id: string; slot: Slot; group: Group; label: string; hint: string; term: string; instruction: string; kind: Kind; common?: true; retired?: true; v3?: true };

const list = [
  { id: 'face', slot: 'frame', group: 'shot', kind: 'size', common: true, label: '顔を大きく', hint: '表情が見える距離に', term: 'Close-up', instruction: '顔を中心とするクローズアップにリフレームする。ズーム移動の追加は意図していない。' },
  { id: 'upper-body', slot: 'frame', group: 'shot', kind: 'size', label: '胸から上', hint: '顔と身ぶりを一緒に', term: 'Medium close-up', instruction: '胸から上を中心とするショットにリフレームする。ズーム移動の追加は意図していない。' },
  { id: 'match-expression', slot: 'frame', group: 'shot', kind: 'none', v3: true, label: 'この言葉に表情を合わせる', hint: '嬉しい言葉には笑顔のコマ', term: 'Expression match', instruction: 'この言葉の瞬間に、話し手の表情が言葉に合うコマを使う。嬉しい言葉には笑顔のコマ。既存映像のコマだけを使い、合うコマが無ければ報告する。' },
  { id: 'snap-in', slot: 'motion', group: 'shot', kind: 'size', common: true, label: 'パッと寄る', hint: '「ここ見て」をつくる', term: 'Snap zoom', instruction: '対象へ短時間でズームインして強調する。点滅や画面の振動は追加しない。' },
  { id: 'slow-in', slot: 'motion', group: 'shot', kind: 'size', label: 'ゆっくり寄る', hint: '少しずつ注目を集める', term: 'Slow zoom-in', instruction: '対象へ滑らかにズームインする。カメラの前進や遠近感の変化は必須ではない。' },
  { id: 'out', slot: 'motion', group: 'shot', kind: 'size', label: '引いて全体', hint: '周りまで見せる', term: 'Zoom-out', instruction: '対象の寄りから滑らかに引いて周囲を見せる。元映像の外側が必要なら生成元で調整し不足を勝手に捏造しない。' },
  { id: 'hold', slot: 'motion', group: 'shot', kind: 'hold', label: '一瞬止める', hint: '読める間をつくる', term: 'Freeze frame / hold', instruction: '指定時刻のフレームを短く保持する。音声と字幕の同期を確認し後続の時間対応を報告する。' },
  { id: 'speed', slot: 'motion', group: 'shot', kind: 'speed', v3: true, label: 'スロー・速さを変える', hint: 'この区間だけ遅く、または速く', term: 'Slow down / speed up', instruction: '指定区間の再生速度を変える。音声と字幕の同期を保ち、後続の時間対応を報告する。' },
  { id: 'soft-background', slot: 'motion', group: 'shot', kind: 'blur', label: '背景をぼかす', hint: '主役をくっきり', term: 'Background defocus', instruction: '対象を鮮明に保ち背景をぼかす。人物の輪郭や字幕までぼかさない。' },
  { id: 'sides', slot: 'frame', group: 'layout', kind: 'none', label: '左右で見比べる', hint: '二人も、二つの映像も並べる', term: 'Side-by-side split screen', instruction: '比較する二つの映像を左右の領域に並べる。対象が不明なら確認し素材を捏造しない。' },
  { id: 'stack', slot: 'frame', group: 'layout', kind: 'none', label: '上に資料・下に話す人', hint: '縦画面を上下に分ける', term: 'Stacked split screen', instruction: '上側に資料や実演を配置し下側に説明する人物を配置する。字幕や顔を切らない。' },
  { id: 'overlay', slot: 'frame', group: 'layout', kind: 'none', label: '資料の前で説明', hint: '資料は大きく、人は小さく', term: 'Presenter overlay', instruction: '資料を大きく背景に置き説明する人物を小さく手前に重ねる。資料の重要箇所を人物で隠さない。' },
  { id: 'sfx-in', slot: 'sound', group: 'sound', kind: 'sound', v3: true, common: true, label: '出てくる音', hint: '文字や絵が出る瞬間', term: 'Pop-in sound', instruction: '文字や絵が出る瞬間に短い効果音を入れる。声より小さくする。' },
  { id: 'sfx-hit', slot: 'sound', group: 'sound', kind: 'sound', v3: true, label: '決めの音', hint: '言い切る瞬間', term: 'Impact', instruction: '言い切る瞬間に低めの決めの音を入れる。声より小さくする。' },
  { id: 'sfx-punch', slot: 'sound', group: 'sound', kind: 'sound', v3: true, label: 'オチの音', hint: '約10秒に1回まで', term: 'Punchline sound', instruction: 'オチの瞬間に高めの音を入れる。多用せず、約10秒に1回までを目安にする。' },
  { id: 'bgm-duck', slot: 'sound', group: 'sound', kind: 'none', v3: true, label: 'BGMを下げる・無音の間', hint: '声や間を立てる', term: 'Duck music / silent beat', instruction: '指定区間でBGMを下げるか、無音の間をつくって、声や間を立てる。' },
  { id: 'tighten', slot: 'cut', group: 'cut', kind: 'tempo', v3: true, common: true, label: '間を詰める', hint: '言い淀み・つっかえ・無音を切る', term: 'Tighten pauses', instruction: '言い淀み・つっかえ・無音を切って間を詰める。基準は強さごとの目安に従う。' },
  { id: 'keep-pause', slot: 'cut', group: 'cut', kind: 'none', v3: true, label: '間を残す', hint: 'ここは詰めない', term: 'Keep the pause', instruction: 'この区間の間は詰めない。全体の指示で間を詰める場合も、ここは残す。' },
  { id: 'reframe', slot: 'cut', group: 'cut', kind: 'none', v3: true, label: '画角を切り替える', hint: '同じ絵を続けない', term: 'Change the shot', instruction: '同じ画角を続けず、寄りと引きを切り替える。元映像にない絵は作らない。' },
  { id: 'beat-cut', slot: 'cut', group: 'cut', kind: 'none', v3: true, label: 'ビートでカット', hint: '音楽の拍に合わせる', term: 'Cut on the beat', instruction: '音楽の拍に合わせてカットを切り替える。拍が取れなければ報告する。' },
  { id: 'insert', slot: 'cut', group: 'cut', kind: 'none', v3: true, label: '差し込み映像', hint: '素材が必要です', term: 'Insert footage', instruction: '指定位置に差し込み映像を入れる。素材が無ければ捏造せずblockedで理由を報告する。' },
  { id: 'open-conclusion', slot: 'bookend', group: 'bookend', kind: 'none', v3: true, label: '最初の1秒で結論', hint: '冒頭で言いきる', term: 'Lead with the point', instruction: '最初の1秒で結論を言いきる構成にする。冒頭1秒に結論の言葉かテロップを置く。' },
  { id: 'close-summary', slot: 'bookend', group: 'bookend', kind: 'none', v3: true, label: '最後に1行まとめ', hint: '終わりに一言', term: 'One-line wrap-up', instruction: '最後に1行のまとめを入れる。' },
  { id: 'call-to-action', slot: 'bookend', group: 'bookend', kind: 'none', v3: true, label: '呼びかけ（コメントで教えて）', hint: '見た人に返してもらう', term: 'Call to action', instruction: '見た人に返してもらう呼びかけ（コメントで教えて、など）を入れる。実在の投稿やコメントを捏造しない。' },
  { id: 'loop-end', slot: 'bookend', group: 'bookend', kind: 'none', v3: true, label: 'ループで終わる', hint: '最後が最初につながる', term: 'Seamless loop', instruction: '最後が最初につながるようにして、ループで終わる。' },
  // ここから下は選択肢から外した id。前のコメントの表示・送信のために残す。
  { id: 'pan', slot: 'motion', group: 'shot', kind: 'pan', retired: true, label: '左右に動かす', hint: '画面を横にたどる', term: 'Horizontal pan / reframe', instruction: '画面の見せる位置を横方向へ滑らかに移動する。被写体自体を歩かせる指示ではない。' },
  { id: 'two', slot: 'frame', group: 'layout', kind: 'none', retired: true, label: '二人を同じ画面に', hint: '二人の表情を一緒に', term: 'Two-shot', instruction: '二人を同じ画面に配置して表情が分かる大きさにする。既存人物だけを使う。' },
  { id: 'side-info', slot: 'frame', group: 'layout', kind: 'none', retired: true, label: '横に説明の場所を空ける', hint: '人物の横に文字や図を', term: 'Presenter with side information', instruction: '人物を片側に寄せて反対側に文字や図のための余白を確保する。必要な資料がなければ不足を報告する。' },
] as const satisfies readonly PresetDef[];

export type DirectionId = typeof list[number]['id'];
export const directionPresets: readonly (PresetDef & { id: DirectionId })[] = list;
export type Strength = 'subtle' | 'normal' | 'strong';
export type SingleDirection = { preset: DirectionId; strength: Strength; side?: 'left' | 'right'; mode?: 'slow' | 'fast' };
export const strengthLabels = { subtle: '弱め', normal: 'ふつう', strong: '強め' } as const;
export const directionPreset = (id: DirectionId) => directionPresets.find(p => p.id === id)!;
const idsOf = (slot: Slot) => directionPresets.filter(p => p.slot === slot).map(p => p.id);
export const frameIds = idsOf('frame');
export const motionIds = idsOf('motion');
export const soundIds = idsOf('sound');
export const cutIds = idsOf('cut');
export const bookendIds = idsOf('bookend') as ('open-conclusion' | 'close-summary' | 'call-to-action' | 'loop-end')[];
export type BookendId = typeof bookendIds[number];
export const slotKeys = ['frame', 'motion', 'caption', 'sound', 'cut', 'bookend'] as const;
export type SlotKey = typeof slotKeys[number];
export const slotLimit = slotKeys.length;

/** 速さの倍率。遅く = 0.75× / 0.5× / 0.25×、速く = 1.25× / 1.5× / 2×。 */
const speedFactors = { slow: [.75, .5, .25], fast: [1.25, 1.5, 2] } as const;
const strengthIndex = { subtle: 0, normal: 1, strong: 2 } as const;
export const speedFactor = (d: Pick<SingleDirection, 'strength' | 'mode'>) => speedFactors[d.mode ?? 'slow'][strengthIndex[d.strength]];

/** テンポの3段。「全体」のチップと、「ここ」の間を詰める（tighten）の強さは同じ3語・同じ数値。 */
export const tempoIds = ['soft', 'normal', 'tight'] as const;
export type Tempo = typeof tempoIds[number];
export const tempoLabels = { soft: 'やわらかく', normal: 'ふつう', tight: '攻める' } as const;
const tempoOfStrength: Record<Strength, Tempo> = { subtle: 'soft', normal: 'normal', strong: 'tight' };
const strengthOfTempo: Record<Tempo, Strength> = { soft: 'subtle', normal: 'normal', tight: 'strong' };
/** 無音・言い淀みの秒数は暫定値（出典なし）。裏が取れるまで AI にも「目安」として渡す。同じ画角の上限（4秒）は調べの根拠あり。 */
export const tempoRules = {
  soft: { from: '0.8', to: '0.5', shot: '6', filler: '長い言い淀みだけ切る' },
  normal: { from: '0.4', to: '0.2', shot: '4', filler: '「えーと」「あの」・つっかえを切る' },
  tight: { from: '0.25', to: '0.1', shot: '3', filler: '息継ぎ・相づち・言い直しも切る' },
} as const;
export const tempoOf = (d: Pick<SingleDirection, 'strength'>) => tempoOfStrength[d.strength];
export const strengthOfTempoId = (tempo: Tempo) => strengthOfTempo[tempo];

export function isSingleDirection(value: unknown, version: 1 | 2 | 3 = 1): value is SingleDirection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  const preset = directionPresets.find(p => p.id === d.preset);
  return !!preset && (version === 3 || !('v3' in preset)) && typeof d.strength === 'string' && ['subtle','normal','strong'].includes(d.strength)
    && (d.side === undefined || (d.preset === 'pan' && typeof d.side === 'string' && ['left','right'].includes(d.side)))
    && (d.mode === undefined || (d.preset === 'speed' && typeof d.mode === 'string' && ['slow','fast'].includes(d.mode)))
    && Object.keys(d).every(k => ['preset','strength','side','mode'].includes(k));
}

const t = (lang: Locale) => (key: string, ...values: (string | number)[]) => translate(key, lang, ...values);
const noun: Record<Kind, string> = { size: '画角変化の大きさ', hold: '停止時間', blur: '背景のぼかし量', pan: '横移動の幅', speed: '画角変化の大きさ', sound: '画角変化の大きさ', tempo: '画角変化の大きさ', none: '画角変化の大きさ' };

// v1/v2 are frozen contracts. New picker wording must not reinterpret saved requests.
const legacyLabels: Partial<Record<DirectionId | Caption['preset'], Record<Locale, string>>> = {
  "face": {
    "ja": "顔を大きく見せる",
    "en": "Face close-up"
  },
  "upper-body": {
    "ja": "上半身を映す",
    "en": "Upper body"
  },
  "slow-in": {
    "ja": "ゆっくり寄る",
    "en": "Slowly zoom in"
  },
  "snap-in": {
    "ja": "パッと寄る",
    "en": "Quickly zoom in"
  },
  "out": {
    "ja": "引いて全体を見せる",
    "en": "Zoom out"
  },
  "hold": {
    "ja": "少し止めて見せる",
    "en": "Hold this moment"
  },
  "stack": {
    "ja": "上に資料 下に話す人",
    "en": "Reference on top"
  },
  "overlay": {
    "ja": "資料の前で説明",
    "en": "Presenter inset"
  },
  "plain": {
    "ja": "すっきり字幕",
    "en": "Clean captions"
  },
  "highlight": {
    "ja": "大事な言葉だけ色",
    "en": "Highlight key words"
  },
  "words": {
    "ja": "言葉ごとに出す",
    "en": "Phrase by phrase"
  },
  "karaoke": {
    "ja": "話したところが色づく",
    "en": "Color with voice"
  },
  "title": {
    "ja": "最初に見出しを見せる",
    "en": "Lead with a title"
  },
  "question-card": {
    "ja": "質問カードから始める",
    "en": "Question card"
  }
};
const presetLabel = (p: { id: DirectionId | Caption['preset']; label: string }, lang: Locale, legacy: boolean) =>
  (legacy ? legacyLabels[p.id]?.[lang] : undefined) ?? translate(p.label, lang);
const legacyHighlightInstruction: Record<Locale, string> = {
  ja: '重要な語句だけを色で強調する。強調語は補足に指定があればそれを使う。',
  en: 'Use color to emphasize only the important words. Use specific words from the additional notes when provided.',
};

function singleLabel(d: SingleDirection, lang: Locale = 'ja', legacy = true) {
  const tr = t(lang), p = directionPreset(d.preset), label = presetLabel(p, lang, legacy);
  switch (p.kind) {
    case 'none': return label;
    case 'pan': return `${label} · ${tr(strengthLabels[d.strength])} · ${d.side === 'left' ? tr("左へ") : tr("右へ")}`;
    case 'speed': return `${label} · ${d.mode === 'fast' ? tr("速く") : tr("遅く")} ${speedFactor(d)}×`;
    case 'tempo': return `${label} · ${tr(tempoLabels[tempoOf(d)])}`;
    default: return `${label} · ${tr(strengthLabels[d.strength])}`;
  }
}
const tailKey = "コメントのstart/endを時刻・区間として使用しpinがあればその位置を対象にする。pinがなければコメントから対象を確認する。補足のtextを優先して意図を合わせる。見本の図は素材ではない。実現できなければblockedで理由を報告する。";
export type DirectionAt = { start?: number };
function tempoRuleText(tempo: Tempo, lang: Locale) {
  const tr = t(lang), r = tempoRules[tempo];
  return tr("テンポ（{0}）: {1}秒より長い間を{2}秒に。{3}。同じ画角は{4}秒まで。数値は暫定の目安。", tr(tempoLabels[tempo]), r.from, r.to, tr(r.filler), r.shot);
}
function singleInstruction(d: SingleDirection, lang: Locale = 'en', at?: DirectionAt, legacy = true) {
  const tr = t(lang), p = directionPreset(d.preset);
  if (!('v3' in p)) return tr("[演出アシスト v1 / {0}] {1}。{2} 強さは{3}の相対的な目安。コメントのstart/endを時刻・区間として使用しpinがあればその位置を対象にする。pinがなければコメントから対象を確認する。補足のtextを優先して意図を合わせる。見本の図は素材ではない。実現できなければblockedで理由を報告する。", p.term, singleLabel(d, lang, legacy), tr(p.instruction), tr(noun[p.kind]));
  const qualifier = p.kind === 'speed' ? tr("再生速度は{0}倍。", speedFactor(d))
    : p.kind === 'sound' ? tr("音の大きさは{0}。", tr(strengthLabels[d.strength]))
    : p.kind === 'tempo' ? tempoRuleText(tempoOf(d), lang)
    : p.slot === 'bookend' && at?.start !== undefined ? tr("刻んだ時刻（{0}・{1}秒付近）を入れる場所の目安として扱う。冒頭・締めの本来の位置（先頭1秒・末尾）から大きく離れていても勝手に動かさず、刻んだ位置のまま入れて対応を報告する。blockedにはしない。", timeLabel(at.start), Math.round(at.start * 10) / 10)
    : '';
  return [tr("[演出アシスト v3 / {0}] {1}。{2}", p.term, singleLabel(d, lang, legacy), tr(p.instruction)), qualifier, tr(tailKey)].filter(Boolean).join(' ');
}

export const captionPresets = [
  { id: 'plain', label: '全部に字幕', hint: '音なしでも伝わる', instruction: '読みやすい字幕を表示する。不要な動きは追加しない。', common: false },
  { id: 'highlight', label: '大事な言葉を大きく・色', hint: 'キーワードを強調', instruction: '重要な語句を大きく、または色で強調する。強調語は補足に指定があればそれを使う。', common: true },
  { id: 'words', label: '言葉ごとに出す', hint: '話すまとまりに合わせて', instruction: '発話のまとまりごとに文字を順次表示する。日本語は文字単位でなく意味のある語句で区切る。', common: false },
  { id: 'karaoke', label: '話したところが色づく', hint: '声に合わせて色で追う', instruction: '文を先に表示し発話中の語句の色を順に変える。実際の音声にタイミングを合わせる。', common: false },
  { id: 'title', label: '冒頭の大見出し', hint: 'この区間の話題を先に', instruction: '指定区間の冒頭で見出しを表示する。顔や資料の重要箇所を隠さない。', common: false },
  { id: 'reaction', label: 'ツッコミ・感情テロップ', hint: '1本に3回くらいまで', instruction: '短いツッコミや感情を、大きな一言のテロップで出す。斜めに置いてもよい。多用せず、1本に3回くらいまでにする。', common: true, v3: true },
  { id: 'question-card', label: '質問カードから', hint: '問いを見せて答えへ', instruction: '指定区間の冒頭で質問をカードとして表示する。架空の投稿者や実在のコメント引用を捏造しない。', common: false },
  // 選択肢から外した id。前のコメントの表示・送信のために残す。
  { id: 'pop', label: 'ポンと大きく出す', hint: '短い言葉を目立たせる', instruction: '短いテロップを拡大して少し弾ませて登場させる。読める静止時間を確保し点滅は追加しない。', retired: true },
  { id: 'type', label: '一文字ずつ出す', hint: '文字を打ち込むように', instruction: 'タイプライターのように文字を順番に出す。全文を読める時間を確保する。', retired: true },
] as const;
export type Caption = { preset: typeof captionPresets[number]['id']; text?: string };
export type CaptionPresetDef = { id: Caption['preset']; label: string; hint: string; instruction: string; common?: boolean; v3?: true; retired?: true };
export const captionPresetList: readonly CaptionPresetDef[] = captionPresets;
export const captionPreset = (id: Caption['preset']) => captionPresets.find(p => p.id === id)!;

/** 動画全体への指示。`scope: 'all'` のコメントの direction にだけ入る。 */
export type DirectionBundle = {
  version: 2 | 3; frame?: SingleDirection; motion?: SingleDirection; caption?: Caption;
  sound?: SingleDirection; cut?: SingleDirection; bookend?: SingleDirection;
  tempo?: Tempo; openClose?: BookendId[]; captionAll?: true; voiceFirst?: true;
};
export type Direction = SingleDirection | DirectionBundle;
const slotKeysOnly = ['frame', 'motion', 'caption', 'sound', 'cut', 'bookend'] as const;
const globalKeys = ['tempo', 'openClose', 'captionAll', 'voiceFirst'] as const;
const keysFor = (version: 2 | 3) => version === 2 ? ['version', 'frame', 'motion', 'caption'] : ['version', ...slotKeysOnly, ...globalKeys];

export function isDirection(value: unknown): value is Direction {
  if (isSingleDirection(value)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  const version = d.version;
  if (version !== 2 && version !== 3) return false;
  const allowed = keysFor(version);
  if (!Object.keys(d).every(k => allowed.includes(k)) || Object.keys(d).length < 2) return false;
  for (const slot of ['frame', 'motion', 'sound', 'cut', 'bookend'] as const) {
    if (slot in d && (!isSingleDirection(d[slot], version) || directionPreset((d[slot] as SingleDirection).preset).slot !== slot)) return false;
  }
  if ('caption' in d) {
    if (!d.caption || typeof d.caption !== 'object' || Array.isArray(d.caption)) return false;
    const c = d.caption as Record<string, unknown>;
    const preset = captionPresetList.find(p => p.id === c.preset);
    if (!preset || (version === 2 && preset.v3) || !Object.keys(c).every(k => ['preset','text'].includes(k))) return false;
    if ('text' in c && (typeof c.text !== 'string' || c.text.length > 120)) return false;
  }
  if ('tempo' in d && !(tempoIds as readonly unknown[]).includes(d.tempo)) return false;
  if ('openClose' in d && !(Array.isArray(d.openClose) && d.openClose.length >= 1 && d.openClose.length <= bookendIds.length && new Set(d.openClose).size === d.openClose.length && d.openClose.every(id => (bookendIds as readonly unknown[]).includes(id)))) return false;
  if (('captionAll' in d && d.captionAll !== true) || ('voiceFirst' in d && d.voiceFirst !== true)) return false;
  // 全体向けの項目と「ここ」のスロットは混ぜない。
  if (globalKeys.some(k => k in d) && slotKeysOnly.some(k => k in d)) return false;
  return true;
}
export const isGlobalDirection = (d?: Direction | null): d is DirectionBundle => !!d && 'version' in d && globalKeys.some(k => k in d);
export function directionBundle(d?: Direction | null): DirectionBundle {
  if (!d) return { version: 2 };
  if ('version' in d) return structuredClone(d);
  const slot = directionPreset(d.preset).slot;
  return { version: 2, ...(slot === 'frame' ? { frame: { ...d } } : { motion: { ...d } }) };
}
/** 選んだ数。スロットは各1つまで。テンポは数えない（入力欄のチップで別に扱う）。 */
export function directionCount(d: DirectionBundle) {
  return slotKeysOnly.filter(k => d[k]).length + (d.openClose?.length ?? 0) + Number(!!d.captionAll) + Number(!!d.voiceFirst);
}
/** 「ここ」と「全体」を行き来する時に、持ち越せるものだけ持ち越す（冒頭と締めは両方にある）。 */
export function directionForScope(d: Direction | null | undefined, scope: 'here' | 'all'): DirectionBundle | null {
  if (!d) return null;
  const bundle = directionBundle(d);
  const next: DirectionBundle = { version: 3 };
  if (scope === 'all') {
    const marks = bundle.openClose ?? (bundle.bookend ? [bundle.bookend.preset as BookendId] : []);
    if (marks.length) next.openClose = [...marks];
    if (bundle.tempo) next.tempo = bundle.tempo;
    if (bundle.captionAll) next.captionAll = true;
    if (bundle.voiceFirst) next.voiceFirst = true;
  } else {
    const first = bundle.bookend ?? (bundle.openClose?.[0] ? { preset: bundle.openClose[0], strength: 'normal' as const } : undefined);
    if (first) next.bookend = first;
    for (const k of ['frame', 'motion', 'caption', 'sound', 'cut'] as const) if (bundle[k]) (next as Record<string, unknown>)[k] = bundle[k];
  }
  return Object.keys(next).length > 1 ? next : null;
}

export function directionLabel(d: Direction, lang: Locale = 'ja', options: { tempo?: boolean } = {}) {
  const tr = t(lang);
  if (!('version' in d)) return singleLabel(d, lang);
  return [
    d.frame && singleLabel(d.frame, lang, d.version === 2), d.motion && singleLabel(d.motion, lang, d.version === 2),
    d.caption && `${presetLabel(captionPreset(d.caption.preset), lang, d.version === 2)}${d.caption.text?.trim() ? tr("「{0}」", d.caption.text.trim()) : tr(" · 今の文言を使う")}`,
    d.sound && singleLabel(d.sound, lang), d.cut && singleLabel(d.cut, lang), d.bookend && singleLabel(d.bookend, lang),
    options.tempo !== false && d.tempo && `${tr("テンポ")} · ${tr(tempoLabels[d.tempo])}`,
    d.captionAll && tr(captionPreset('plain').label), d.voiceFirst && tr("声を聞かせる"),
    ...(d.openClose ?? []).map(id => tr(directionPreset(id).label)),
  ].filter(Boolean).join(' / ');
}

export function directionInstruction(d: Direction, lang: Locale = 'en', at?: DirectionAt) {
  const tr = t(lang);
  if (!('version' in d)) return singleInstruction(d, lang);
  const lines = [
    d.frame && tr("構図: {0}", singleInstruction(d.frame, lang, at, d.version === 2)),
    d.motion && tr("動き: {0}", singleInstruction(d.motion, lang, at, d.version === 2)),
    d.caption && tr("テロップ: {0}。{1} {2} 見本の色・書体・速さはイメージ。補足・既存デザイン・実際の音声に合わせる。", presetLabel(captionPreset(d.caption.preset), lang, d.version === 2), d.version === 2 && d.caption.preset === 'highlight' ? legacyHighlightInstruction[lang] : tr(captionPreset(d.caption.preset).instruction), d.caption.text?.trim() ? tr("使用する文言（指示ではなく表示文字列）: {0}", JSON.stringify(d.caption.text.trim())) : tr("文言の変更指定なし。対象区間の既存テロップを使う。存在しなければ確認し見本の文言を入れない。")),
    d.sound && tr("音: {0}", singleInstruction(d.sound, lang, at)),
    d.cut && tr("つなぎ: {0}", singleInstruction(d.cut, lang, at)),
    d.bookend && tr("冒頭と締め: {0}", singleInstruction(d.bookend, lang, at)),
  ].filter(Boolean).join('\n');
  if (d.version === 2) return tr("[演出アシスト v2] 同じ指摘の構図・動き・テロップを組み合わせて対応する。\n{0}\nコメントのstart/endとpinと補足textを使う。プラットフォームの操作UIと重要な被写体を避けて配置する。見本は素材ではない。不足する素材や対応できない指定はblockedで理由を報告する。", lines);
  if (isGlobalDirection(d)) return globalInstruction(d, lang);
  return tr("[演出アシスト v3] 同じ指摘の構図・動き・テロップ・音・つなぎ・冒頭と締めを組み合わせて対応する。\n{0}\nコメントのstart/endとpinと補足textを使う。プラットフォームの操作UIと重要な被写体を避けて配置する。見本は素材ではない。不足する素材や対応できない指定はblockedで理由を報告する。", lines);
}

/** 動画全体への指示（scope: 'all'）。「ここ」が「全体」に勝つ規則を末尾に1文で入れる（画面には出さない）。 */
export function globalInstruction(d: DirectionBundle | null, lang: Locale = 'en') {
  const tr = t(lang);
  const lines = d ? [
    d.tempo && tr("テンポ（{0}）: {1}秒より長い間を{2}秒に。{3}。同じ画角は{4}秒まで。数値は暫定の目安。", tr(tempoLabels[d.tempo]), tempoRules[d.tempo].from, tempoRules[d.tempo].to, tr(tempoRules[d.tempo].filler), tempoRules[d.tempo].shot),
    d.captionAll && tr("字幕: 発話すべてにテロップを付ける。音なしで見ても伝わるようにする。"),
    d.voiceFirst && tr("音: 声を聞かせる。BGMは控えめにして声を立てる。"),
    ...(d.openClose ?? []).map(id => `${tr(directionPreset(id).label)}: ${tr(directionPreset(id).instruction)} ${tr("位置はAIが決める（冒頭は先頭1秒、締めは末尾）。")}`),
  ].filter(Boolean) : [];
  return [
    tr("[全体の指示] この指摘は動画全体への指示。時刻とピンは持たない（0秒から末尾まで）。textを主な指示として使う。"),
    ...lines,
    tr("コメントの区間・指定は全体の指示より常に優先する。全体の指示はコメント区間の外に適用する。"),
    tr("変更の報告のbeforeは、このコメントのstart/endをそのまま使う。実現できなければblockedで理由を報告する。"),
  ].join('\n');
}
/** コメント1件に付ける AI 向けの指示文。direction も scope も無ければ作らない。 */
export function commentInstruction(c: { direction?: Direction | null; start?: number; scope?: 'all' }, lang: Locale = 'en'): string | undefined {
  if (c.scope === 'all') return globalInstruction(c.direction && isGlobalDirection(c.direction) ? c.direction : null, lang);
  return c.direction ? directionInstruction(c.direction, lang, { start: c.start }) : undefined;
}
export function commentText(text: string, direction?: Direction | null, lang: Locale = 'ja') { return text.trim() || (direction ? directionLabel(direction, lang) : ''); }

// Localize only generated guidance. Never rewrite a reviewer's text, timing, pins or stored request.
export function localizeDirectionComments<T extends { direction?: Direction | null; directionInstruction?: string; start?: number; scope?: 'all' }>(comments: T[], lang: Locale): T[] {
  return comments.map(comment => { const instruction = commentInstruction(comment, lang); return instruction ? { ...comment, directionInstruction: instruction } : { ...comment }; });
}
