import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { createApp } from '../server/app.js';
import { createClaudeChannel } from '../server/claude-channel.js';
import { notificationMessage } from '../server/notify.js';
import { addComment, claimRequest, commentSchema, id, newProject, now, publishSchema, publishVersion, submitRequest } from '../server/domain.js';
import { captionPresetList, directionPresets, isDirection, localizeDirectionComments } from '../shared/directions.js';
import { commentBody } from '../shared/review-ui.js';
import type { Comment, Version } from '../shared/types.js';

const version = (duration = 12.345): Version => ({id:id(),number:1,duration,width:720,height:1280,hasAudio:false,size:1,file:'fixture.mp4',poster:'fixture.jpg',createdAt:now(),summary:'Original',requestId:null,changes:[]});

test('all v3-only IDs and global keys are gated across versions, slots and comment scopes', () => {
  const base = {versionId:id(),text:'Review',start:0};
  for (const p of directionPresets) {
    const single = {preset:p.id,strength:'normal'};
    assert.equal(isDirection(single), !p.v3, p.id);
    for (const v of [2,3]) for (const slot of ['frame','motion','sound','cut','bookend']) {
      const d = {version:v,[slot]:single};
      const valid = p.slot === slot && (v === 3 || !p.v3);
      assert.equal(isDirection(d),valid,JSON.stringify(d));
      assert.equal(commentSchema.safeParse({...base,direction:d}).success,valid);
      assert.equal(commentSchema.safeParse({...base,scope:'all',direction:d}).success,false);
    }
  }
  for (const p of captionPresetList) for (const v of [2,3]) {
    const d = {version:v,caption:{preset:p.id}};
    assert.equal(isDirection(d),v===3 || !p.v3);
    assert.equal(commentSchema.safeParse({...base,scope:'all',direction:d}).success,false);
  }
  for (const global of [{tempo:'normal'},{openClose:['loop-end']},{captionAll:true},{voiceFirst:true}]) {
    const direction = {version:3,...global};
    assert.equal(commentSchema.safeParse({...base,scope:'all',direction}).success,true);
    assert.equal(commentSchema.safeParse({...base,direction}).success,false);
    assert.equal(isDirection({...direction,version:2}),false);
    assert.equal(isDirection({...direction,sound:{preset:'sfx-in',strength:'normal'}}),false);
  }
  for (const direction of ['x',true,1,[],{}, {version:3}, {version:3,voiceFirst:false}]) for (const scope of [undefined,'all']) {
    assert.equal(commentSchema.safeParse({...base,scope,direction}).success,false);
  }
});

test('whole-video publication uses exact fractional duration, rejects partial before ranges, and follow-ups normalize to the new duration', () => {
  for (const agent of ['codex','claude'] as const) {
    const v=version(), p=newProject('Whole publish','mp4',null,v);
    const all=addComment(p,commentSchema.parse({versionId:v.id,start:0,scope:'all',text:'Faster throughout'}),'s.jpg');
    const here=addComment(p,commentSchema.parse({versionId:v.id,start:3,end:4,text:'Keep this pause',direction:{version:3,cut:{preset:'keep-pause',strength:'normal'}}}),'s.jpg');
    const request=submitRequest(p,v.id,[all.id,here.id],agent), claim=claimRequest(p,request.id,'test',agent);
    const next=version(8.125);
    const manifest={requestId:request.id,leaseToken:claim.leaseToken!,baseVersionId:v.id,summary:'Tighter',changes:[
      {commentId:all.id,outcome:'addressed',summary:'Tightened',before:{start:0,end:v.duration},after:{start:0,end:next.duration}},
      {commentId:here.id,outcome:'blocked',summary:'Needs footage',before:{start:3,end:4},after:null},
    ]};
    for (const before of [{start:.1,end:v.duration},{start:0,end:12}]) {
      const invalid=structuredClone(manifest);invalid.changes[0].before=before;
      assert.throws(()=>publishVersion(p,publishSchema.parse(invalid),structuredClone(next)),{code:'before_missing_comment'});
      assert.equal(p.versions.length,1);assert.equal(p.requests[0].status,'running');
      assert.equal(p.comments[0].status,'requested');
    }
    publishVersion(p,publishSchema.parse(manifest),next);
    assert.equal(p.requests[0].status,'completed');assert.deepEqual(p.versions[1].changes[0].before,{start:0,end:v.duration});
    const body=commentBody({versionId:next.id,start:7,end:null,pin:{x:.2,y:.4},followupOf:all.id,scope:'all',direction:{version:3,voiceFirst:true}},'Less music','Reviewer');
    const followup=addComment(p,commentSchema.parse(body),'s.jpg');
    assert.deepEqual([followup.scope,followup.start,followup.end,followup.pin],['all',0,next.duration,null]);
    assert.equal(all.status,'superseded');assert.match(followup.directionInstruction!,/Whole-video instruction/);
    const r2=submitRequest(p,next.id,[followup.id],agent);
    assert.equal(r2.comments[0].end,next.duration);assert.equal(r2.comments[0].scope,'all');
  }
});

test('Codex HTTP claims and Claude channel reads carry identical v3 meaning in both languages and notification modes', {timeout:30_000}, async () => {
  const dataDir=await mkdtemp(join(tmpdir(),'frame-section9-'));
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
  const port=(reserve.address() as {port:number}).port;await new Promise<void>(r=>reserve.close(()=>r()));
  const channelConfig={version:1,channels:{test:{port,token:'a'.repeat(64)}},bindings:{} as Record<string,unknown>};
  const capture=join(dataDir,'codex-args.json'), executable=join(dataDir,'mock-codex');
  await writeFile(executable,`#!${process.execPath}\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify(process.argv.slice(2)));console.log('Queued message ${id()} for thread '+process.argv[4]+'.');`,{mode:0o700});
  const codexConfig={version:1,executable,bindings:{} as Record<string,unknown>};
  await writeFile(join(dataDir,'notify-claude.json'),JSON.stringify(channelConfig));
  await writeFile(join(dataDir,'notify-codex.json'),JSON.stringify(codexConfig));
  const {app,store}=createApp({dataDir,publicUrl:'http://localhost:4391',adminToken:'test-key'});
  const http=app.listen(0,'127.0.0.1');await once(http,'listening');
  const url=`http://127.0.0.1:${(http.address() as {port:number}).port}`;
  const channel=createClaudeChannel(dataDir,{channel:'test'});
  const receiver=channel.app.listen(port,'127.0.0.1');await once(receiver,'listening');
  const client=new Client({name:'section9-test',version:'1'});
  const events:{content:string;meta:Record<string,string>}[]=[];
  client.setNotificationHandler(z.object({method:z.literal('notifications/claude/channel'),params:z.object({content:z.string(),meta:z.record(z.string(),z.string())})}),n=>{events.push(n.params);});
  const [ct,st]=InMemoryTransport.createLinkedPair();
  try {
    await channel.server.connect(st);await client.connect(ct);
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['frame_read_notified_request']);
    for (const lang of ['ja','en'] as const) for (const testOnly of [true,false]) {
      const p=newProject('Parity','mp4',null,version()), v=p.versions[0];
      for(const extra of [
        {start:0,scope:'all'},
        {start:0,scope:'all',direction:{version:3,tempo:'tight',voiceFirst:true,captionAll:true,openClose:['open-conclusion','close-summary','call-to-action','loop-end']}},
        {start:9.125,end:10,pin:{x:.3,y:.4},direction:{version:3,frame:{preset:'face',strength:'normal'},motion:{preset:'speed',strength:'strong',mode:'fast'},caption:{preset:'reaction',text:'Literal {0}'},sound:{preset:'sfx-hit',strength:'subtle'},cut:{preset:'keep-pause',strength:'normal'},bookend:{preset:'call-to-action',strength:'normal'}}},
      ]) addComment(p,commentSchema.parse({versionId:v.id,text:'Private reviewer words',...extra}),'snapshot.jpg');
      const c=structuredClone(p);c.id=id(); // Identical comment payloads, different notification providers.
      store.create(p);store.create(c);
      codexConfig.bindings[p.id]={threadId:id(),lang,testOnly};channelConfig.bindings[c.id]={channel:'test',lang,testOnly};
      await writeFile(join(dataDir,'notify-codex.json'),JSON.stringify(codexConfig));
      await writeFile(join(dataDir,'notify-claude.json'),JSON.stringify(channelConfig));
      const post=async(path:string,body:unknown)=>{const r=await fetch(url+'/api'+path,{method:'POST',headers:{Authorization:'Bearer test-key','Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,`${r.status}: ${await r.clone().text()}`);return r.json();};
      const receipts=[];
      for(const project of [p,c]) {
        const receipt=await post(`/projects/${project.id}/requests`,{versionId:v.id,commentIds:project.comments.map(x=>x.id),target:'any'});
        assert.equal(receipt.notification.state,'queued');receipts.push(receipt);
      }
      await client.ping();
      const codexArgs=JSON.parse(await readFile(capture,'utf8')) as string[];
      assert.equal(codexArgs[4],notificationMessage(p.id,receipts[0].id,{lang,testOnly},'http://localhost:4391'));
      assert.equal(events.at(-1)!.content,notificationMessage(c.id,receipts[1].id,{lang,testOnly},'http://localhost:4391'));
      for(const message of [codexArgs[4],events.at(-1)!.content]) {
        assert.doesNotMatch(message,/Private reviewer words|Literal/);
        assert.match(message,lang==='en'?(testOnly?/acknowledgement only/:/Do not start editing the video or modifying files/):(testOnly?/着信確認だけ/:/動画の修正やファイル変更はまだ開始しない/));
      }
      const frozen=JSON.stringify(store.get(c.id).requests[0].comments);
      const read=await client.callTool({name:'frame_read_notified_request',arguments:{requestId:receipts[1].id}});
      assert.ok(!read.isError);
      const received=(read.structuredContent as {comments:Comment[]}).comments;
      assert.deepEqual(received,localizeDirectionComments(store.get(c.id).requests[0].comments,lang));
      assert.equal(store.get(c.id).requests[0].status,'queued');assert.equal(store.get(c.id).requests[0].leaseToken,null);
      const claimed=await post(`/agent/projects/${p.id}/requests/${receipts[0].id}/claim`,{worker:'parity',agent:'codex'});
      assert.deepEqual(claimed.request.comments,received);
      assert.equal(JSON.stringify(store.get(c.id).requests[0].comments),frozen);
      assert.match(received[0].directionInstruction!,lang==='en'?/Whole-video instruction/:/全体の指示/);
      assert.match(received[1].directionInstruction!,lang==='en'?/take precedence/:/常に優先/);
      assert.match(received[2].directionInstruction!,lang==='en'?/placement hint/:/入れる場所の目安/);
      assert.ok(received[2].directionInstruction!.includes('9.1'));
    }
  } finally {
    await client.close();await channel.server.close();
    await new Promise<void>(r=>receiver.close(()=>r()));channel.close();
    await new Promise<void>(r=>http.close(()=>r()));store.close();
  }
});
