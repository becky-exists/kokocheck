import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { createApp } from '../server/app.js';
import { loadClaudeConfig, notifyClaude } from '../server/claude-notify.js';
import { newProject, addComment, commentSchema } from '../server/domain.js';
import type { Version } from '../shared/types.js';

const exec = promisify(execFile);
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
const version = (): Version => ({ id: randomUUID(), number: 1, file: 'fixture.mp4', poster: 'fixture.jpg', duration: 12, width: 720, height: 1280, hasAudio: false, size: 1, createdAt: new Date().toISOString(), summary: '', requestId: null, changes: [] });

test('Claude channel carries a saved button request over stdio without editing or leaking secrets', { timeout: 20_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'frame-claude-'));
  const p = newProject('Claude test', 'mp4', null, version());
  const c = addComment(p, commentSchema.parse({ versionId: p.versions[0].id, text: 'Larger caption', start: 2, end: 4, pin: { x: 0.25, y: 0.75 } }), 'snapshot.jpg');
  const other = newProject('Other private review', 'mp4', null, version());
  const binding = { port: await freePort(), token: randomBytes(32).toString('hex'), testOnly: true, lang: 'ja' as const };
  await writeFile(join(dataDir, 'notify-claude.json'), JSON.stringify({ version: 1, bindings: { [p.id]: binding } }));
  const options = { dataDir, publicUrl: 'http://localhost:4391', adminToken: randomBytes(32).toString('hex') };
  const { app, store } = createApp(options); store.create(p); store.create(other);
  const http = app.listen(0, '127.0.0.1'); await once(http, 'listening');
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const mcp = new Client({ name: 'channel-protocol-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'server/claude-channel-main.ts', '--data-dir', dataDir, '--project', p.id], cwd: process.cwd(), stderr: 'pipe' });
  const events: { content: string; meta: Record<string, string> }[] = [];
  mcp.setNotificationHandler(z.object({ method: z.literal('notifications/claude/channel'), params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }) }), n => { events.push(n.params); });
  const channelUrl = `http://127.0.0.1:${binding.port}/notify`;
  const channelPost = (body: unknown, headers: Record<string, string> = {}) => fetch(channelUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${binding.token}`, ...headers }, body: JSON.stringify(body) });
  try {
    // Wait for the child's explicit listener-ready diagnostic, not a fixed sleep.
    const listening = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Channel did not listen')), 5000);
      transport.stderr!.on('data', (chunk: Buffer) => { if (chunk.toString().includes('listening on loopback')) { clearTimeout(timeout); resolve(); } });
    });
    await mcp.connect(transport); await listening;
    assert.ok(mcp.getServerCapabilities()?.experimental?.['claude/channel']);
    assert.equal(mcp.getServerCapabilities()?.experimental?.['claude/channel/permission'], undefined);
    assert.deepEqual((await mcp.listTools()).tools.map(t => t.name), ['frame_read_notified_request']);
    const headers = { 'Content-Type': 'application/json', 'X-Review-Token': p.reviewToken };
    const body = { versionId: p.versions[0].id, commentIds: [c.id], target: 'claude' };
    const submit = (input = body) => fetch(`${url}/api/projects/${p.id}/requests`, { method: 'POST', headers, body: JSON.stringify(input) });
    const view = await (await fetch(`${url}/api/projects/${p.id}`, { headers })).json();
    assert.deepEqual(view.chatNotification, { provider: 'claude', testOnly: true });
    assert.ok(!JSON.stringify(view).includes(binding.token));
    assert.equal((await submit({ ...body, target: 'codex' })).status, 409);
    assert.equal((await channelPost({ projectId: p.id, requestId: randomUUID() }, { Authorization: '' })).status, 401);
    assert.equal((await channelPost({ projectId: p.id, requestId: randomUUID() }, { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await channelPost({ projectId: other.id, requestId: randomUUID() })).status, 400);
    assert.equal((await channelPost({ projectId: p.id, requestId: randomUUID(), content: 'arbitrary prompt' })).status, 400);
    assert.equal((await channelPost({ projectId: p.id, requestId: randomUUID() })).status, 404);
    assert.equal((await channelPost({ padding: 'x'.repeat(2000) })).status, 413);
    for (const body of ['{', 'x'.repeat(2048)]) assert.equal((await fetch(channelUrl, {method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);
    const responses = await Promise.all([submit(), submit()]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    const receipt = await responses.find(r => r.status === 201)!.json();
    assert.equal(receipt.notification.state, 'queued'); assert.equal(receipt.notification.provider, 'claude');
    // An RPC ping orders after the channel event on the same stdio transport.
    await mcp.ping(); assert.equal(events.length, 1);
    assert.equal(events[0].meta.request_id, receipt.id); assert.match(events[0].content, /着信確認だけ/);
    for (const secret of [binding.token, options.adminToken, p.reviewToken, c.text]) assert.ok(!events[0].content.includes(secret));
    const result = await mcp.callTool({ name: 'frame_read_notified_request', arguments: { requestId: receipt.id } });
    assert.ok(!result.isError); assert.deepEqual((result.structuredContent as { comments: unknown[] }).comments, store.get(p.id).requests[0].comments);
    for (const secret of [binding.token, options.adminToken, p.reviewToken, other.title]) assert.ok(!JSON.stringify(result).includes(secret));
    assert.equal((await mcp.callTool({ name: 'frame_read_notified_request', arguments: { requestId: randomUUID() } })).isError, true);
    assert.equal((await channelPost({ projectId: p.id, requestId: receipt.id })).status, 202); await mcp.ping(); assert.equal(events.length, 1);
    const before = JSON.stringify(store.get(p.id));
    const { stdout } = await exec(process.execPath, ['--import', 'tsx', 'server/runner.ts', '--agent', 'claude', '--once', '--', process.execPath, '-e', 'process.exit(1)'], { env: { ...process.env, FR_SERVER_URL: url, FR_ADMIN_TOKEN: options.adminToken, FR_DATA_DIR: dataDir }, timeout: 5000 });
    assert.equal(stdout, ''); assert.equal(JSON.stringify(store.get(p.id)), before);
    await mcp.close();
    assert.equal((await notifyClaude(binding, p.id, receipt.id)).state, 'failed');
  } finally { await mcp.close(); await new Promise<void>(r => http.close(() => r())); store.close(); }
});

test('Disconnected Claude keeps the request and rejects ambiguous provider bindings', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'frame-claude-offline-'));
  const p = newProject('Offline', 'mp4', null, version());
  const c = addComment(p, commentSchema.parse({ versionId: p.versions[0].id, text: 'Saved offline', start: 1 }), 'snapshot.jpg');
  const binding = { port: await freePort(), token: randomBytes(32).toString('hex'), testOnly: true };
  await writeFile(join(dataDir, 'notify-claude.json'), JSON.stringify({ version: 1, bindings: { [p.id]: binding } }));
  const options = { dataDir, publicUrl: 'http://localhost:4391', adminToken: randomBytes(32).toString('hex') };
  const { app, store } = createApp(options); store.create(p);
  const http = app.listen(0, '127.0.0.1'); await once(http, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(http.address() as { port: number }).port}/api/projects/${p.id}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': p.reviewToken }, body: JSON.stringify({ versionId: p.versions[0].id, commentIds: [c.id] }) });
    assert.equal(response.status, 201); assert.equal((await response.json()).notification.state, 'failed');
    assert.equal(store.get(p.id).requests[0].comments[0].text, c.text);
    store.mutate(p.id, project => { project.requests[0].notification!.state = 'sending'; });
  } finally { await new Promise<void>(r => http.close(() => r())); store.close(); }
  const restart = createApp(options);
  assert.equal(restart.store.get(p.id).requests[0].notification?.state, 'uncertain');
  assert.equal(restart.store.get(p.id).requests[0].notification?.provider, 'claude'); restart.store.close();
  await writeFile(join(dataDir, 'notify-codex.json'), JSON.stringify({ version: 1, executable: process.execPath, bindings: { [p.id]: { threadId: randomUUID() } } }));
  assert.throws(() => createApp(options), /both Codex and Claude/);
  await writeFile(join(dataDir, 'notify-claude.json'), JSON.stringify({ version: 1, bindings: { [p.id]: binding, [randomUUID()]: binding } }));
  assert.throws(() => loadClaudeConfig(dataDir), /own channel port/);
});

test('Setup creates only opt-in local files and refuses overwrite', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'frame-claude-setup-'));
  const p = newProject('Setup', 'mp4', null, version());
  const { store } = createApp({ dataDir, publicUrl: 'http://localhost:4391', adminToken: randomBytes(32).toString('hex') }); store.create(p); store.close();
  const args = ['--import', 'tsx', 'scripts/setup-claude-channel.ts', '--project', p.id, '--data-dir', dataDir];
  const { stdout } = await exec(process.execPath, args);
  assert.match(stdout, /--resume/);
  const config = loadClaudeConfig(dataDir)!; assert.equal(config.bindings[p.id].testOnly, true);
  const mcp = JSON.parse(await readFile(join(dataDir, 'claude-channel.mcp.json'), 'utf8'));
  assert.equal(mcp.mcpServers['frame-review-channel'].command, process.execPath);
  assert.ok(!JSON.stringify(mcp).includes(config.bindings[p.id].token));
  await assert.rejects(exec(process.execPath, args), /not overwritten/);
  assert.deepEqual(loadClaudeConfig(dataDir), config);
});

test('One channel serves several reviews, reads its settings again on each event and names the review URL', { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'frame-claude-multi-'));
  const first = newProject('First', 'mp4', null, version()), second = newProject('Second', 'mp4', null, version()), stranger = newProject('Stranger', 'mp4', null, version());
  const comment = (p: ReturnType<typeof newProject>) => addComment(p, commentSchema.parse({ versionId: p.versions[0].id, text: `Note for ${p.title}`, start: 1 }), 'snapshot.jpg');
  const [c1, c2] = [comment(first), comment(second)];
  const channel = { port: await freePort(), token: randomBytes(32).toString('hex') };
  const writeConfig = (reviews: string[]) => writeFile(join(dataDir, 'notify-claude.json'), JSON.stringify({ version: 1, channels: { team: channel }, bindings: Object.fromEntries(reviews.map(id => [id, { channel: 'team', testOnly: false }])) }));
  await writeConfig([first.id]);
  const options = { dataDir, publicUrl: 'http://localhost:4391', adminToken: randomBytes(32).toString('hex') };
  const { app, store } = createApp(options); store.create(first); store.create(second); store.create(stranger);
  const http = app.listen(0, '127.0.0.1'); await once(http, 'listening');
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const mcp = new Client({ name: 'channel-multi-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'server/claude-channel-main.ts', '--data-dir', dataDir, '--channel', 'team'], cwd: process.cwd(), stderr: 'pipe' });
  const events: { content: string; meta: Record<string, string> }[] = [];
  mcp.setNotificationHandler(z.object({ method: z.literal('notifications/claude/channel'), params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }) }), n => { events.push(n.params); });
  const submit = (p: ReturnType<typeof newProject>, c: { id: string }) => fetch(`${url}/api/projects/${p.id}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': p.reviewToken }, body: JSON.stringify({ versionId: p.versions[0].id, commentIds: [c.id], target: 'claude' }) });
  try {
    const listening = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Channel did not listen')), 5000);
      transport.stderr!.on('data', (chunk: Buffer) => { if (chunk.toString().includes('listening on loopback')) { clearTimeout(timeout); resolve(); } });
    });
    await mcp.connect(transport); await listening;
    const r1 = await (await submit(first, c1)).json();
    assert.equal(r1.notification.state, 'queued');
    // The second review is not in the file yet: the app sends it as an ordinary review (no chat destination).
    const before = await submit(second, c2);
    assert.equal(before.status, 201); assert.equal((await before.json()).notification, undefined);
    store.mutate(second.id, p => { p.requests = []; p.comments[0].status = 'draft'; });
    // Add the review to the file only: no restart of KokoCheck and no reconnect of the conversation.
    await writeConfig([first.id, second.id]);
    const r2 = await (await submit(second, c2)).json();
    assert.equal(r2.notification.state, 'queued');
    await mcp.ping(); assert.equal(events.length, 2);
    assert.equal(events[1].meta.project_id, second.id); assert.equal(events[1].meta.test_only, 'false');
    for (const event of events) {
      assert.match(event.content, new RegExp(`Review: http://localhost:4391/r/${event.meta.project_id}\\n`));
      for (const secret of [channel.token, options.adminToken, first.reviewToken, second.reviewToken, '#key=', c1.text, c2.text]) assert.ok(!event.content.includes(secret));
    }
    // Each request is readable through the one tool; a review that is not bound is not.
    const read = await mcp.callTool({ name: 'frame_read_notified_request', arguments: { requestId: r2.id } });
    assert.ok(!read.isError); assert.equal((read.structuredContent as { projectId: string }).projectId, second.id);
    const post = (body: unknown, token = channel.token) => fetch(`http://127.0.0.1:${channel.port}/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    assert.equal((await post({ projectId: stranger.id, requestId: randomUUID() })).status, 400);
    assert.equal((await post({ projectId: first.id, requestId: randomUUID(), publicUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await post({ projectId: first.id, requestId: randomUUID(), publicUrl: 'https://user:pw@example.com/' })).status, 400);
    // A rotated token takes effect without restarting the channel; the old one stops working.
    const rotated = randomBytes(32).toString('hex');
    await writeFile(join(dataDir, 'notify-claude.json'), JSON.stringify({ version: 1, channels: { team: { ...channel, token: rotated } }, bindings: { [first.id]: { channel: 'team' } } }));
    assert.equal((await post({ projectId: first.id, requestId: randomUUID() })).status, 401);
    assert.equal((await post({ projectId: first.id, requestId: randomUUID() }, rotated)).status, 404);
    assert.equal((await post({ projectId: second.id, requestId: randomUUID() }, rotated)).status, 400);
    assert.equal((await mcp.callTool({ name: 'frame_read_notified_request', arguments: { requestId: r2.id } })).isError, true);
  } finally { await mcp.close(); await new Promise<void>(r => http.close(() => r())); store.close(); }
});

test('A notification that never left can be sent again or withdrawn, an uncertain one cannot', { timeout: 20_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'frame-claude-resend-'));
  const p = newProject('Resend', 'mp4', null, version());
  const c = addComment(p, commentSchema.parse({ versionId: p.versions[0].id, text: 'Keep me', start: 1 }), 'snapshot.jpg');
  const binding = { port: await freePort(), token: randomBytes(32).toString('hex') };
  await writeFile(join(dataDir, 'notify-claude.json'), JSON.stringify({ version: 1, channels: { review: binding }, bindings: { [p.id]: { channel: 'review' } } }));
  const options = { dataDir, publicUrl: 'http://localhost:4391', adminToken: randomBytes(32).toString('hex') };
  const { app, store } = createApp(options); store.create(p);
  const http = app.listen(0, '127.0.0.1'); await once(http, 'listening');
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const bodies: unknown[] = [];
  const stub = createHttpServer((req, res) => { let raw = ''; req.on('data', d => raw += d); req.on('end', () => { const body = JSON.parse(raw); bodies.push(body); res.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ state: 'queued', requestId: body.requestId })); }); });
  const headers = { 'Content-Type': 'application/json', 'X-Review-Token': p.reviewToken };
  const call = (path: string) => fetch(`${url}/api/projects/${p.id}/requests/${path}`, { method: 'POST', headers, body: '{}' });
  try {
    const submitted = await (await fetch(`${url}/api/projects/${p.id}/requests`, { method: 'POST', headers, body: JSON.stringify({ versionId: p.versions[0].id, commentIds: [c.id], target: 'claude' }) })).json();
    assert.equal(submitted.notification.state, 'failed');
    // Withdraw: the request is kept as a record and the comment returns to draft.
    assert.equal((await call(`${submitted.id}/cancel`)).status, 200);
    let saved = store.get(p.id);
    assert.equal(saved.requests[0].status, 'cancelled'); assert.equal(saved.comments[0].status, 'draft'); assert.equal(saved.requests[0].comments[0].text, 'Keep me');
    assert.equal((await call(`${submitted.id}/cancel`)).status, 409);
    assert.equal((await call(`${submitted.id}/renotify`)).status, 409);
    // Send again: the second request fails the same way while nobody listens, then succeeds once the channel is up.
    const again = await (await fetch(`${url}/api/projects/${p.id}/requests`, { method: 'POST', headers, body: JSON.stringify({ versionId: p.versions[0].id, commentIds: [c.id], target: 'claude' }) })).json();
    assert.equal(again.notification.state, 'failed');
    assert.equal((await (await call(`${again.id}/renotify`)).json()).notification.state, 'failed');
    stub.listen(binding.port, '127.0.0.1'); await once(stub, 'listening');
    const resent = await call(`${again.id}/renotify`);
    assert.equal(resent.status, 200); assert.equal((await resent.json()).notification.state, 'queued');
    assert.deepEqual(bodies, [{ projectId: p.id, requestId: again.id, publicUrl: 'http://localhost:4391' }]);
    assert.equal((await call(`${again.id}/renotify`)).status, 409); assert.equal(bodies.length, 1);
    // uncertain is never resent or withdrawn automatically from the review page.
    store.mutate(p.id, project => { project.requests.at(-1)!.notification!.state = 'uncertain'; });
    assert.equal((await call(`${again.id}/renotify`)).status, 409); assert.equal((await call(`${again.id}/cancel`)).status, 409);
    // A review link without the share key can do neither.
    assert.equal((await fetch(`${url}/api/projects/${p.id}/requests/${again.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  } finally { stub.close(); await new Promise<void>(r => http.close(() => r())); store.close(); }
});

test('Setup adds reviews to one channel without touching existing entries, and agent tools are opt-in', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'frame-claude-setup-multi-'));
  const [a, b, c] = [newProject('A', 'mp4', null, version()), newProject('B', 'mp4', null, version()), newProject('C', 'mp4', null, version())];
  const { store } = createApp({ dataDir, publicUrl: 'http://localhost:4391', adminToken: randomBytes(32).toString('hex') }); store.create(a); store.create(b); store.create(c); store.close();
  const run = (project: string, ...extra: string[]) => exec(process.execPath, ['--import', 'tsx', 'scripts/setup-claude-channel.ts', '--project', project, '--data-dir', dataDir, ...extra]);
  const legacy = { port: await freePort(), token: randomBytes(32).toString('hex'), testOnly: false };
  await writeFile(join(dataDir, 'notify-claude.json'), JSON.stringify({ version: 1, bindings: { [c.id]: legacy } }));
  await run(a.id, '--port', String(await freePort()), '--channel', 'team');
  const { stdout } = await run(b.id, '--channel', 'team', '--lang', 'ja', '--live', '--with-agent-tools', '--server-url', 'http://localhost:4391');
  assert.match(stdout, /claude-channel-team\.mcp\.json/); assert.match(stdout, /operator key/);
  const raw = JSON.parse(await readFile(join(dataDir, 'notify-claude.json'), 'utf8'));
  assert.deepEqual(raw.bindings[c.id], legacy);
  assert.deepEqual(raw.bindings[a.id], { channel: 'team', testOnly: true, lang: 'en' }); assert.deepEqual(raw.bindings[b.id], { channel: 'team', testOnly: false, lang: 'ja' });
  assert.deepEqual(Object.keys(raw.channels), ['team']);
  const resolved = loadClaudeConfig(dataDir)!;
  assert.equal(resolved.bindings[a.id].port, resolved.bindings[b.id].port); assert.equal(resolved.bindings[c.id].testOnly, false);
  const mcp = JSON.parse(await readFile(join(dataDir, 'claude-channel-team.mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ['frame-review-channel', 'frame-review-mcp-server']);
  assert.deepEqual(mcp.mcpServers['frame-review-channel'].args.slice(-2), ['--channel', 'team']);
  assert.equal(mcp.mcpServers['frame-review-mcp-server'].env.KOKOCHECK_DATA_DIR, dataDir);
  for (const secret of [raw.channels.team.token, legacy.token]) assert.ok(!JSON.stringify(mcp).includes(secret));
  await assert.rejects(run(a.id, '--channel', 'team'), /not overwritten/);
});

test('Setup writes no agent tools unless asked', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'frame-claude-setup-plain-'));
  const p = newProject('Plain', 'mp4', null, version());
  const { store } = createApp({ dataDir, publicUrl: 'http://localhost:4391', adminToken: randomBytes(32).toString('hex') }); store.create(p); store.close();
  await exec(process.execPath, ['--import', 'tsx', 'scripts/setup-claude-channel.ts', '--project', p.id, '--data-dir', dataDir]);
  const mcp = JSON.parse(await readFile(join(dataDir, 'claude-channel.mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(mcp.mcpServers), ['frame-review-channel']);
});

test('A channel started from an older build still gets the notification, without the review URL', async () => {
  const binding = { port: await freePort(), token: randomBytes(32).toString('hex') };
  const bodies: Record<string, string>[] = [];
  // Mimics the previous strict body: any extra field is a 400.
  const old = createHttpServer((req, res) => { let raw = ''; req.on('data', d => raw += d); req.on('end', () => {
    const body = JSON.parse(raw); bodies.push(body);
    if (Object.keys(body).length !== 2) { res.writeHead(400).end(); return; }
    res.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ state: 'queued', requestId: body.requestId }));
  }); });
  old.listen(binding.port, '127.0.0.1'); await once(old, 'listening');
  try {
    const requestId = randomUUID();
    assert.equal((await notifyClaude(binding, randomUUID(), requestId, 'http://localhost:4391')).state, 'queued');
    assert.deepEqual(bodies.map(b => Object.keys(b).length), [3, 2]);
  } finally { old.close(); }
});
