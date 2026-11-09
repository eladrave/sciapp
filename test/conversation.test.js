import { executeCareTool } from '../worker/chat-tools.js';
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
 assert.equal(payload.temperature,0);assert.match(payload.messages[0].content[0].text,/SYS is systolic/);assert.equal(payload.messages[0].content[1].image_url.url,'data:image/png;base64,AQID');assert.equal(r.unitsPerBox,null);
});

test('monitor photos create reviewable readings linked to the original photo, without guessing pulse',()=>{
 const s=initialState();const r=handleKnown(s,'Record this photo',{type:'monitor',systolic:123,diastolic:81,heartRate:null},'test-photo');
 assert.equal(r.proposal.kind,'vitals');assert.ok(r.proposal.details.includes('Blood pressure: 123/81 mmHg'));assert.ok(!r.proposal.details.some(x=>x.includes('bpm')));assert.equal(s.events.length,0);assert.equal(s.proposals.at(-1).params.photoId,'test-photo');
});
test('vision rejects invented strings and out-of-range measurements',async()=>{
 const r=await analyzePhoto({AI:{run:async()=>({response:{type:'monitor',systolic:'123',diastolic:999,heartRate:null}})}},{arrayBuffer:async()=>new Uint8Array([1]).buffer},'');
 assert.equal(r.systolic,null);assert.equal(r.diastolic,null);assert.equal(r.heartRate,null);
});

test('both photo tools preserve extracted evidence and original source until approval',async()=>{
 for(const name of ['use_photo','record_vitals']){
  const s=initialState({real:true});
  const evidence={type:'monitor',systolic:123,diastolic:81,heartRate:null};
  const reply=await executeCareTool({},'clerk:test',s,'Read this monitor',{name,arguments:{systolic:200,diastolic:100,heartRate:80}},evidence,'test-photo');
  assert.equal(reply.proposal.kind,'vitals');assert.equal(s.events.length,0);
  assert.deepEqual(s.proposals.at(-1).params,{systolic:123,diastolic:81,heartRate:null,photoId:'test-photo'});
  finishProposal(s,reply.proposal.id,'approve');assert.equal(s.events[0].data.photoId,'test-photo');assert.equal(s.events[0].data.systolic,123);
 }
});
test('failed or incomplete photo evidence cannot turn invented chat-model values into a vital reading',async()=>{
 for(const photoData of [{type:'other',notes:'The image-processing service did not complete.'},{type:'monitor',systolic:123,diastolic:null,heartRate:null}]){
  const s=initialState({real:true});
  const reply=await executeCareTool({},'clerk:test',s,'Read this monitor',{name:'record_vitals',arguments:{systolic:123,diastolic:81}},photoData,'test-photo');
  assert.equal(reply.proposal,undefined);assert.equal(s.proposals.length,0);assert.equal(s.events.length,0);assert.equal(reply.photoId,'test-photo');
 }
});
