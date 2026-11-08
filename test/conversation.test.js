import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, finishProposal } from '../worker/domain.js';
import { handleKnown, interpret, analyzePhoto } from '../worker/conversation.js';
test('contextual supply receipt asks one question and produces a reviewable count',()=>{
 const s=initialState();assert.match(handleKnown(s,'Add supplies').content,/catheter model/);
 handleKnown(s,'Use example catheters');handleKnown(s,'30 per box');const r=handleKnown(s,'4 boxes');
 assert.equal(r.proposal.kind,'supplies');assert.ok(r.proposal.details.includes('Add 120 catheters'));
 assert.equal(s.inventory[0].count,60);finishProposal(s,r.proposal.id,'approve');assert.equal(s.inventory[0].count,180);
});
test('conversational accessibility changes identify which settings changed',()=>{
 const s=initialState();const r=handleKnown(s,'Turn hands-free on');assert.deepEqual(r.proposal.changedSettings,['handsFree']);
 finishProposal(s,r.proposal.id,'approve');assert.equal(s.settings.handsFree,true);
 const p=handleKnown(s,'Wait 10 seconds');finishProposal(s,p.proposal.id,'approve');assert.equal(s.settings.voicePauseMs,10000);
});
test('Workers AI object response and completion response are both supported',async()=>{
 const s=initialState();const a=await interpret({AI:{run:async()=>({response:{kind:'reply',content:'Hello',action:null}})}},s,'Hello');assert.equal(a.content,'Hello');
 const b=await interpret({AI:{run:async()=>({choices:[{message:{content:'{"kind":"reply","content":"Hi"}'}}]})}},s,'Hello');assert.equal(b.content,'Hi');
});
test('vision uses required prompt and preserves uncertain values',async()=>{
 let payload;const photo={arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer,httpMetadata:{contentType:'image/png'}};
 const r=await analyzePhoto({AI:{run:async(_,body)=>{payload=body;return {response:'{"type":"supplies","product":"Demo","unitsPerBox":null}'}}}},photo,'Read the box');
 assert.equal(typeof payload.prompt,'string');assert.equal(payload.messages,undefined);assert.equal(r.unitsPerBox,null);
});
