import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decision,mappedTime,restoreDrafts} from '../shared/review-flow.js';
import type {Comment} from '../shared/types.js';
const id='48e1e6ee-01c2-45f6-9332-a0b4a13300ad';
test('draft restoration keeps text, decimal time and normalized pin across navigation',()=>{
 const draft={text:'顔を大きく、右へ',start:7.7325,end:11,pin:{x:.25,y:.75},editing:true};
 assert.deepEqual(restoreDrafts(JSON.stringify({[id]:draft}),91.1),{[id]:draft});
 assert.deepEqual(restoreDrafts(JSON.stringify({[id]:{...draft,editing:false}}),91.1),{[id]:{...draft,editing:false}});
});
test('malformed, stale and out-of-bounds drafts do not corrupt the review',()=>{
 assert.deepEqual(restoreDrafts('broken',10),{});
 assert.deepEqual(restoreDrafts('[]',10),{});
 const draft={text:'x',start:3,end:null,pin:null,editing:true};
 for(const patch of [{start:10},{start:-1},{end:2},{end:11},{pin:{x:1.01,y:0}},{text:22},{editing:'yes'}]) assert.deepEqual(restoreDrafts(JSON.stringify({[id]:{...draft,...patch}}),10),{});
});
test('moving past a card cannot mark it OK; only server acceptance counts',()=>{
 const comment={id,status:'addressed'} as Comment;
 assert.equal(decision([comment],id),'pending');
 assert.equal(decision([{...comment,status:'accepted'}],id),'ok');
 assert.equal(decision([{...comment,status:'superseded'}],id),'retry');
 assert.equal(decision([{...comment,status:'blocked'}],id),'pending');
});
test('comparison maps corresponding time across cuts of different lengths',()=>{
 assert.equal(mappedTime(15,{start:10,end:20},{start:3,end:7}),5);
 assert.equal(mappedTime(-1,{start:10,end:20},{start:3,end:7}),3);
 assert.equal(mappedTime(50,{start:10,end:20},{start:3,end:7}),7);
 assert.equal(mappedTime(10,{start:10,end:10},{start:3,end:7}),3);
});
