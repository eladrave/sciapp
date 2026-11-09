import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,finishProposal} from '../worker/domain.js';
import {photoTime,bagPhotoReview,editPhotoReview} from '../worker/photo-review.js';
import {executeCareTool} from '../worker/chat-tools.js';
const state=()=>{const s=initialState({real:true});s.settings.catheterTimes=['01:00','07:00','11:30','16:00','20:30'];return s;};
test('photo schedule grounding uses local explicit times and recent past occurrences across midnight',()=>{
 const s=state();assert.deepEqual(photoTime(s,'this is my 7am',Date.parse('2026-11-09T13:20:00Z')),{time:'2026-11-09T12:00:00.000Z',assumed:false});
 assert.deepEqual(photoTime(s,'record this photo',Date.parse('2026-11-09T13:20:00Z')),{time:'2026-11-09T12:00:00.000Z',assumed:true});
 assert.equal(photoTime(s,'record this photo',Date.parse('2026-11-09T11:20:00Z')),null);
 assert.equal(photoTime(s,'7am or 11:30am',Date.parse('2026-11-09T13:20:00Z')),null);
});
test('bag photo immediately prepares review, allows time and amount corrections and saves only on approval',async()=>{
 const s=state();const reply=bagPhotoReview(s,'this is my 7am',{volumeMl:420},'source-photo');assert.equal(reply.proposal.kind,'catheterization');assert.equal(reply.proposal.editablePhotoCare,true);assert.equal(s.events.length,0);
 editPhotoReview(s,'Change time');assert.match(editPhotoReview(s,'7').content,/AM or PM/);const changed=editPhotoReview(s,'8 am');assert.match(changed.proposal.details.join(' '),/8:00/);
 editPhotoReview(s,'Change amount');const amount=await executeCareTool({},'synthetic',s,'400 mL',{name:'record_catheterization',arguments:{}});assert.equal(amount.proposal.kind,'catheterization');assert.equal(s.events.length,0);
 finishProposal(s,amount.proposal.id,'approve');assert.equal(s.events[0].data.volume,400);assert.equal(s.events[0].data.photoId,'source-photo');assert.equal(s.events[0].occurredAt,s.events[0].data.time);
});
test('missing scale stays unknown and a clock never becomes a volume; generic bag has no catheter deduction',()=>{
 const s=state();const reply=bagPhotoReview(s,'my 7am',{volumeMl:null},'source');assert.equal(reply.proposal,undefined);assert.equal(s.draft.params.volume,null);assert.equal(editPhotoReview(s,'Change time').proposal,undefined);assert.equal(editPhotoReview(s,'8am').proposal,undefined);
 const generic=initialState({real:true});const review=bagPhotoReview(generic,'bag contents',{volumeMl:420},'source');assert.equal(review.proposal.kind,'bag');finishProposal(generic,review.proposal.id,'approve');assert.equal(generic.events[0].delta,null);
});

test('a medication bottle cannot become catheter inventory through photo processing',async()=>{
 const {handleKnown}=await import('../worker/conversation.js');const s=state();const reply=handleKnown(s,'Record this photo',{type:'supplies',product:'Gabapentin 800 mg tablet prescription bottle',unitsPerBox:90},'bottle');assert.equal(reply.proposal,undefined);assert.notEqual(s.draft?.kind,'supplies');assert.equal(s.inventory[0].count,null);
});
