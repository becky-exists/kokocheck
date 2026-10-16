import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { plainSnapshotName } from '../shared/frame.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp } from '../server/app.js';
import { ReviewClient } from '../server/client.js';
import { createFixture } from '../scripts/fixture.js';
import type { ReviewProject, Comment, Request as ReviewRequest } from '../shared/types.js';
const exec = promisify(execFile);
test('HTTP, media, authorization, MCP and runner complete a persistent review loop', { timeout: 120_000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(),'frame-integration-'));
  const admin = 'test-only-' + 'a'.repeat(48);
  const { app, store } = createApp({ dataDir, publicUrl: 'http://localhost:4391', adminToken: admin });
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  const client = new ReviewClient(url,admin);
  const original = await createFixture(join(dataDir,'fixtures'));
  const revision = await createFixture(join(dataDir,'fixtures'),true);
  let p: ReviewProject;
  let key: string;
  let c: Comment;
  let req: ReviewRequest;
  try {
    await t.test('operator authentication, origin, host and forwarded bootstrap boundaries',async () => {
      assert.equal((await fetch(`${url}/api/projects`)).status,401);
      assert.equal((await fetch(`${url}/api/local-session`, { method:'POST',headers:{Origin:'https://evil.example'} })).status,403);
      assert.equal((await fetch(`${url}/api/local-session`, { method:'POST',headers:{'X-Forwarded-For':'1.2.3.4'} })).status,403);
      const deniedHost = await new Promise<number | undefined>((done, reject) => { const r = httpRequest(`${url}/api/health`, { headers: { Host: 'evil.example' } }, response => { response.resume(); done(response.statusCode); }); r.on('error', reject); r.end(); });
      assert.equal(deniedHost,403);
      const local=await fetch(`${url}/api/local-session`,{method:'POST'}); assert.equal(local.status,200); assert.match(local.headers.get('set-cookie') || '',/HttpOnly/);
      const cookie=(local.headers.get('set-cookie') || '').split(';')[0];
      assert.equal((await fetch(`${url}/api/projects`, { headers:{Cookie:cookie} })).status,200);
    });
    await t.test('upload probes real video and returns a populated source review URL',async () => {
      const registered=await client.upload<{project:ReviewProject;reviewUrl:string}>('/projects',original,{title:'Source test',mode:'source',sourceRef:'scripts/fixture.ts'});
      p=registered.project; key=new URLSearchParams(new URL(registered.reviewUrl).hash.slice(1)).get('key')!;
      assert.equal(p.mode,'source'); assert.equal(p.versions[0].width,1280); assert.ok(p.versions[0].hasAudio); assert.ok(key.length>=32);
      const invalid=join(dataDir,'invalid.mp4'); await writeFile(invalid,'not a video');
      await assert.rejects(() => client.upload('/projects',invalid,{title:'Bad',mode:'mp4'}),/Could not read the video/);
    });
    await t.test('reviewer can view and seek media but cannot enumerate projects or claim work',async () => {
      assert.equal((await fetch(`${url}/api/projects/${p.id}`)).status,403);
      const headers={'X-Review-Token':key};
      assert.equal((await fetch(`${url}/api/projects/${p.id}`,{headers})).status,200);
      assert.equal((await fetch(`${url}/api/projects`,{headers})).status,401);
      const media=await fetch(`${url}/api/projects/${p.id}/media/${p.versions[0].file}?key=${key}`,{headers:{Range:'bytes=0-99'}});
      assert.equal(media.status,206); assert.equal((await media.arrayBuffer()).byteLength,100);
      assert.equal((await fetch(`${url}/api/projects/${p.id}/media/unknown.mp4?key=${key}`)).status,404);
      const other=await client.upload<{project:ReviewProject}>('/projects',original,{title:'Standalone',mode:'mp4'});
      assert.equal((await fetch(`${url}/api/projects/${other.project.id}`,{headers})).status,403);
    });
    await t.test('comment capture creates pinned JPEG evidence and rejects invalid image coordinates/ranges',async () => {
      c=await client.post(`/projects/${p.id}/comments`,{versionId:p.versions[0].id,text:'Lower this copy',author:'Tester',start:2.5,end:4,pin:{x:.25,y:.6},direction:{version:2,frame:{preset:'overlay',strength:'normal'},motion:{preset:'slow-in',strength:'strong'},caption:{preset:'words',text:'タイヤと旅'}}});
      assert.equal(c.status,'draft'); assert.deepEqual(c.direction,{version:2,frame:{preset:'overlay',strength:'normal'},motion:{preset:'slow-in',strength:'strong'},caption:{preset:'words',text:'タイヤと旅'}}); assert.match(c.directionInstruction!,/Slow zoom-in/); const image=await client.evidence(p.id,c.snapshot); assert.ok(Buffer.from(image,'base64').byteLength>1000);
      // 画面用に、十字なしの同じコマも並んで作られる（AI に渡す十字入りの snapshot はそのまま）
      const crossed=await client.evidence(p.id,c.snapshot), plain=await client.evidence(p.id,plainSnapshotName(c.snapshot));
      assert.match(plainSnapshotName(c.snapshot),/^[a-f0-9-]+\.jpg$/); assert.ok(plain.length>1000); assert.notEqual(plain,crossed);
      await assert.rejects(() => client.post(`/projects/${p.id}/comments`,{versionId:p.versions[0].id,text:'bad',start:2,pin:{x:2,y:0}}),/Check the submitted values/);
      await assert.rejects(() => client.post(`/projects/${p.id}/comments`,{versionId:p.versions[0].id,text:'bad',start:13}),/valid time or range/);
    });
    await t.test('MCP discovery, request claim and image evidence work over stdio',async () => {
      req=await client.post(`/projects/${p.id}/requests`,{versionId:p.versions[0].id,commentIds:[c.id],target:'codex'});
      const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','server/mcp.ts'],cwd:process.cwd(),env:{...process.env as Record<string,string>,FR_SERVER_URL:url,FR_ADMIN_TOKEN:admin,FR_DATA_DIR:dataDir},stderr:'pipe'});
      const mcp=new Client({name:'frame-integration-test',version:'1.0.0'});
      try {
        await mcp.connect(transport); const tools=await mcp.listTools(); assert.equal(tools.tools.length,9);
        const listed=await mcp.callTool({name:'frame_list_requests',arguments:{limit:10,offset:0}}); assert.ok(!listed.isError);
        const evidence=await mcp.callTool({name:'frame_get_evidence',arguments:{projectId:p.id,snapshot:c.snapshot}});
        assert.equal((evidence.content as {type:string}[])[0].type,'image');
        const claimed=await mcp.callTool({name:'frame_claim_request',arguments:{projectId:p.id,requestId:req.id,worker:'test-codex',agent:'codex'}}); assert.ok(!claimed.isError);
        const claimedData=JSON.parse((claimed.content as {type:string;text:string}[])[0].text);
        assert.deepEqual(claimedData.request.comments[0].direction,{version:2,frame:{preset:'overlay',strength:'normal'},motion:{preset:'slow-in',strength:'strong'},caption:{preset:'words',text:'タイヤと旅'}}); assert.match(claimedData.request.comments[0].directionInstruction,/Slow zoom-in/);
        const again=await mcp.callTool({name:'frame_claim_request',arguments:{projectId:p.id,requestId:req.id,worker:'test-claude',agent:'codex'}}); assert.equal(again.isError,true);
        const destination=resolve(dataDir,'mcp-input.mp4');
        const downloaded=await mcp.callTool({name:'frame_download_video',arguments:{projectId:p.id,file:p.versions[0].file,destination}}); assert.ok(!downloaded.isError);
        const overwrite=await mcp.callTool({name:'frame_download_video',arguments:{projectId:p.id,file:p.versions[0].file,destination}}); assert.equal(overwrite.isError,true);
        const active=store.get(p.id).requests[0];
        await client.post(`/agent/projects/${p.id}/requests/${req.id}/heartbeat`,{leaseToken:active.leaseToken});
        const published=await mcp.callTool({name:'frame_publish_revision',arguments:{projectId:p.id,videoPath:revision,manifest:{requestId:req.id,leaseToken:active.leaseToken,baseVersionId:p.versions[0].id,summary:'Adjusted copy',changes:[{commentId:c.id,summary:'Smaller, lower copy',outcome:'addressed',before:{start:2.5,end:4},after:{start:2.5,end:4}}]}}});
        assert.ok(!published.isError); assert.equal(store.get(p.id).versions.length,2);
      } finally { await mcp.close(); }
    });
    await t.test('only explicit reviewer acceptance resolves a reported change',async () => {
      assert.equal(store.get(p.id).comments[0].status,'addressed');
      const res=await fetch(`${url}/api/projects/${p.id}/comments/${c.id}`,{method:'PATCH',headers:{'X-Review-Token':key,'Content-Type':'application/json'},body:JSON.stringify({status:'accepted'})});
      assert.equal(res.status,200); assert.equal(store.get(p.id).comments[0].status,'accepted');
    });
    await t.test('opt-in runner pulls a job and publishes through the adapter contract without an AI call',async () => {
      const v=store.get(p.id).versions.at(-1)!;
      const next=await client.post<Comment>(`/projects/${p.id}/comments`,{versionId:v.id,text:'Adapter integration fixture',start:5,direction:{version:2,motion:{preset:'pan',strength:'subtle',side:'left'},caption:{preset:'highlight'}}});
      await client.post(`/projects/${p.id}/requests`,{versionId:v.id,commentIds:[next.id],target:'claude'});
      const checkingAdapter=join(dataDir,'checking-adapter.mjs');
      await writeFile(checkingAdapter, `import assert from 'node:assert/strict'; import {spawnSync} from 'node:child_process'; let raw=''; for await (const chunk of process.stdin) raw+=chunk; const job=JSON.parse(raw); assert.deepEqual(job.request.comments[0].direction,{version:2,motion:{preset:'pan',strength:'subtle',side:'left'},caption:{preset:'highlight'}}); assert.match(job.request.comments[0].directionInstruction,/Horizontal pan/); const r=spawnSync(process.execPath,[${JSON.stringify(resolve('scripts/example-adapter.mjs'))}],{input:raw,encoding:'utf8'}); if(r.status!==0) throw new Error(r.stderr); process.stdout.write(r.stdout);`);
      await exec(process.execPath,['--import','tsx','server/runner.ts','--agent','claude','--once','--',process.execPath,checkingAdapter],{cwd:process.cwd(),env:{...process.env,FR_SERVER_URL:url,FR_ADMIN_TOKEN:admin,FR_DATA_DIR:dataDir,FR_EXAMPLE_VIDEO:revision},timeout:30_000});
      const updated=store.get(p.id); assert.equal(updated.versions.length,3); assert.equal(updated.requests.at(-1)!.status,'completed');
    });
  } finally { await new Promise<void>(r => server.close(() => r())); store.close(); }
});
