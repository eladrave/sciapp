import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, finishProposal } from '../worker/domain.js';
import { handleKnown, interpret, analyzePhoto } from '../worker/conversation.js';
import { conversationControl, confirmationDelay } from '../web/conversation-controls.js';
import { proposal } from '../worker/domain.js';
test('natural confirmation variants approve the existing review instead of creating another',()=>{
 for(const words of ['approved','Approved.','APPROVED!','I approve it','yes please','Yes, go ahead.','confirmed','please save it','okay','looks good','That works.']) {
  const s=initialState();const review=proposal(s,'catheterization',{volume:350});s.messages.push(review);
  const r=handleKnown(s,words);assert.equal(r.approveId,review.proposal.id,words);assert.equal(s.proposals.length,1);assert.equal(s.proposals[0].status,'pending');
  finishProposal(s,r.approveId,'approve');assert.equal(s.inventory[0].count,59);
  const repeat=handleKnown(s,words);assert.match(repeat.content,/already saved/);assert.equal(s.proposals.length,1);assert.equal(s.inventory[0].count,59);
 }
});
test('negation, uncertainty, and corrections never approve the original value',()=>{
 for(const words of ['not approved',"don't save it",'no, cancel','yes, but not yet','maybe approved','I did not approve','wait']) {
  const s=initialState();const review=proposal(s,'catheterization',{volume:350});s.messages.push(review);
  const r=handleKnown(s,words);assert.equal(r.approveId,undefined,words);assert.equal(s.inventory[0].count,60);assert.equal(s.proposals.length,1);
 }
 const s=initialState();const old=proposal(s,'catheterization',{volume:350});s.messages.push(old);
 const corrected=handleKnown(s,'Yes, but make that 450 mL');assert.equal(corrected.proposal.kind,'catheterization');assert.ok(corrected.proposal.details.includes('450 mL'));assert.equal(s.proposals[0].status,'cancelled');assert.equal(s.inventory[0].count,60);
});
test('short final decisions send faster only while a review is awaiting approval',()=>{
 assert.equal(confirmationDelay('Approved.',{pending:true,final:true}),1200);
 assert.equal(confirmationDelay('No, cancel.',{pending:true,final:true}),1200);
 for(const options of [{pending:false,final:true},{pending:true,final:false},{pending:true,final:true,draft:'My volume was ' }])assert.equal(confirmationDelay('approved',options),5000);
 assert.equal(confirmationDelay('yes but change the volume',{pending:true,final:true}),5000);
 assert.equal(conversationControl('Yes, do not save.'),'clarify');
});
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
