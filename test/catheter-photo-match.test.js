import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,finishProposal} from '../worker/domain.js';
import {reminderTasks,careAgenda,catheterScheduleMatch} from '../worker/reminders.js';
import {scheduledBagPhotoReview,bagPhotoTiming} from '../worker/photo-review.js';
// Synthetic account in America/New_York (UTC-5 on this date): 07:00 local is 12:00Z.
const state=()=>{const s=initialState({real:true});Object.assign(s.settings,{timezone:'America/New_York',catheterRemindersEnabled:true,catheterScheduleMode:'daily',catheterTimes:['07:00','11:30','16:00'],catheterScheduleUpdatedAt:'2026-11-01T00:00:00Z',catheterScheduleId:'synthetic'});s.photos.push({id:'bag-photo'});return s;};
const seven='2026-11-09T12:00:00.000Z',capture=local=>({source:'EXIF DateTimeOriginal',localDateTime:local,offset:null,instant:null});
const openSeven=(s,at)=>careAgenda(s,at).overdue.some(t=>t.dueAt===seven);
test('a bag photo taken up to three hours after a scheduled catheterization counts for that occurrence',()=>{
 const s=state(),at=Date.parse('2026-11-09T15:10:00Z');
 assert.equal(catheterScheduleMatch(s,'2026-11-09T12:05:00Z',at).dueAt,seven);
 assert.equal(catheterScheduleMatch(s,'2026-11-09T14:59:00Z',at).dueAt,seven);
 assert.equal(catheterScheduleMatch(s,'2026-11-09T15:00:00Z',at).clock,'7:00 AM');
 // Past the three-hour window the photo belongs to the next occurrence when that starts within 90 minutes.
 assert.equal(catheterScheduleMatch(s,'2026-11-09T15:05:00Z',at).dueAt,'2026-11-09T16:30:00.000Z');
 // Slightly early care still counts; a time far from every occurrence, or in the future, matches nothing.
 assert.equal(catheterScheduleMatch(s,'2026-11-09T11:10:00Z',at).dueAt,seven);
 assert.equal(catheterScheduleMatch(s,'2026-11-09T09:00:00Z',at),null);
 assert.equal(catheterScheduleMatch(s,'2026-11-09T18:00:00Z',at),null);
 s.settings.catheterRemindersEnabled=false;assert.equal(catheterScheduleMatch(s,'2026-11-09T12:05:00Z',at),null);
});
test('an approved bag photo from 9:40 stops the 7:00 check-in, and only that occurrence',()=>{
 const s=state(),at=Date.parse('2026-11-09T14:45:00Z');assert.equal(openSeven(s,at),true);
 const reply=scheduledBagPhotoReview(s,'Help me record this photo.',{type:'bag',volumeMl:380,captureTime:capture('2026-11-09T09:40:00')},'bag-photo',at);
 assert.equal(reply.proposal.kind,'catheterization');assert.equal(reply.proposal.editablePhotoCare,true);
 assert.match(reply.content,/380 mL/);assert.match(reply.content,/7:00 AM scheduled catheterization/);assert.match(reply.content,/9:40 AM/);
 assert.match(reply.proposal.details.join(' | '),/Counts for your 7:00 AM scheduled catheterization/);assert.match(reply.proposal.details.join(' | '),/no timezone/i);
 // Nothing is recorded, and the check-in still asks, until the review is approved.
 assert.equal(s.events.length,0);assert.equal(openSeven(s,at),true);
 finishProposal(s,reply.proposal.id,'approve');
 assert.equal(s.events[0].kind,'catheterization');assert.equal(s.events[0].occurredAt,'2026-11-09T14:40:00.000Z');assert.equal(s.events[0].data.volume,380);assert.equal(s.events[0].data.photoId,'bag-photo');
 assert.equal(openSeven(s,at),false);
 const later=Date.parse('2026-11-09T16:45:00Z');assert.ok(careAgenda(s,later).overdue.some(t=>t.dueAt==='2026-11-09T16:30:00.000Z'));
 assert.ok(reminderTasks(s,later).some(t=>t.dueAt==='2026-11-09T21:00:00.000Z'));
 // The same photo is never counted twice.
 assert.equal(scheduledBagPhotoReview(s,'',{type:'bag',volumeMl:380,captureTime:capture('2026-11-09T09:40:00')},'bag-photo',later),null);
});
test('a second record in the same window does not consume a later occurrence by proximity alone',()=>{
 const s=state(),at=Date.parse('2026-11-09T14:45:00Z');
 s.events.unshift({kind:'catheterization',occurredAt:'2026-11-09T12:20:00Z'},{kind:'catheterization',occurredAt:'2026-11-09T13:30:00Z'});
 assert.equal(openSeven(s,at),false);assert.ok(reminderTasks(s,at).some(t=>t.dueAt==='2026-11-09T16:30:00.000Z'));
});
test('the photo path defers to the conversation when facts are missing or the user said something else',()=>{
 const at=Date.parse('2026-11-09T14:45:00Z'),bag={type:'bag',volumeMl:380,captureTime:capture('2026-11-09T09:40:00')};
 assert.equal(scheduledBagPhotoReview(state(),'this was last night',bag,'bag-photo',at),null);
 assert.equal(scheduledBagPhotoReview(state(),'',{...bag,volumeMl:null},'bag-photo',at),null);
 assert.equal(scheduledBagPhotoReview(state(),'',{...bag,type:'monitor'},'bag-photo',at),null);
 // A camera clock in the future is not trusted.
 assert.equal(scheduledBagPhotoReview(state(),'',{...bag,captureTime:capture('2026-11-09T13:00:00')},'bag-photo',at),null);
 // A photo far from any scheduled time is left to the conversation.
 assert.equal(scheduledBagPhotoReview(state(),'',{...bag,captureTime:capture('2026-11-09T04:00:00')},'bag-photo',at),null);
 // An existing pending review is never replaced silently.
 const busy=state();scheduledBagPhotoReview(busy,'',bag,'bag-photo',at);busy.photos.push({id:'second'});assert.equal(scheduledBagPhotoReview(busy,'',bag,'second',at),null);
});
test('without a camera timestamp the upload time is used and labelled',()=>{
 const s=state(),at=Date.parse('2026-11-09T13:15:00Z');
 const timing=bagPhotoTiming(s,{type:'bag',volumeMl:300,captureTime:null},at);assert.equal(timing.time,'2026-11-09T13:15:00.000Z');assert.equal(timing.match.dueAt,seven);
 const reply=scheduledBagPhotoReview(s,'Photo attached',{type:'bag',volumeMl:300,captureTime:null},'bag-photo',at);
 assert.match(reply.proposal.details.join(' | '),/no camera timestamp, so the upload time is used/);
});
test('interval reminders match a bag photo once the next catheterization is nearly due',()=>{
 const s=state();Object.assign(s.settings,{catheterScheduleMode:'interval',catheterIntervalHours:4,catheterStartAt:'2026-11-09T10:00:00Z'});const at=Date.parse('2026-11-09T15:00:00Z');
 assert.equal(catheterScheduleMatch(s,'2026-11-09T14:30:00Z',at).dueAt,'2026-11-09T14:00:00.000Z');
 assert.equal(catheterScheduleMatch(s,'2026-11-09T11:00:00Z',at),null);
});
