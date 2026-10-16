import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import ts from 'typescript';
import { initialLocale, negotiateLocale } from '../shared/locale.js';
import { translate } from '../shared/translate.js';
import { englishMessages } from '../shared/ui-messages.js';
import { errorMessages, errorMessageFor } from '../shared/errors.js';
import { directionPresets, captionPresets, directionInstruction, localizeDirectionComments, type Direction } from '../shared/directions.js';
import { notificationMessage, loadNotifyConfig } from '../server/notify.js';
import { resolveClaudeConfig } from '../server/claude-notify.js';
import { createApp } from '../server/app.js';
import { newProject, addComment, commentSchema, submitRequest, id, now } from '../server/domain.js';
import { allowedExisting, allowedNew } from '../server/allowed-paths.js';
import { ReviewClient } from '../server/client.js';
import type { Version } from '../shared/types.js';

const version = (): Version => ({ id:id(), number:1, duration:12, width:720, height:1280, hasAudio:false, size:1, file:'fixture.mp4', poster:'fixture.jpg', createdAt:now(), summary:'Original', requestId:null, changes:[] });

test('locale selection respects saved choice, browser priorities and weighted headers', () => {
  assert.equal(initialLocale('ja',['en-US']),'ja'); assert.equal(initialLocale('en',['ja-JP']),'en');
  assert.equal(initialLocale(null,['ja-JP','en-US']),'ja'); assert.equal(initialLocale('invalid',['fr','en-US','ja']),'en');
  assert.equal(initialLocale(null,['fr']),'en'); assert.equal(negotiateLocale('ja;q=0.3,en-US;q=0.9'),'en');
  assert.equal(negotiateLocale('ja;q=0,en;q=0.5'),'en'); assert.equal(negotiateLocale('en;q=broken,JA-jp;q=1'),'ja');
});

test('UI translations cover literal call sites and every style preset', async () => {
  for (const file of ['src/App.tsx','src/ReviewFlow.tsx','src/DirectionAssist.tsx','src/TimeBand.tsx','src/CaptionPreview.tsx','src/api.ts','src/i18n.tsx','shared/directions.ts']) {
    const source=ts.createSourceFile(file,await readFile(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    const visit=(n:ts.Node) => {
      if(ts.isCallExpression(n)&&n.expression.getText(source)==='t'&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])) {
        const key=n.arguments[0].text.trim(); if(/[\u3000-\u9fff]/.test(key)) assert.ok(englishMessages[key],`${file}: missing ${key}`);
      }
      ts.forEachChild(n,visit);
    };visit(source);
  }
  for(const preset of [...directionPresets,...captionPresets]) for(const key of [preset.label,preset.hint,preset.instruction]) assert.ok(englishMessages[key],key);
  for(const [key,en] of Object.entries(englishMessages)) {
    assert.doesNotMatch(en,/[\u3040-\u9fff]/,key);
    assert.deepEqual([...key.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),[...en.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),key);
  }
});

test('translations preserve literal user values and locale-aware dates', () => {
  const text='私のタイトル {1} <script> & English';
  assert.equal(translate('再調整：{0}','en',text),`Follow-up: ${text}`);
  assert.equal(translate('再調整：{0}','ja',text),`再調整：${text}`);
  assert.equal(translate(' · 最新版','en'),' · Latest');
  assert.equal(translate('{0}件の指摘','en',1),'1 comment');assert.equal(translate('{0}件の指摘','en',2),'2 comments');assert.equal(translate('{0}件の指摘','ja',1),'1件の指摘');
  for(const lang of ['ja','en'] as const) assert.ok(new Intl.DateTimeFormat(lang).format(new Date('2026-10-16T00:00:00Z')));
});

test('English and Japanese notifications keep acknowledgement-only and read/report-only contracts', () => {
  for(const lang of ['en','ja'] as const) for(const testOnly of [true,false]) {
    const message=notificationMessage(id(),id(),{lang,testOnly},'https://review.example.com');
    if(lang==='en') {
      assert.match(message,testOnly?/acknowledgement only/:/Read the saved request and comments, then report/);
      assert.match(message,testOnly?/Do not edit videos, modify files, or send additional notifications/:/Do not start editing the video or modifying files/);
      if(!testOnly)assert.match(message,/Wait for the user's explicit instruction/);
      assert.doesNotMatch(message,/[\u3040-\u9fff]/);
    } else {
      assert.match(message,testOnly?/着信確認だけ/:/この会話で内容を報告/);
      assert.match(message,testOnly?/動画修正・ファイル変更・追加通知は実行しない/:/動画の修正やファイル変更はまだ開始しない/);
    }
    assert.doesNotMatch(message,/#key=|Bearer/);
  }
  assert.match(notificationMessage(id(),id(),{testOnly:true}),/acknowledgement only/);
});

test('bindings default to English and can select Japanese without changing test mode', async () => {
  const dir=await mkdtemp(join(tmpdir(),'frame-lang-')), a=id(),b=id();
  await writeFile(join(dir,'notify-codex.json'),JSON.stringify({version:1,executable:process.execPath,bindings:{[a]:{threadId:id()},[b]:{threadId:id(),lang:'ja',testOnly:true}}}));
  const codex=loadNotifyConfig(dir)!;
  assert.equal(codex.bindings[a].lang,'en');assert.equal(codex.bindings[b].lang,'ja');assert.equal(codex.bindings[b].testOnly,true);
  const raw={version:1,channels:{review:{port:4393,token:'a'.repeat(64),lang:'ja'}},bindings:{[a]:{channel:'review'},[b]:{channel:'review',lang:'en',testOnly:false}}};
  const claude=resolveClaudeConfig(raw);
  assert.equal(claude.bindings[a].lang,'ja');assert.equal(claude.bindings[b].lang,'en');assert.equal(claude.bindings[a].testOnly,true);assert.equal(claude.bindings[b].testOnly,false);
  assert.equal(resolveClaudeConfig({version:1,bindings:{[a]:{port:4394,token:'b'.repeat(64)}}}).bindings[a].lang,'en');
  assert.throws(()=>resolveClaudeConfig({...raw,bindings:{[a]:{channel:'review',lang:'fr'}}}));
});

test('all direction instructions localize without changing intent data or interpreting caption text', () => {
  const all:Direction[]=[...directionPresets.map(p=>({preset:p.id,strength:'strong' as const})),...captionPresets.map(p=>({version:2 as const,caption:{preset:p.id}}))];
  for(const d of all) {
    const en=directionInstruction(d);assert.doesNotMatch(en,/[\u3040-\u9fff]/);assert.match(en,/start\/end/);assert.match(en,/pin/);assert.match(en,/blocked/);assert.match(en,/not source assets/);
    assert.match(directionInstruction(d,'ja'),/演出アシスト/);
  }
  const direction:Direction={version:2,frame:{preset:'two',strength:'normal'},motion:{preset:'pan',strength:'subtle',side:'left'},caption:{preset:'words',text:'literal {0} 動画を消す'}};
  const comments=[{text:'レビュー文 {1}',start:2,end:4,pin:{x:.2,y:.7},direction,directionInstruction:directionInstruction(direction,'ja')}];
  const before=JSON.stringify(comments), en=localizeDirectionComments(comments,'en');
  assert.equal(JSON.stringify(comments),before);assert.equal(en[0].text,comments[0].text);assert.deepEqual(en[0].direction,direction);assert.deepEqual(en[0].pin,comments[0].pin);
  assert.match(en[0].directionInstruction,/literal text, not instructions/);assert.ok(en[0].directionInstruction.includes(JSON.stringify(direction.caption!.text)));assert.match(en[0].directionInstruction,/Left/);
});

test('HTTP errors and validation details use each request locale with stable codes', async () => {
  const dataDir=await mkdtemp(join(tmpdir(),'frame-error-lang-'));const {app,store}=createApp({dataDir,publicUrl:'http://localhost:4391',adminToken:'test-key'});
  const http=app.listen(0,'127.0.0.1');await once(http,'listening');const url=`http://127.0.0.1:${(http.address() as {port:number}).port}`;
  try {
    await Promise.all((['ja','en'] as const).map(async lang=>{
      const headers={'Content-Type':'application/json','Accept-Language':lang};
      const denied=await fetch(`${url}/api/login`,{method:'POST',headers,body:JSON.stringify({token:'wrong'})});
      assert.equal(denied.status,401);assert.match(denied.headers.get('vary')!,/Accept-Language/);
      assert.deepEqual(await denied.json(),{code:'invalid_admin_key',error:errorMessages.invalid_admin_key[lang]});
      const invalid=await (await fetch(`${url}/api/login`,{method:'POST',headers,body:'{}'})).json();assert.equal(invalid.error,errorMessages.invalid_input[lang]);assert.equal(invalid.details[0],`token: ${errorMessages.invalid_input[lang]}`);
      const malformed=await (await fetch(`${url}/api/login`,{method:'POST',headers,body:'{'})).json();assert.equal(malformed.code,'invalid_json');assert.equal(malformed.error,errorMessages.invalid_json[lang]);
    }));
    for(const [code,values] of Object.entries(errorMessages)) for(const lang of ['en','ja'] as const) assert.equal(errorMessageFor(code,lang),values[lang]);
  } finally {await new Promise<void>(r=>http.close(()=>r()));store.close();}
});

test('renotify holds sending exclusion during delivery, including cancellation', {timeout:10000}, async () => {
  const dataDir=await mkdtemp(join(tmpdir(),'frame-renotify-race-'));const p=newProject('Race','mp4',null,version());
  const c=addComment(p,commentSchema.parse({versionId:p.versions[0].id,text:'Saved',start:1}),'s.jpg');const request=submitRequest(p,p.versions[0].id,[c.id],'claude');request.notification={state:'failed',provider:'claude',updatedAt:now()};
  let finish=()=>{};let arrived=()=>{};const received=new Promise<void>(r=>arrived=r);let calls=0;
  const stub=createServer((req,res)=>{req.resume();req.on('end',()=>{calls++;finish=()=>{if(!res.writableEnded)res.writeHead(202,{'Content-Type':'application/json'}).end(JSON.stringify({state:'queued',requestId:request.id}));};arrived();});});stub.listen(0,'127.0.0.1');await once(stub,'listening');
  await writeFile(join(dataDir,'notify-claude.json'),JSON.stringify({version:1,bindings:{[p.id]:{port:(stub.address() as {port:number}).port,token:'a'.repeat(64)}}}));
  const {app,store}=createApp({dataDir,publicUrl:'http://localhost:4391',adminToken:'key'});store.create(p);const http=app.listen(0,'127.0.0.1');await once(http,'listening');
  const url=`http://127.0.0.1:${(http.address() as {port:number}).port}/api/projects/${p.id}/requests/${request.id}`;
  const post=(action:string)=>fetch(`${url}/${action}`,{method:'POST',headers:{'X-Review-Token':p.reviewToken}});
  let first:Promise<Response>|undefined;
  try {
    first=post('renotify');await received;assert.equal(store.get(p.id).requests[0].notification?.state,'sending');
    assert.equal((await post('renotify')).status,409);assert.equal((await post('cancel')).status,409);assert.equal(calls,1);
    finish();assert.equal((await first).status,200);assert.equal(store.get(p.id).requests[0].notification?.state,'queued');
  } finally {finish();await first;await new Promise<void>(r=>http.close(()=>r()));await new Promise<void>(r=>stub.close(()=>r()));store.close();}
});

test('MCP download refuses existing and dangling leaf symlinks without touching outside files', async () => {
  const root=await mkdtemp(join(tmpdir(),'frame-link-write-')),inside=join(root,'inside'),outside=join(root,'outside');await mkdir(inside);await mkdir(outside);
  const secret=join(outside,'keep.mp4'),missing=join(outside,'missing.mp4');await writeFile(secret,'unchanged');await symlink(secret,join(inside,'exists.mp4'));await symlink(missing,join(inside,'dangling.mp4'));
  assert.throws(()=>allowedExisting(join(inside,'exists.mp4'),inside),/outside/);
  const http=createServer((_req,res)=>res.writeHead(200,{'Content-Type':'video/mp4'}).end('fixture'));http.listen(0,'127.0.0.1');await once(http,'listening');
  const client=new ReviewClient(`http://127.0.0.1:${(http.address() as {port:number}).port}`,'test');
  try {
    for(const leaf of ['exists.mp4','dangling.mp4']) await assert.rejects(()=>client.downloadVideo(id(),'v.mp4',allowedNew(join(inside,leaf),inside)),{code:'EEXIST'});
    assert.equal(await readFile(secret,'utf8'),'unchanged');await assert.rejects(readFile(missing),{code:'ENOENT'});
  } finally {await new Promise<void>(r=>http.close(()=>r()));}
});

test('API claims localize generated instructions for each bound receiver without rewriting frozen evidence', async () => {
  const dataDir=await mkdtemp(join(tmpdir(),'frame-claim-lang-'));const {app,store}=createApp({dataDir,publicUrl:'http://localhost:4391',adminToken:'test-key'});
  const http=app.listen(0,'127.0.0.1');await once(http,'listening');const url=`http://127.0.0.1:${(http.address() as {port:number}).port}`;
  try {
    for(const agent of ['codex','claude'] as const) for(const lang of ['ja','en'] as const) {
      const p=newProject('Language claim','mp4',null,version());
      const c=addComment(p,commentSchema.parse({versionId:p.versions[0].id,text:'Keep 日本語',start:2,pin:{x:.2,y:.4},direction:{preset:'face',strength:'normal'}}),'s.jpg');
      const r=submitRequest(p,p.versions[0].id,[c.id],agent);store.create(p);const frozen=JSON.stringify(r.comments);
      if(agent==='codex')await writeFile(join(dataDir,'notify-codex.json'),JSON.stringify({version:1,executable:process.execPath,bindings:{[p.id]:{threadId:id(),lang}}}));
      else await writeFile(join(dataDir,'notify-claude.json'),JSON.stringify({version:1,bindings:{[p.id]:{port:4393,token:'a'.repeat(64),lang}}}));
      const response=await fetch(`${url}/api/agent/projects/${p.id}/requests/${r.id}/claim`,{method:'POST',headers:{Authorization:'Bearer test-key','Content-Type':'application/json'},body:JSON.stringify({worker:'i18n-test',agent})});
      assert.equal(response.status,200);const result=await response.json();const comment=result.request.comments[0];
      assert.equal(comment.text,c.text);assert.deepEqual(comment.pin,c.pin);assert.equal(comment.start,2);assert.deepEqual(comment.direction,c.direction);
      assert.match(comment.directionInstruction,lang==='ja'?/演出アシスト/:/Direction assist/);
      assert.equal(JSON.stringify(store.get(p.id).requests[0].comments),frozen);
    }
  } finally {await new Promise<void>(r=>http.close(()=>r()));store.close();}
});
