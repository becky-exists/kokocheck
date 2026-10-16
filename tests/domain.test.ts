import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { newProject, addComment, submitRequest, claimRequest, publishVersion, activeLease, publicProject, id, now } from '../server/domain.js';
import { mergeRanges, type Version } from '../shared/types.js';
const version = (): Version => ({ id: id(), number: 1, duration: 12, width: 1280, height: 720, hasAudio: true, size: 100, file: `${id()}.mp4`, poster: `${id()}.jpg`, createdAt: now(), summary: 'Original', requestId: null, changes: [] });
function setup() { const p = newProject('Test','source','fixture.ts',version()); const c = addComment(p, { versionId: p.versions[0].id, text: 'Move this title', author: 'Reviewer', start: 2, end: 4, pin: { x:.2,y:.4 }, followupOf:null }, 'evidence.jpg'); return { p,c }; }
test('requests freeze comment evidence and exclude subsequent edits', () => {
  const {p,c}=setup(); const r=submitRequest(p,p.versions[0].id,[c.id],'any'); c.text='Later note'; c.pin!.x=.9;
  assert.equal(r.comments[0].text,'Move this title'); assert.equal(r.comments[0].pin!.x,.2);
  assert.throws(() => submitRequest(p,p.versions[0].id,[c.id],'any'));
});
test('exclusive claims and target agent are enforced', () => {
  const {p,c}=setup(); const r=submitRequest(p,p.versions[0].id,[c.id],'claude');
  assert.throws(() => claimRequest(p,r.id,'other','codex')); const claimed=claimRequest(p,r.id,'worker','claude');
  assert.ok(claimed.leaseToken); assert.throws(() => claimRequest(p,r.id,'other','claude'));
});
test('expired lease cannot heartbeat or publish and is not silently reclaimed', () => {
  const {p,c}=setup(); const r=submitRequest(p,p.versions[0].id,[c.id],'any'); const claimed=claimRequest(p,r.id,'worker','codex');
  r.leaseUntil=Date.now()-1; assert.throws(() => activeLease(p,r.id,claimed.leaseToken!)); assert.throws(() => claimRequest(p,r.id,'worker2','claude'));
});
test('reports require every comment, valid mappings, and the correct base version', () => {
  const {p,c}=setup(); const r=submitRequest(p,p.versions[0].id,[c.id],'any'); const claimed=claimRequest(p,r.id,'worker','codex');
  const manifest={requestId:r.id,leaseToken:claimed.leaseToken!,baseVersionId:r.versionId,summary:'Fixed',changes:[{commentId:c.id,summary:'Moved',outcome:'addressed' as const,before:{start:2,end:4},after:{start:1,end:3}}]};
  assert.throws(() => publishVersion(p,{...manifest,baseVersionId:id()},version()));
  assert.throws(() => publishVersion(p,{...manifest,changes:[]},version()));
  assert.throws(() => publishVersion(p,{...manifest,changes:[{...manifest.changes[0],after:{start:20,end:22}}]},version()));
  assert.throws(() => publishVersion(p,{...manifest,changes:[{...manifest.changes[0],before:{start:5,end:6}}]},version()));
  publishVersion(p,manifest,version()); assert.equal(p.versions.length,2); assert.equal(c.status,'addressed'); assert.notEqual(c.status,'accepted');
  assert.throws(() => publishVersion(p,manifest,version()));
});
test('unknown correspondence remains null, and blocked work is not accepted', () => {
  const {p,c}=setup(); const r=submitRequest(p,p.versions[0].id,[c.id],'any'); const claimed=claimRequest(p,r.id,'worker','codex');
  const v=publishVersion(p,{requestId:r.id,leaseToken:claimed.leaseToken!,baseVersionId:r.versionId,summary:'Needs source',changes:[{commentId:c.id,summary:'Missing original text layer',outcome:'blocked',before:{start:2,end:4},after:null}]},version());
  assert.equal(v.changes[0].after,null); assert.equal(c.status,'blocked');
});
test('stale draft is not attached to a new version; explicit follow-up retains original evidence', () => {
  const {p,c}=setup(); p.versions.push(version());
  assert.throws(() => addComment(p,{versionId:c.versionId,text:'stale',author:'R',start:2,end:null,pin:null,followupOf:null},'x.jpg'));
  const next=addComment(p,{versionId:p.versions.at(-1)!.id,text:'reanchored',author:'R',start:3,end:null,pin:null,followupOf:c.id},'new.jpg');
  assert.equal(c.status,'superseded'); assert.equal(c.snapshot,'evidence.jpg'); assert.equal(next.followupOf,c.id);
});
test('durable transactions roll back partial failures and survive reopening', () => {
  const path=join(mkdtempSync(join(tmpdir(),'frame-domain-')),'db.sqlite'); const store=new Store(path); const {p}=setup(); store.create(p);
  assert.throws(() => store.mutate(p.id,project => {project.title='bad';throw new Error('abort');}));
  assert.equal(store.get(p.id).title,'Test'); store.close(); const reopened=new Store(path); assert.equal(reopened.get(p.id).comments.length,1); reopened.close();
});
test('reviewer payload excludes source path, tokens, and frozen request bodies', () => {
  const {p,c}=setup(); const r=submitRequest(p,p.versions[0].id,[c.id],'any'); claimRequest(p,r.id,'worker','codex');
  const output=JSON.stringify(publicProject(p)); assert.ok(!output.includes(p.reviewToken)); assert.ok(!output.includes('sourceRef')); assert.ok(!output.includes('leaseToken'));
});
test('changed-only playback merges overlaps and clamps to actual duration', () => {
  assert.deepEqual(mergeRanges([{start:0,end:1},{start:1.5,end:3},{start:8,end:10}],10),[{start:0,end:4},{start:7,end:10}]);
});
