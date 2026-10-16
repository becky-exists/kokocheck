import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { ReviewClient } from '../server/client.js';
import { createFixture } from './fixture.js';
import { dataDir } from '../server/config.js';
import type { ReviewProject, Comment, Request } from '../shared/types.js';

const client = new ReviewClient();
const original = await createFixture(resolve(dataDir, 'fixtures'));
const revision = await createFixture(resolve(dataDir, 'fixtures'), true);
const first = await client.upload<{ project: ReviewProject; reviewUrl: string }>('/projects', original, { title: '試験映像', mode: 'source', sourceRef: 'scripts/fixture.ts (generated test film)' });
const p = first.project;
const notes = [
  { text: 'ここ、0.5秒早く。', start: 2.5, end: null, pin: { x: 0.26, y: 0.60 } },
  { text: 'この区間の音を、もう少し控えめに。', start: 6, end: 9, pin: null },
];
const comments: Comment[] = [];
for (const note of notes) comments.push(await client.post(`/projects/${p.id}/comments`, { ...note, versionId: p.versions[0].id, author: 'レビュー担当' }));
const request = await client.post<Request>(`/projects/${p.id}/requests`, { versionId: p.versions[0].id, commentIds: comments.map(c => c.id), target: 'any' });
const claim = await client.post<{ request: Request }>(`/agent/projects/${p.id}/requests/${request.id}/claim`, { worker: 'demo-fixture', agent: 'codex' });
await client.upload(`/agent/projects/${p.id}/versions`, revision, { manifest: JSON.stringify({ requestId: request.id, leaseToken: claim.request.leaseToken, baseVersionId: p.versions[0].id, summary: 'デモ：数字の色と音量を調整しました。', changes: comments.map((c,i) => ({ commentId: c.id, summary: i === 0 ? '数字の色を変更' : '音量を控えめに調整', outcome: 'addressed', before: { start: c.start, end: c.end ?? c.start + 1 }, after: { start: c.start, end: c.end ?? c.start + 1 } })) }) });
const second = await client.upload<{ project: ReviewProject; reviewUrl: string }>('/projects', original, { title: '試験映像（MP4取り込み）', mode: 'mp4' });
await writeFile(resolve(dataDir, 'demo.json'), JSON.stringify({ source: first.reviewUrl, mp4: second.reviewUrl, projectId: p.id, original, revision }, null, 2), { mode: 0o600 });
console.log(`Source review: ${first.reviewUrl}\nMP4 review: ${second.reviewUrl}\nThese are generated fixtures, not real client footage.`);
