import test from 'node:test';
import assert from 'node:assert/strict';
import {journalQuery} from '../worker/journal.js';
import {careAgenda} from '../worker/reminders.js';
import {initialState,proposal,finishProposal} from '../worker/domain.js';
import {structuredCareTool} from '../worker/care-agent.js';
const at=Date.parse('2026-11-09T14:30:00Z');
function state(){const s=initialState({real:true});Object.assign(s.settings,{timezone:'America/New_York',catheterRemindersEnabled:true,catheterScheduleMode:'daily',catheterTimes:['07:00','11:30','16:00']});return s;}
test('9:30 New York: 11:30 is upcoming, only 7am and 8:30 meds are unconfirmed, independent of push permission',()=>{
 const s=state();s.settings.notificationsEnabled=false;s.medications=[{id:'a',name:'Sample A',dosage:'5 mg',times:['08:30','21:30'],createdAt:'2026-11-01T00:00:00Z'},{id:'prn',name:'PRN',times:['08:30'],asNeeded:true}];const a=careAgenda(s,at);
 assert.match(a.localNow,/9:30 AM/);assert.equal(a.next.dueAt,'2026-11-09T16:30:00.000Z');assert.deepEqual(a.overdue.map(t=>t.kind),['catheterization','medication']);assert.ok(!a.overdue.some(t=>t.dueAt==='2026-11-09T16:30:00.000Z'));
 s.events.push({kind:'medication',occurredAt:'2026-11-09T14:30:00Z',data:{medicationId:'a',scheduledFor:'2026-11-09T13:30:00.000Z'}});assert.equal(careAgenda(s,at).overdue.filter(t=>t.kind==='medication').length,0);
});
test('journal retrieves old readings by local observation day, pages all history, distinguishes original photos and voided care',()=>{
 const s=state();s.photos=[{id:'bag',createdAt:'2026-11-09T14:00:00Z',analysis:{type:'bag',color:'yellow',cloudiness:'uncertain'}},{id:'raw',createdAt:'2026-11-09T14:00:00Z',analysis:{type:'monitor'}}];
 s.events=Array.from({length:70},(_,i)=>({id:String(i).padStart(3,'0'),kind:'vitals',title:'BP',detail:'120/80',createdAt:'2026-11-09T14:00:00Z',occurredAt:'2026-11-09T03:30:00Z',data:{systolic:120,diastolic:80}}));
 s.events.push({id:'catheter',kind:'catheterization',occurredAt:'2026-11-08T12:00:00Z',createdAt:'2026-11-09T14:00:00Z',data:{photoId:'bag',volume:420}},{id:'wrong',kind:'vitals',createdAt:'2026-11-08T12:00:00Z',voided:true,data:{}});
 const q=journalQuery(s,{category:'vitals',relativeDate:'yesterday',limit:50},at);assert.equal(q.total,70);assert.equal(q.entries.length,50);assert.equal(q.filters.startDate,'2026-11-08');
 const next=journalQuery(s,{category:'vitals',relativeDate:'yesterday',limit:50,cursor:q.nextCursor},at);assert.equal(next.entries.length,20);assert.equal(next.nextCursor,null);assert.equal(new Set([...q.entries,...next.entries].map(e=>e.id)).size,70);
 const photos=journalQuery(s,{category:'catheter',photosOnly:true,limit:3},at);assert.equal(photos.entries[0].photoId,'bag');assert.equal(photos.entries[0].occurredAt,'2026-11-08T12:00:00Z');assert.equal(photos.entries[0].recordedAt,'2026-11-09T14:00:00Z');assert.equal(photos.entries[0].status,'approved');
 assert.equal(journalQuery(s,{category:'vitals',photosOnly:true},at).entries[0].status,'unreviewed');assert.throws(()=>journalQuery(s,{startDate:'2026-02-31'},at));assert.throws(()=>journalQuery(s,{limit:1000},at));
});
test('typed journal lookup searches older data without saving or executing code',async()=>{
 const s=state(),context={};s.events=[{id:'old',kind:'vitals',occurredAt:'2026-01-01T12:00:00Z',createdAt:'2026-01-03T12:00:00Z',data:{systolic:118,diastolic:76}}];const r=await structuredCareTool(s,'BP in January',{name:'query_care_journal',arguments:{purpose:'lookup',category:'vitals',startDate:'2026-01-01',endDate:'2026-01-01',limit:3}},context);assert.equal(r.observation.entries[0].data.systolic,118);assert.equal(s.proposals.length,0);assert.equal(context.journalResult.total,1);
});
test('timed vitals and user observations retain occurrence time separately and require review',()=>{
 const s=state();s.photos=[{id:'owned',createdAt:'2026-11-09T12:00:00Z'}];let p=proposal(s,'vitals',{systolic:120,diastolic:80,time:'2026-11-08T12:00:00Z',photoId:'owned'});assert.equal(s.events.length,0);finishProposal(s,p.proposal.id,'approve');assert.equal(s.events[0].occurredAt,'2026-11-08T12:00:00Z');assert.notEqual(s.events[0].createdAt,s.events[0].occurredAt);
 p=proposal(s,'journalNote',{note:'I noticed cloudiness',category:'catheter',photoId:'owned',time:'2026-11-08T12:00:00Z'});finishProposal(s,p.proposal.id,'approve');const q=journalQuery(s,{category:'catheter'},at);assert.equal(q.entries[0].userObservation,'I noticed cloudiness');assert.throws(()=>proposal(s,'journalNote',{note:'x',category:'catheter',photoId:'someone-else'}));
});
test('logging a reported dose with unknown inventory units preserves stock and matches the specific scheduled occurrence',()=>{const s=state();s.medications=[{id:'a',name:'Sample',dosage:'5 mg',active:true,stock:90,unit:'tablets',unitsConfigured:false}];const p=proposal(s,'medication',{medicationId:'a',scheduledFor:'2026-11-09T13:30:00Z',time:'2026-11-09T13:35:00Z'});finishProposal(s,p.proposal.id,'approve');assert.equal(s.medications[0].stock,90);assert.equal(s.events[0].occurredAt,'2026-11-09T13:35:00Z');assert.equal(s.events[0].data.scheduledFor,'2026-11-09T13:30:00Z');});

test('what is next tool returns server-computed local status without model clock arithmetic',async()=>{const original=Date.now;Date.now=()=>at;try{const r=await structuredCareTool(state(),'Anything coming up?',{name:'get_care_agenda',arguments:{}},{});assert.match(r.reply.content,/Next scheduled item: Catheterization, Nov 9, 2026, 11:30 AM/);assert.match(r.reply.content,/7:00 AM/);assert.ok(!r.reply.content.includes('11:30 AM have passed'));}finally{Date.now=original;}});
