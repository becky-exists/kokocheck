import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { directionPresets, captionPresets, captionPresetList, isDirection, isSingleDirection, directionInstruction, directionLabel, commentText, commentInstruction, localizeDirectionComments, directionBundle, directionCount, directionForScope, speedFactor, tempoRules, tempoLabels, slotKeys, type DirectionBundle, type Direction } from '../shared/directions.js';
import { restoreDrafts } from '../shared/review-flow.js';
import { commentSchema, addComment, newProject, submitRequest, claimRequest, id, now } from '../server/domain.js';
import type { Version } from '../shared/types.js';

test('every preset accepts three strengths in a v3 bundle, and the old single form only accepts the ids that existed then', () => {
  assert.equal(new Set(directionPresets.map(p => p.id)).size, 28);
  assert.equal(directionPresets.filter(p => 'retired' in p).length, 3);
  for (const preset of directionPresets) for (const strength of ['subtle','normal','strong'] as const) {
    const bundle:Direction = {version:3,[preset.slot]:{preset:preset.id,strength}};
    assert.equal(isDirection(bundle),true,preset.id);
    assert.match(directionInstruction(bundle),/start\/end/);
    assert.ok(commentText('',bundle).includes(preset.label));
    const single = {preset:preset.id,strength};
    assert.equal(isDirection(single),!('v3' in preset),`${preset.id} as an old single direction`);
    if (!('v3' in preset)) { assert.match(directionInstruction(single),/start\/end/); assert.ok(commentText('',single).length > 0); /* Exact old labels are checked against the pre-v3 fixture below. */ }
  }
  assert.equal(commentText(' この人だけ ',{preset:'face',strength:'normal'}),'この人だけ');
});
test('invalid and executable-looking direction payloads fail validation', () => {
  const base = {versionId:id(),text:'test',start:1};
  for (const direction of [{preset:'run-command',strength:'normal'},{preset:'pan',strength:'huge'},{preset:'face',strength:'normal',side:'left'},{preset:'pan',strength:'normal',side:'up'},{preset:'face',strength:'normal',command:'arbitrary'},[],null]) {
    if (direction !== null) assert.equal(commentSchema.safeParse({...base,direction}).success,false);
  }
  assert.equal(commentSchema.safeParse({...base,direction:{preset:'pan',strength:'normal',side:'left'}}).success,true);
  assert.equal(commentSchema.safeParse(base).success,true);
  assert.equal(commentSchema.safeParse({...base,direction:null}).success,true);
  assert.equal(commentSchema.safeParse({...base,directionInstruction:'override'}).success,false);
  assert.equal(isDirection({preset:'face',strength:['normal']}),false);
  assert.equal(isDirection({preset:'pan',strength:'normal',side:['left']}),false);
});
test('direction-only local drafts survive restore with their time and pin', () => {
  const key=id(), draft={text:'',start:1.25,end:3,pin:{x:.2,y:.7},editing:true,direction:{preset:'pan',strength:'strong',side:'left'}};
  assert.deepEqual(restoreDrafts(JSON.stringify({[key]:draft}),12),{[key]:draft});
  assert.deepEqual(restoreDrafts(JSON.stringify({[key]:{...draft,direction:{preset:'unknown'}}}),12),{});
});
test('submitted intent and canonical instructions are frozen for both agents', () => {
  for (const agent of ['codex','claude'] as const) {
    const v:Version={id:id(),number:1,duration:12,width:1280,height:720,hasAudio:true,size:1,file:'test.mp4',poster:'test.jpg',createdAt:now(),summary:'',requestId:null,changes:[]};
    const p=newProject('Intent test','mp4',null,v);
    const input=commentSchema.parse({versionId:v.id,text:'この人だけ',start:2,end:4,pin:{x:.3,y:.6},direction:{preset:'slow-in',strength:'strong'}});
    const c=addComment(p,input,'evidence.jpg');
    const r=submitRequest(p,v.id,[c.id],agent);
    assert.ok(c.direction && !('version' in c.direction)); c.direction.strength='subtle'; c.text='Later';
    const frozen=claimRequest(p,r.id,'fixture',agent).comments[0];
    assert.ok(frozen.direction && !('version' in frozen.direction)); assert.equal(frozen.direction.strength,'strong');
    assert.equal(frozen.text,'この人だけ');
    assert.deepEqual(frozen.pin,{x:.3,y:.6});
    assert.deepEqual([frozen.start,frozen.end],[2,4]);
    assert.match(frozen.directionInstruction!,/Slow zoom-in/);
    assert.match(frozen.directionInstruction!,/Strong/);
  }
});

test('bundles validate category boundaries and reject empty or malformed selections',()=>{
  for(const direction of [
    {version:2}, {version:3}, {version:4,caption:{preset:'plain'}}, {version:3,tempo:'fast'},
    {version:2,caption:{preset:'unknown'}}, {version:2,caption:{preset:'plain',text:['test']}},
    {version:2,caption:{preset:'plain',text:'a'.repeat(121)}},
    {version:2,caption:{preset:'plain',command:'execute'}},
    {version:2,frame:{preset:'pan',strength:'normal'}},
    {version:2,motion:{preset:'overlay',strength:'normal'}},
    {version:2,caption:{preset:'plain'},frame:null},
  ]) assert.equal(isDirection(direction),false);
  assert.equal(isDirection({version:2,caption:{preset:'plain',text:''}}),true);
  assert.deepEqual(directionBundle({preset:'face',strength:'strong'}),{version:2,frame:{preset:'face',strength:'strong'}});
  assert.deepEqual(directionBundle({preset:'hold',strength:'normal'}),{version:2,motion:{preset:'hold',strength:'normal'}});
});
test('combined caption intent is preserved through drafts and immutable claims for both agents',()=>{
  const direction:DirectionBundle={version:2,frame:{preset:'stack',strength:'normal'},motion:{preset:'pan',strength:'subtle',side:'left'},caption:{preset:'words',text:'タイヤと旅'}};
  const key=id(),draft={text:'',start:2,end:4,pin:{x:.2,y:.7},editing:true,direction};
  assert.deepEqual(restoreDrafts(JSON.stringify({[key]:draft}),12),{[key]:draft});
  assert.match(commentText('',direction),/タイヤと旅/);
  assert.match(directionInstruction({version:2,caption:{preset:'plain'}},'ja'),/既存テロップを使う/);
  assert.doesNotMatch(directionInstruction({version:2,caption:{preset:'plain'}}),/タイヤ/);
  for(const agent of ['codex','claude'] as const){
    const v:Version={id:id(),number:1,duration:12,width:1280,height:720,hasAudio:true,size:1,file:'test.mp4',poster:'test.jpg',createdAt:now(),summary:'',requestId:null,changes:[]};
    const p=newProject('Combined test','mp4',null,v);
    const c=addComment(p,commentSchema.parse({versionId:v.id,start:draft.start,end:draft.end,pin:draft.pin,direction:structuredClone(direction),text:commentText('',direction)}),'evidence.jpg');
    const r=submitRequest(p,v.id,[c.id],agent);
    assert.ok(c.direction && 'version' in c.direction); c.direction.caption!.text='後の変更';
    const frozen=claimRequest(p,r.id,'fixture',agent).comments[0];
    assert.deepEqual(frozen.direction,direction);
    assert.match(frozen.directionInstruction!,/Framing:/); assert.match(frozen.directionInstruction!,/Motion:/); assert.match(frozen.directionInstruction!,/Captions:/);
  }
});

const wholeVersion = ():Version => ({id:id(),number:1,duration:12,width:1280,height:720,hasAudio:true,size:1,file:'test.mp4',poster:'test.jpg',createdAt:now(),summary:'',requestId:null,changes:[]});
const normal = {strength:'normal' as const};

test('a comment carries at most one choice per slot, every id stays in its own slot, and v2 data cannot carry the new slots', () => {
  assert.deepEqual([...slotKeys], ['frame','motion','caption','sound','cut','bookend']);
  const full:DirectionBundle = {version:3,frame:{preset:'face',...normal},motion:{preset:'snap-in',strength:'strong'},caption:{preset:'reaction'},sound:{preset:'sfx-in',strength:'subtle'},cut:{preset:'tighten',strength:'strong'},bookend:{preset:'call-to-action',...normal}};
  assert.equal(isDirection(full), true); assert.equal(directionCount(full), 6);
  const bad:unknown[] = [
    {...full,sound:[{preset:'sfx-in',...normal},{preset:'sfx-hit',...normal}]},
    {...full,sound2:{preset:'sfx-hit',...normal}},
    {...full,sound:{preset:'tighten',...normal}}, {...full,cut:{preset:'sfx-in',...normal}}, {...full,frame:{preset:'snap-in',...normal}},
    {...full,bookend:{preset:'face',...normal}}, {...full,bookend:[{preset:'loop-end',...normal}]}, {...full,caption:{preset:'sfx-in'}},
    {...full,motion:{preset:'speed',strength:'normal',mode:'sideways'}}, {...full,frame:{preset:'face',strength:'normal',mode:'fast'}},
    {version:2,sound:{preset:'sfx-in',...normal}}, {version:2,cut:{preset:'tighten',...normal}}, {version:2,tempo:'normal'},
    {version:2,motion:{preset:'speed',...normal}}, {version:2,frame:{preset:'match-expression',...normal}}, {version:2,caption:{preset:'reaction'}},
    {version:3,frame:{preset:'face',...normal},tempo:'normal'},
    {version:3,openClose:[]}, {version:3,openClose:['loop-end','loop-end']}, {version:3,openClose:['face']}, {version:3,captionAll:false}, {version:3,voiceFirst:'yes'},
  ];
  for (const direction of bad) {
    assert.equal(isDirection(direction), false, JSON.stringify(direction));
    assert.equal(commentSchema.safeParse({versionId:id(),text:'x',start:1,direction}).success, false, `the server refuses it too: ${JSON.stringify(direction)}`);
  }
  assert.equal(isDirection({version:3,motion:{preset:'speed',strength:'strong',mode:'fast'}}), true);
  assert.equal(commentSchema.safeParse({versionId:id(),text:'x',start:1,direction:full}).success, true);
  assert.deepEqual([0,1,2].map(i => speedFactor({strength:(['subtle','normal','strong'] as const)[i],mode:'slow'})), [.75,.5,.25]);
  assert.deepEqual([0,1,2].map(i => speedFactor({strength:(['subtle','normal','strong'] as const)[i],mode:'fast'})), [1.25,1.5,2]);
  assert.equal(speedFactor(normal), .5, 'no mode means slower');
});

test('retired choices leave the picker but old comments still read, label and send exactly as before', async () => {
  assert.deepEqual(directionPresets.filter(p => 'retired' in p).map(p => p.id).sort(), ['pan','side-info','two']);
  assert.deepEqual(captionPresetList.filter(p => p.retired).map(p => p.id).sort(), ['pop','type']);
  assert.equal(captionPresets.filter(p => !('retired' in p)).length, 7);
  const golden = JSON.parse(await readFile('tests/fixtures/direction-before-v3.json','utf8')) as { c:Direction; lang:'ja'|'en'; label:string; ins:string }[];
  assert.ok(golden.length >= 10);
  for (const row of golden) {
    assert.equal(isDirection(row.c), true);
    assert.equal(directionLabel(row.c,row.lang), row.label);
    assert.equal(directionInstruction(row.c,row.lang), row.ins, 'the text an agent reads for old data did not change');
  }
  // 古いコメントを開いて保存し直しても、外した演出はそのまま持ち越せる。
  assert.equal(isDirection({version:3,motion:{preset:'pan',strength:'normal',side:'left'},caption:{preset:'pop'}}), true);
  assert.match(commentText('',{version:2,caption:{preset:'type'}}), /一文字ずつ出す/);
  // 古い v2 の束は、新しい v3 の指示文ではなく、今までの v2 の文のまま出る。
  assert.match(directionInstruction({version:2,frame:{preset:'sides',...normal}},'ja'), /\[演出アシスト v2\]/);
  assert.match(directionInstruction({version:3,frame:{preset:'sides',...normal}},'ja'), /\[演出アシスト v3\]/);
});

test('間を詰める in a moment and the whole-video tempo use the same three words and the same numbers', () => {
  assert.deepEqual(Object.values(tempoLabels), ['やわらかく','ふつう','攻める']);
  for (const [strength,tempo] of [['subtle','soft'],['normal','normal'],['strong','tight']] as const) {
    const rule = tempoRules[tempo], here:DirectionBundle = {version:3,cut:{preset:'tighten',strength}};
    for (const lang of ['ja','en'] as const) {
      const moment = directionInstruction(here,lang)!, whole = commentInstruction({scope:'all',direction:{version:3,tempo}},lang)!;
      const ruleText = lang === 'ja' ? `${rule.from}秒より長い間を${rule.to}` : `longer than ${rule.from}s to ${rule.to}s`;
      assert.ok(moment.includes(ruleText) && whole.includes(ruleText), `${tempo}/${lang}: the same pause rule`);
      assert.ok(lang === 'ja' ? whole.includes(`同じ画角は${rule.shot}秒まで`) : whole.includes(`one shot for ${rule.shot}s at most`));
      assert.match(moment, lang === 'ja' ? /暫定の目安/ : /provisional/); assert.match(whole, lang === 'ja' ? /暫定の目安/ : /provisional/);
    }
    assert.ok(directionLabel(here).includes(tempoLabels[tempo]));
  }
  assert.equal(commentText('',{version:3,tempo:'normal'}), 'テンポ · ふつう', 'a tempo chip alone is a valid request');
  assert.equal(commentText('',{version:3,tempo:'normal'},'en'), 'Tempo · Normal');
});

test('a whole-video comment is a plain comment with scope all: no time, no pin, no per-moment choices, and it needs no chip or choice', () => {
  const base = {versionId:id(),text:'全体的にテンポよく',start:0};
  assert.equal(commentSchema.safeParse({...base,scope:'all'}).success, true, 'text alone is enough');
  assert.equal(commentSchema.safeParse({...base,scope:'all',direction:{version:3,tempo:'tight',captionAll:true,voiceFirst:true,openClose:['open-conclusion','call-to-action']}}).success, true);
  const bad:Record<string,unknown>[] = [
    {scope:'all',start:3}, {scope:'all',end:4}, {scope:'all',pin:{x:.5,y:.5}},
    {scope:'all',direction:{version:3,frame:{preset:'face',...normal}}}, {scope:'all',direction:{preset:'face',...normal}},
    {scope:'all',direction:{version:3,bookend:{preset:'loop-end',...normal}}}, {scope:'here'},
    {direction:{version:3,tempo:'normal'}}, {direction:{version:3,openClose:['loop-end']}}, {direction:{version:3,captionAll:true}},
  ];
  for (const extra of bad) assert.equal(commentSchema.safeParse({...base,...extra}).success, false, JSON.stringify(extra));
  for (const agent of ['codex','claude'] as const) for (const direction of [undefined,{version:3 as const,tempo:'normal' as const}]) {
    const v = wholeVersion(), p = newProject('Whole video','mp4',null,v);
    const c = addComment(p, commentSchema.parse({versionId:v.id,text:'全体にテンポよく',start:0,scope:'all',...(direction?{direction}:{})}), 'evidence.jpg');
    assert.equal(c.scope,'all'); assert.deepEqual([c.start,c.end,c.pin],[0,v.duration,null], 'saved as the whole range, 0 to the end');
    assert.match(c.directionInstruction!, /Whole-video instruction/, 'even with text only, the agent is told it is a whole-video note');
    const r = submitRequest(p,v.id,[c.id],agent);
    c.text = 'later'; delete c.scope;
    const frozen = claimRequest(p,r.id,'fixture',agent).comments[0];
    assert.equal(frozen.scope,'all'); assert.equal(frozen.text,'全体にテンポよく');
    for (const [lang,pattern] of [['ja',/コメントの区間・指定は全体の指示より常に優先する。全体の指示はコメント区間の外に適用する。/],['en',/own range and choices always take precedence over the whole-video instruction\. Apply the whole-video instruction outside comment ranges/]] as const) {
      const localized = localizeDirectionComments([frozen],lang)[0].directionInstruction!;
      assert.match(localized,pattern); assert.equal(localized.trim().split('\n').at(-2), localized.split('\n').find(l => pattern.test(l)));
    }
  }
  assert.equal(commentInstruction({start:2}), undefined, 'a plain comment gets no generated text');
});

test('a bookend picked at a moment keeps the time it was pinned at as the place to put it; from the whole video the agent chooses', () => {
  const d:DirectionBundle = {version:3,bookend:{preset:'call-to-action',...normal}};
  const en = commentInstruction({direction:d,start:11.46},'en')!, ja = commentInstruction({direction:d,start:11.46},'ja')!;
  assert.match(en,/placement hint/); assert.ok(en.includes('0:11') && en.includes('11.5'));
  assert.match(ja,/入れる場所の目安/); assert.ok(ja.includes('0:11') && ja.includes('11.5'));
  assert.match(en,/do not move it yourself/); assert.match(en,/Do not report blocked/);
  const whole = commentInstruction({scope:'all',direction:{version:3,openClose:['open-conclusion','close-summary']}},'en')!;
  assert.match(whole,/Choose the position yourself/); assert.doesNotMatch(whole,/placement hint/);
  assert.doesNotMatch(commentInstruction({direction:{version:3,sound:{preset:'sfx-in',...normal}},start:3},'en')!,/placement hint/);
});

test('switching between 「ここ」 and 「全体」 carries over only what both can hold (the opening and closing)', () => {
  assert.deepEqual(directionForScope({version:3,bookend:{preset:'loop-end',...normal},frame:{preset:'face',...normal}},'all'), {version:3,openClose:['loop-end']});
  assert.deepEqual(directionForScope({version:3,openClose:['close-summary','loop-end'],tempo:'soft'},'here'), {version:3,bookend:{preset:'close-summary',...normal}});
  assert.equal(directionForScope({version:3,frame:{preset:'face',...normal}},'all'), null);
  assert.equal(directionForScope({version:3,tempo:'soft'},'here'), null);
  assert.equal(directionForScope(null,'all'), null);
});

test('all v1 and v2 labels and instructions match the pre-v3 release byte for byte in both languages', async () => {
  const golden = JSON.parse(await readFile('tests/fixtures/direction-legacy-v1-v2.json', 'utf8')) as { c:Direction; lang:'ja'|'en'; label:string; ins:string }[];
  for (const row of golden) {
    assert.equal(isDirection(row.c), true, JSON.stringify(row.c));
    assert.equal(directionLabel(row.c, row.lang), row.label, `${JSON.stringify(row.c)} / ${row.lang}`);
    assert.equal(directionInstruction(row.c, row.lang), row.ins, `${JSON.stringify(row.c)} / ${row.lang}`);
  }
  // New selections keep the new meaning, while old highlights remain color-only.
  for (const lang of ['ja','en'] as const) {
    const modern = directionInstruction({version:3,caption:{preset:'highlight'}},lang);
    assert.match(modern,lang==='ja'?/大きく、または色/:/enlarging them or coloring/);
    assert.doesNotMatch(directionInstruction({version:2,caption:{preset:'highlight'}},lang),lang==='ja'?/大きく、または色/:/enlarging them or coloring/);
  }
});

test('local tighten carries the same maximum shot duration as whole-video tempo in Japanese and English', () => {
  for (const [strength,tempo] of [['subtle','soft'],['normal','normal'],['strong','tight']] as const) for (const lang of ['ja','en'] as const) {
    const here = commentInstruction({start:2,direction:{version:3,cut:{preset:'tighten',strength}}},lang)!;
    const all = commentInstruction({scope:'all',direction:{version:3,tempo}},lang)!;
    const expected = lang==='ja' ? `同じ画角は${tempoRules[tempo].shot}秒まで` : `one shot for ${tempoRules[tempo].shot}s at most`;
    assert.ok(here.includes(expected), `${tempo}/${lang}: local instruction must carry the shot limit`);
    assert.ok(all.includes(expected));
  }
});
