import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { ReviewClient } from '../server/client.js';
import { createFixture } from '../scripts/fixture.js';
import type { ReviewProject, Comment, Request as ReviewRequest } from '../shared/types.js';

test('a whole-video comment goes through the real server: saved as 0 to the end, requested, and claimed with the priority rule', { timeout: 60_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(),'frame-whole-'));
  const admin = 'test-only-' + 'b'.repeat(48);
  const { app, store } = createApp({ dataDir, publicUrl: 'http://localhost:4391', adminToken: admin });
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = new ReviewClient(url,admin);
  try {
    const video = await createFixture(join(dataDir,'fixtures'));
    const { project } = await client.upload<{ project: ReviewProject }>('/projects',video,{ title:'Whole video', mode:'mp4' });
    const version = project.versions[0], base = { versionId: version.id, author: 'Tester' };
    // 文章だけ（チップも演出も無し）でも保存できる。区間は 0〜末尾、ピン無し。
    const plain = await client.post<Comment>(`/projects/${project.id}/comments`, { ...base, text: '全体的にテンポよく', start: 0, scope: 'all' });
    assert.equal(plain.scope,'all'); assert.deepEqual([plain.start,plain.end,plain.pin],[0,version.duration,null]);
    assert.ok((await client.evidence(project.id,plain.snapshot)).length > 1000);
    const tempo = await client.post<Comment>(`/projects/${project.id}/comments`, { ...base, text: 'テンポ ふつう', start: 0, scope: 'all', direction: { version: 3, tempo: 'normal', openClose: ['call-to-action'] } });
    assert.deepEqual(tempo.direction,{ version: 3, tempo: 'normal', openClose: ['call-to-action'] });
    // 「ここ」のコメントには全体向けの項目も、全体のコメントには時刻・ピンも付けられない。
    await assert.rejects(() => client.post(`/projects/${project.id}/comments`, { ...base, text: 'x', start: 0, scope: 'all', pin: { x: .5, y: .5 } }), /whole-video|Check the submitted values/);
    await assert.rejects(() => client.post(`/projects/${project.id}/comments`, { ...base, text: 'x', start: 3, scope: 'all' }), /whole-video|Check the submitted values/);
    await assert.rejects(() => client.post(`/projects/${project.id}/comments`, { ...base, text: 'x', start: 1, direction: { version: 3, tempo: 'tight' } }), /Check the submitted values|styles/);
    const moment = await client.post<Comment>(`/projects/${project.id}/comments`, { ...base, text: 'ここは間を残す', start: 4, direction: { version: 3, cut: { preset: 'keep-pause', strength: 'normal' } } });
    assert.equal(moment.scope, undefined);
    const request = await client.post<{ id: string }>(`/projects/${project.id}/requests`, { versionId: version.id, commentIds: [plain.id, tempo.id, moment.id], target: 'any' });
    const claimed = await fetch(`${url}/api/agent/projects/${project.id}/requests/${request.id}/claim`, { method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ worker: 'whole-test', agent: 'codex' }) });
    assert.equal(claimed.status, 200);
    const { request: frozen } = await claimed.json() as { request: ReviewRequest };
    const [a, b, c] = frozen.comments;
    assert.equal(a.scope,'all'); assert.match(a.directionInstruction!,/Whole-video instruction/);
    assert.match(b.directionInstruction!,/Tempo \(Normal\): shorten pauses longer than 0\.4s to 0\.2s/); assert.match(b.directionInstruction!,/Choose the position yourself/);
    assert.match(b.directionInstruction!,/take precedence over the whole-video instruction/);
    assert.equal(c.scope,undefined); assert.match(c.directionInstruction!,/Keep the pause/); assert.doesNotMatch(c.directionInstruction!,/Whole-video/);
  } finally { await new Promise<void>(r => server.close(() => r())); store.close(); }
});
