import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../worker/domain.js';
import {journalQuery,urineOutputSummary,urineOutputReply} from '../worker/journal.js';
import {structuredCareTool,agentCareTools} from '../worker/care-agent.js';
import {runCareAgent} from '../worker/care-orchestrator.js';

// Synthetic account in New York (UTC-5 in November).
const at=Date.parse('2026-11-10T21:53:00Z');
function state(){
 const s=initialState({real:true});s.settings.timezone='America/New_York';
 s.photos=[{id:'p1',createdAt:'2026-11-10T12:05:00Z',analysis:{type:'bag',volumeMl:430}},{id:'p2',createdAt:'2026-11-10T19:00:00Z',analysis:{type:'bag',volumeMl:90}}];
 s.events=[
  {id:'a',kind:'catheterization',occurredAt:'2026-11-10T06:00:00Z',createdAt:'2026-11-10T06:10:00Z',data:{volume:450}},
  {id:'b',kind:'catheterization',occurredAt:'2026-11-10T12:00:00Z',createdAt:'2026-11-10T12:10:00Z',data:{volume:430,photoId:'p1'}},
  {id:'c',kind:'catheterization',occurredAt:'2026-11-10T16:45:00Z',createdAt:'2026-11-10T16:46:00Z',data:{volume:200}},
  {id:'d',kind:'catheterization',occurredAt:'2026-11-10T18:00:00Z',createdAt:'2026-11-10T18:01:00Z',data:{}},
  {id:'e',kind:'catheterization',occurredAt:'2026-11-10T20:00:00Z',createdAt:'2026-11-10T20:01:00Z',voided:true,data:{volume:999}},
  {id:'f',kind:'bag',occurredAt:'2026-11-10T21:30:00Z',createdAt:'2026-11-10T21:31:00Z',data:{volume:230}},
  {id:'g',kind:'vitals',occurredAt:'2026-11-10T15:00:00Z',createdAt:'2026-11-10T15:00:00Z',data:{systolic:120,diastolic:80}},
  {id:'h',kind:'catheterization',occurredAt:'2026-11-09T21:00:00Z',createdAt:'2026-11-09T21:01:00Z',data:{volume:300}}
 ];
 return s;
}

test('urine total since a local clock counts approved amounts only and includes the boundary record',()=>{
 const sum=urineOutputSummary(state(),{relativeDate:'today',startClock:'07:00'},at);
 assert.equal(sum.totalMl,860);assert.equal(sum.measuredCount,3);assert.equal(sum.withoutAmount,1);assert.equal(sum.unapprovedPhotos,1);
 const reply=urineOutputReply(sum);
 assert.match(reply,/^860 mL recorded since 7:00 AM today, from 3 entries\./);
 assert.match(reply,/7:00 AM: 430 mL\n11:45 AM: 200 mL\n4:30 PM: 230 mL/);
 assert.match(reply,/1 record has no amount/);assert.match(reply,/1 bag photo is not approved yet and is not counted/);
 assert.doesNotMatch(reply,/999|450/);
});
test('urine total defaults to today, supports yesterday, clock windows and empty periods',()=>{
 const s=state();
 assert.equal(urineOutputSummary(s,{},at).totalMl,1310);
 assert.equal(urineOutputSummary(s,{startClock:'07:00'},at).totalMl,860);
 assert.equal(urineOutputSummary(s,{relativeDate:'yesterday'},at).totalMl,300);
 assert.equal(urineOutputSummary(s,{relativeDate:'today',startClock:'08:00',endClock:'12:00'},at).totalMl,200);
 assert.equal(urineOutputSummary(s,{endClock:'08:00'},at).totalMl,880);
 assert.match(urineOutputReply(urineOutputSummary(s,{startDate:'2026-11-01',endDate:'2026-11-02'},at)),/^I have no approved urine records from Nov 1 to Nov 2\./);
 assert.throws(()=>urineOutputSummary(s,{startClock:'7am'},at));assert.throws(()=>urineOutputSummary(s,{relativeDate:'today',startDate:'2026-11-10'},at));
});
test('journal lookups accept a local clock window',()=>{
 const q=journalQuery(state(),{category:'catheter',relativeDate:'today',startClock:'07:00',limit:50},at);
 assert.ok(q.entries.every(e=>Date.parse(e.occurredAt)>=Date.parse('2026-11-10T12:00:00Z')));assert.ok(!q.entries.some(e=>e.id==='a'));assert.equal(q.filters.startClock,'07:00');
});
test('a urine amount question is answered in words without journal cards or saved changes',async()=>{
 const s=state(),before=JSON.stringify(s.events);
 assert.ok(agentCareTools.some(t=>t.name==='urine_output_total'));
 const r=await structuredCareTool(s,'How many ml of urine I had so far since 7am?',{name:'urine_output_total',arguments:{relativeDate:'today',startClock:'07:00'}},{});
 assert.match(r.reply.content,/mL recorded since 7:00 AM today/);assert.equal(r.reply.journalResult,undefined);assert.equal(JSON.stringify(s.events),before);assert.equal(s.proposals.length,0);
});
test('an answer calculated from a journal lookup does not attach journal cards',async()=>{
 const s=state();let calls=0;
 const model=async()=>calls++?{kind:'text',content:'Your last blood pressure was 120/80.'}:{kind:'tool',tool:{name:'query_care_journal',arguments:{purpose:'lookup',category:'vitals',limit:5}}};
 const reply=await runCareAgent({}, 'test', s,'What was my last blood pressure?',{},model);
 assert.equal(reply.content,'Your last blood pressure was 120/80.');assert.equal(reply.journalResult,undefined);
});
