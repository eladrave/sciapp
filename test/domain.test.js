import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, proposal, finishProposal, undoEvent } from '../worker/domain.js';
test('care approval deducts once and reversal restores stock',()=>{
 const s=initialState();const m=proposal(s,'catheterization',{volume:350});s.messages.push(m);
 finishProposal(s,m.proposal.id,'approve');finishProposal(s,m.proposal.id,'approve');
 assert.equal(s.inventory[0].count,59);assert.equal(s.events.length,1);
 undoEvent(s,s.events[0].id);assert.equal(s.inventory[0].count,60);assert.equal(s.events[1].voided,true);
});
test('a new proposal cancels an older approval',()=>{
 const s=initialState();const a=proposal(s,'catheterization',{volume:350});s.messages.push(a);
 proposal(s,'catheterization',{volume:450});finishProposal(s,a.proposal.id,'approve');
 assert.equal(s.inventory[0].count,60);assert.equal(a.proposal.status,'cancelled');
});
test('invalid quantities and missing vitals never become approvals',()=>{
 const s=initialState();assert.throws(()=>proposal(s,'supplies',{boxes:1.5,perBox:30}));
 assert.throws(()=>proposal(s,'vitals',{systolic:100}));assert.throws(()=>proposal(s,'settings',{muted:'false'}));
});
test('bag contents do not deduct a catheter or accumulate as new output',()=>{
 const s=initialState();const m=proposal(s,'bag',{volume:400});finishProposal(s,m.proposal.id,'approve');
 assert.equal(s.inventory[0].count,60);assert.equal(s.events[0].kind,'bag');assert.equal(s.events[0].delta,null);
});
test('cannot undo a delivery when doing so would produce negative inventory',()=>{
 const s=initialState();s.inventory[0].count=0;const a=proposal(s,'supplies',{boxes:1,perBox:1});finishProposal(s,a.proposal.id,'approve');
 const deliveryId=s.events[0].id;const b=proposal(s,'catheterization',{});finishProposal(s,b.proposal.id,'approve');
 assert.throws(()=>undoEvent(s,deliveryId));assert.equal(s.inventory[0].count,0);
});
