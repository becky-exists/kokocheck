import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { newProject, addComment, commentSchema } from '../server/domain.js';
import { createApp } from '../server/app.js';
import { loadNotifyConfig, notificationMessage, queueNotification, type NotifyConfig } from '../server/notify.js';
import type { Version } from '../shared/types.js';

const version = (): Version => ({ id: randomUUID(), number: 1, file: 'fixture.mp4', poster: 'fixture.jpg', duration: 12, width: 1280, height: 720, hasAudio: true, size: 123, createdAt: new Date().toISOString(), summary: '', requestId: null, changes: [] });

test('notification command is literal and accepts only a matching CLI receipt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frame-notify-command-'));
  const executable = join(dir, 'mock-codex');
  const threadId = randomUUID(), queueId = randomUUID();
  const config: NotifyConfig = { version: 1, executable, bindings: {} };
  const binding = { threadId, testOnly: false };
  const message = '$(touch NEVER) `no-shell`\n"quoted"; literal';
  await writeFile(executable, `#!${process.execPath}\nimport fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(join(dir,'args.json'))},JSON.stringify({args:process.argv.slice(2),admin:process.env.FR_ADMIN_TOKEN})); console.log('Queued message ${queueId} for thread ${threadId}.');`, { mode: 0o700 });
  const result = await queueNotification(config, binding, message);
  assert.equal(result.state, 'queued'); assert.equal(result.queueId, queueId);
  const recorded = JSON.parse(await readFile(join(dir,'args.json'),'utf8'));
  assert.deepEqual(recorded.args, ['queue','--thread',threadId,'--message',message]); assert.equal(recorded.admin, undefined);
  await writeFile(executable, `#!${process.execPath}\nconsole.log('Queued message ${queueId} for thread ${randomUUID()}.');`);
  assert.equal((await queueNotification(config, binding, message)).state, 'uncertain');
  await writeFile(executable, `#!${process.execPath}\nprocess.exit(1);`);
  assert.equal((await queueNotification(config, binding, message)).state, 'uncertain');
  assert.equal((await queueNotification({ ...config, executable: join(dir,'missing') }, binding, message)).state, 'failed');
  const text = notificationMessage(randomUUID(),randomUUID(),{...binding,testOnly:true,lang:'ja'},'http://localhost:4391');
  assert.match(text,/着信確認だけ/); assert.match(text,/動画修正・ファイル変更/); assert.doesNotMatch(text,/#key=/);
});

test('notification configuration is opt-in and rejects arbitrary command options', async () => {
  const dir = await mkdtemp(join(tmpdir(),'frame-notify-config-'));
  assert.equal(loadNotifyConfig(dir), null);
  await writeFile(join(dir,'notify-codex.json'),JSON.stringify({version:1,executable:'codex --unsafe',bindings:{}}));
  assert.throws(() => loadNotifyConfig(dir));
  await writeFile(join(dir,'notify-codex.json'),JSON.stringify({version:1,executable:'/usr/bin/codex',bindings:{notAProject:{threadId:randomUUID()}}}));
  assert.throws(() => loadNotifyConfig(dir));
});

test('request button persists once, authenticates, notifies once and survives restart without resending', {timeout:30_000}, async () => {
  const dataDir = await mkdtemp(join(tmpdir(),'frame-notify-http-'));
  const p = newProject('Notification fixture','mp4',null,version());
  const c = addComment(p,commentSchema.parse({versionId:p.versions[0].id,text:'PRIVATE_COMMENT_DO_NOT_TRANSMIT',start:2}),'snapshot.jpg');
  const threadId = randomUUID(), queueId = randomUUID(), executable = join(dataDir,'mock-codex');
  const capture = join(dataDir,'calls.jsonl');
  await writeFile(executable, `#!${process.execPath}\nimport fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify(process.argv.slice(2))+'\n'); setTimeout(()=>console.log('Queued message ${queueId} for thread ${threadId}.'),200);`.replace("+'\n'", "+'\\n'"), {mode:0o700});
  await writeFile(join(dataDir,'notify-codex.json'),JSON.stringify({version:1,executable,bindings:{[p.id]:{threadId,testOnly:true}}}));
  const options = {dataDir,publicUrl:'http://localhost:4391',adminToken:'notify-test-'+'a'.repeat(40)};
  const {app,store} = createApp(options); store.create(p);
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const body = {versionId:p.versions[0].id,commentIds:[c.id],target:'codex'};
  const headers = {'Content-Type':'application/json','X-Review-Token':p.reviewToken};
  const submit = (input: unknown = body, h: Record<string,string> = headers) => fetch(`${url}/api/projects/${p.id}/requests`,{method:'POST',headers:h,body:JSON.stringify(input)});
  try {
    const view = await (await fetch(`${url}/api/projects/${p.id}`,{headers})).json();
    assert.deepEqual(view.chatNotification,{provider:'codex',testOnly:true}); assert.ok(!JSON.stringify(view).includes(threadId));
    assert.equal((await submit(body,{'Content-Type':'application/json'})).status,403);
    assert.equal((await submit({...body,threadId:randomUUID()})).status,400);
    assert.equal((await submit({...body,target:'claude'})).status,409);
    assert.equal((await submit(body,{...headers,Origin:'https://evil.example'})).status,403);
    const responses = await Promise.all([submit(),submit()]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
    const receipt = await responses.find(r=>r.status===201)!.json();
    assert.equal(receipt.notification.state,'queued'); assert.equal(receipt.notification.queueId,queueId);
    const saved = store.get(p.id); assert.equal(saved.requests.length,1); assert.equal(saved.comments[0].status,'requested');
    assert.equal(saved.requests[0].comments[0].text,c.text);
    const calls = (await readFile(capture,'utf8')).trim().split('\n'); assert.equal(calls.length,1);
    const args = JSON.parse(calls[0]); assert.equal(args[2],threadId); assert.ok(args[4].includes(receipt.id));
    assert.ok(!args[4].includes(c.text)); assert.ok(!args[4].includes(p.reviewToken)); assert.ok(!args[4].includes(options.adminToken));
    // Automatic editing runner must ignore chat notifications, including a saved failed notification.
    const {stdout} = await promisify(execFile)(process.execPath,['--import','tsx','server/runner.ts','--agent','codex','--once','--',process.execPath,'-e','process.exit(1)'],{env:{...process.env,FR_SERVER_URL:url,FR_ADMIN_TOKEN:options.adminToken,FR_DATA_DIR:dataDir},timeout:10_000});
    assert.equal(stdout,''); assert.equal(store.get(p.id).requests[0].status,'queued');
    store.mutate(p.id,project => {project.requests[0].notification = {state:'sending',updatedAt:new Date().toISOString()};});
  } finally {await new Promise<void>(r=>server.close(()=>r()));store.close();}
  const restarted = createApp(options);
  try {
    assert.equal(restarted.store.get(p.id).requests[0].notification?.state,'uncertain');
    assert.equal((await readFile(capture,'utf8')).trim().split('\n').length,1);
  } finally {restarted.store.close();}
});

test('failed notification retains request and comments instead of reporting request loss',async () => {
  const dataDir = await mkdtemp(join(tmpdir(),'frame-notify-failure-'));
  const p = newProject('Missing CLI fixture','mp4',null,version());
  const c = addComment(p,commentSchema.parse({versionId:p.versions[0].id,text:'Keep me',start:1}),'snapshot.jpg');
  await writeFile(join(dataDir,'notify-codex.json'),JSON.stringify({version:1,executable:join(dataDir,'missing'),bindings:{[p.id]:{threadId:randomUUID()}}}));
  const {app,store} = createApp({dataDir,publicUrl:'http://localhost:4391',adminToken:'test-only-'+'a'.repeat(40)});store.create(p);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const response=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/projects/${p.id}/requests`,{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':p.reviewToken},body:JSON.stringify({versionId:p.versions[0].id,commentIds:[c.id]})});
    assert.equal(response.status,201);assert.equal((await response.json()).notification.state,'failed');
    assert.equal(store.get(p.id).requests[0].comments[0].text,'Keep me');
  } finally {await new Promise<void>(r=>server.close(()=>r()));store.close();}
});
