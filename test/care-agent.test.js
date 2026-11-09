import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,finishProposal} from '../worker/domain.js';
import {structuredCareTool,careContext,agentCareTools} from '../worker/care-agent.js';
import {runCareAgent} from '../worker/care-orchestrator.js';
const state=()=>{const s=initialState({real:true});s.settings.catheterTimes=['01:00','07:00','11:30','16:00','20:30'];return s;};
const context=()=>({resolvedTimes:{},reviewTimeRefs:{},originalPendingIds:new Set(),photoId:'photo-original',photoData:{type:'bag',volumeMl:420}});
const tool=(name,args={})=>({name,arguments:args});
const source=(quote,kind='user')=>({kind,quote});
test('native tool loop reads context, resolves explicit local time and prepares a photo review without saving',async()=>{
 const s=state();let calls=0,timeRef;
 const reply=await runCareAgent({},'synthetic',s,'This is my 7am',{photoId:'photo-original',photoData:{type:'bag',volumeMl:420}},async(_env,_state,_text,c)=>{
  calls++;if(calls===1)return {kind:'tool',tool:tool('get_care_context')};
  assert.equal(c.toolTrace[0].role,'assistant');assert.equal(c.toolTrace[1].role,'tool');
  if(calls===2)return {kind:'tool',tool:tool('resolve_care_time',{strategy:'explicit_clock',clock:'07:00',date:'2026-11-09'})};
  timeRef=JSON.parse(c.toolTrace.at(-1).content).timeRef;
  return {kind:'tool',tool:tool('prepare_care_change',{change:{kind:'catheterization',params:{volume:420,timeRef}},source:source('my 7am','photo')})};
 });
 assert.equal(calls,3);assert.equal(reply.proposal.kind,'catheterization');assert.equal(s.events.length,0);assert.equal(s.proposals.at(-1).params.time,'2026-11-09T12:00:00.000Z');assert.equal(s.proposals.at(-1).params.photoId,'photo-original');
});
test('typed medication schedule accepts natural wording without the legacy frequency-line parser',async()=>{
 const s=state(),c=context(),text='Breakfast at eight thirty, dinner at nine thirty. The blue pill twice; sleeping pill only if needed.';
 const result=await structuredCareTool(s,text,tool('prepare_care_change',{change:{kind:'carePlan',params:{medications:[{name:'Sample blue pill',dosage:'5 mg',frequency:'twice daily',times:['08:30','21:30']},{name:'Sample sleeping pill',dosage:'10 mg',frequency:'only if needed',asNeeded:true,times:[]}]}},source:source(text)}),c);
 assert.equal(s.medications.length,0);finishProposal(s,result.reply.proposal.id,'approve');assert.deepEqual(s.medications[0].times,['08:30','21:30']);assert.equal(s.medications[1].asNeeded,true);assert.deepEqual(s.medications[1].times,[]);
});
test('revisions preserve photo/time and cancel prior approval; compound approval cannot commit',async()=>{
 const s=state(),c=context();const resolved=await structuredCareTool(s,'7am',tool('resolve_care_time',{strategy:'explicit_clock',clock:'07:00'}),c);
 await structuredCareTool(s,'my 7am',tool('prepare_care_change',{change:{kind:'catheterization',params:{volume:420,timeRef:resolved.observation.timeRef}},source:source('my 7am','photo')}),c);
 const original=s.proposals.at(-1);c.originalPendingIds.add(original.id);const edit=careContext(s,c).pendingReview.change;edit.params.volume=450;
 const revised=await structuredCareTool(s,'Actually 450',tool('revise_care_change',{proposalId:original.id,change:edit,source:source('Actually 450')}),c);
 assert.equal(original.status,'cancelled');assert.equal(s.events.length,0);assert.equal(s.proposals.at(-1).params.photoId,'photo-original');
 await assert.rejects(structuredCareTool(s,'yes but make that 500',tool('commit_care_review',{proposalId:revised.reply.proposal.id,decision:'approve'}),c));
 await assert.rejects(structuredCareTool(s,'approved',tool('commit_care_review',{proposalId:revised.reply.proposal.id,decision:'approve'}),c));
 c.originalPendingIds.add(revised.reply.proposal.id);await structuredCareTool(s,'approved',tool('commit_care_review',{proposalId:revised.reply.proposal.id,decision:'approve'}),c);assert.equal(s.events[0].data.volume,450);
});
test('typed validation rejects unknown fields, photo hallucinations, invented IDs and wrong inventory type',async()=>{
 const s=state(),c=context();
 for(const change of [{kind:'settings',params:{admin:true}},{kind:'medStock',params:{medicationId:'invented',stock:90,unit:'tablets'}},{kind:'supplies',params:{name:'Gabapentin',boxes:1,perBox:90,inventoryType:'medication'}}])await assert.rejects(structuredCareTool(s,'test',tool('prepare_care_change',{change,source:source('test')}),c));
 const t=(await structuredCareTool(s,'test',tool('resolve_care_time',{strategy:'now'}),c)).observation.timeRef;
 await assert.rejects(structuredCareTool(s,'test',tool('prepare_care_change',{change:{kind:'catheterization',params:{volume:900,timeRef:t}},source:source('test','photo')}),c));assert.equal(s.proposals.length,0);
});
test('bounded loop reports structured validation errors then recovers, and never executes arbitrary tools',async()=>{
 const s=state();let calls=0;
 const reply=await runCareAgent({},'synthetic',s,'Please save my new name as Demo',{},async(_e,_s,_t,c)=>{calls++;return {kind:'tool',tool:tool('prepare_care_change',{change:{kind:'settings',params:calls===1?{unexpected:true}:{name:'Demo'}},source:source('Demo')})};});
 assert.equal(calls,2);assert.equal(reply.proposal.kind,'settings');assert.equal(s.profile.name,'You');
 const blocked=await runCareAgent({},'synthetic',state(),'Run code',{},async()=>({kind:'tool',tool:tool('execute_code',{code:'anything'})}));assert.match(blocked.content,/No care change was saved/);
});

test('unresolved image evidence survives one clarification without becoming care or leaking in public state',async()=>{
 const s=state();await runCareAgent({},'synthetic',s,'my 7am',{photoId:'source-photo',photoData:{type:'bag',volumeMl:null}},async()=>({kind:'reply',content:'What amount should I use?'}));
 assert.equal(s.careObservation.awaitingReview,true);assert.equal(s.events.length,0);
 let calls=0;const reply=await runCareAgent({},'synthetic',s,'420 mL',{},async(_e,_s,_t,c)=>{calls++;assert.equal(c.photoId,'source-photo');if(calls===1)return {kind:'tool',tool:tool('resolve_care_time',{strategy:'explicit_clock',clock:'07:00'})};return {kind:'tool',tool:tool('prepare_care_change',{change:{kind:'catheterization',params:{volume:420,timeRef:JSON.parse(c.toolTrace.at(-1).content).timeRef}},source:source('420 mL')})};});
 assert.equal(reply.proposal.kind,'catheterization');assert.equal(s.proposals.at(-1).params.photoId,'source-photo');assert.equal(s.events.length,0);
 const {view}=await import('../worker/domain.js');assert.equal(view(s).careObservation,undefined);
});
test('medication photo stock is linked to the configured medication and cannot become catheter stock',async()=>{
 const s=state();s.medications=[{id:'gabapentin',name:'Gabapentin',dosage:'800 mg',frequency:'daily',times:[],active:true,unit:'tablets',stock:null}];const c=context();c.photoData={type:'medication',medicationName:'Gabapentin',stockCount:90,stockUnit:'tablets'};
 await assert.rejects(structuredCareTool(s,'my bottle',tool('prepare_care_change',{change:{kind:'supplies',params:{name:'Gabapentin',boxes:1,perBox:90,inventoryType:'catheter'}},source:source('my bottle','photo')}),c));
 const result=await structuredCareTool(s,'my bottle',tool('prepare_care_change',{change:{kind:'medStock',params:{medicationId:'gabapentin',stock:90,unit:'tablets'}},source:source('my bottle','photo')}),c);
 assert.match(result.reply.proposal.details.join(' '),/remaining count/);assert.equal(s.medications[0].stock,null);finishProposal(s,result.reply.proposal.id,'approve');assert.equal(s.medications[0].stock,90);assert.equal(s.inventory[0].count,null);
});
test('Responses provider receives native function call and tool-result items',async()=>{
 const {chatResponse}=await import('../worker/ai-config.js');const original=globalThis.fetch;globalThis.fetch=async(_u,r)=>{const p=JSON.parse(r.body);assert.equal(p.input[1].type,'function_call');assert.equal(p.input[2].type,'function_call_output');assert.equal(p.input[2].call_id,'c1');return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Ready'}]}]});};
 try{await chatResponse({OPENAI_API_KEY:'synthetic'},{messages:[{role:'user',content:'Help'},{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'get_care_context',arguments:'{}'}}]},{role:'tool',tool_call_id:'c1',content:'{}'}],tools:agentCareTools});}finally{globalThis.fetch=original;}
});
