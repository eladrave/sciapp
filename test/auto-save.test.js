import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,proposal,message} from '../worker/domain.js';
import {autoSave,undoSaved,correctSaved,AUTO_SAVE_KINDS} from '../worker/auto-save.js';

const fresh=()=>{const s=initialState({real:true});s.settings.timezone='America/New_York';s.inventory.find(i=>i.id==='catheter').count=10;return s;};
const say=(s,reply)=>{s.messages.push(reply);return reply;};
test('a stated catheterization is saved at once, uses stock, and one Undo reverses it',()=>{
 const s=fresh();const reply=say(s,autoSave(s,proposal(s,'catheterization',{volume:400,time:new Date(Date.now()-600000).toISOString()})));
 assert.equal(reply.proposal.status,'approved');assert.equal(reply.proposal.autoSaved,true);assert.equal(reply.proposal.undoable,true);
 assert.match(reply.content,/^Saved\..*9 .* remaining\. Choose Undo if this is wrong\.$/);
 assert.equal(s.events.filter(e=>e.kind==='catheterization'&&!e.voided).length,1);assert.equal(s.inventory.find(i=>i.id==='catheter').count,9);
 assert.equal(s.proposals.at(-1).status,'approved');
 const undone=undoSaved(s,reply.proposal.id);assert.match(undone.content,/^Undone\./);
 assert.equal(s.events.filter(e=>e.kind==='catheterization'&&!e.voided).length,0);assert.equal(s.inventory.find(i=>i.id==='catheter').count,10);
 assert.equal(s.messages.at(-1).proposal.undone,true);
 assert.match(undoSaved(s,reply.proposal.id).content,/already undone/);
 assert.throws(()=>undoSaved(s,'00000000-0000-0000-0000-000000000000'),e=>e.status===404);
});
test('asking first, risky kinds and refused saves keep the review',()=>{
 const s=fresh();s.settings.askBeforeSaving=true;
 let reply=autoSave(s,proposal(s,'catheterization',{volume:300}));assert.equal(reply.proposal.status,'pending');assert.equal(s.events.length,0);
 s.settings.askBeforeSaving=false;
 reply=autoSave(s,proposal(s,'caregiver',{email:'helper@example.org',role:'follow'}));assert.equal(reply.proposal.status,'pending');assert.equal(s.caregivers.length,0);
 for(const kind of ['carePlan','medicationRemove','caregiver'])assert.equal(AUTO_SAVE_KINDS.has(kind),false);
 s.inventory.find(i=>i.id==='catheter').count=0;const before=JSON.stringify(s.events);
 reply=autoSave(s,proposal(s,'catheterization',{volume:300}));
 assert.equal(reply.proposal.status,'pending');assert.match(reply.content,/not enough.*Nothing was saved\.$/);assert.equal(JSON.stringify(s.events),before);assert.equal(s.proposals.at(-1).status,'pending');
 const plain=message('assistant','Hello');assert.equal(autoSave(s,plain),plain);
});
test('a photo reading is saved as read and a spoken correction replaces it instead of adding a second record',()=>{
 const s=fresh();s.photos.push({id:'11111111-1111-4111-8111-111111111111'});
 const time=new Date(Date.now()-900000).toISOString();
 const reply=say(s,autoSave(s,proposal(s,'catheterization',{volume:300,photoId:'11111111-1111-4111-8111-111111111111',time})));
 assert.match(reply.content,/^I read about 300 mL from the photo and saved it\..*say the right one, or choose Undo\.$/);
 assert.equal(correctSaved(s,'What is next?'),null);assert.equal(correctSaved(s,'I also catheterized at 7 am and got 200 mL, please add that as a separate record from this morning'),null);
 const fixed=say(s,correctSaved(s,'actually 350'));
 assert.match(fixed.content,/^Corrected\./);assert.equal(fixed.proposal.autoSaved,true);
 const live=s.events.filter(e=>e.kind==='catheterization'&&!e.voided);
 assert.equal(live.length,1);assert.equal(live[0].data.volume,350);assert.equal(live[0].data.photoId,'11111111-1111-4111-8111-111111111111');assert.equal(live[0].occurredAt,time);
 assert.equal(s.inventory.find(i=>i.id==='catheter').count,9);
 assert.equal(s.messages.find(m=>m.proposal?.id===reply.proposal.id).proposal.undone,true);
 const again=say(s,correctSaved(s,'340 ml'));assert.equal(s.events.filter(e=>e.kind==='catheterization'&&!e.voided)[0].data.volume,340);assert.ok(again);
 undoSaved(s,again.proposal.id);assert.equal(correctSaved(s,'actually 300'),null);
 s.settings.askBeforeSaving=true;assert.equal(correctSaved(s,'actually 300'),null);
});
test('preferences are saved at once without an Undo button',()=>{
 const s=fresh();const reply=autoSave(s,proposal(s,'settings',{textScale:1.25}));
 assert.equal(s.settings.textScale,1.25);assert.equal(reply.proposal.autoSaved,true);assert.equal(reply.proposal.undoable,false);assert.doesNotMatch(reply.content,/Undo/);
});
