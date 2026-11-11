import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../worker/domain.js';
import {runCareAgent} from '../worker/care-orchestrator.js';
import {widenPassages} from '../worker/retrieval.js';
import {agentCareTools,agentPrompt} from '../worker/care-agent.js';

const tool=(name,args)=>({name,arguments:args,callId:crypto.randomUUID()});
test('a knowledge question sent to the journal by mistake is handed back and answered from the resources',async()=>{
 const s=initialState({real:true});s.settings.timezone='America/New_York';let calls=0,seen;
 const sources=[{title:'Yes You Can',url:'/api/resources/files/u-1',text:'A bowel program is a plan for emptying the bowel at a regular time.',body:'A bowel program is a plan for emptying the bowel at a regular time.',upload_id:'u-1'}];
 const reply=await runCareAgent({},'synthetic',s,'Explain to me the bowel program and show me the images that are related to that.',{sources},async(_e,_s,_t,c)=>{calls++;
  if(calls===1)return {kind:'tool',tool:tool('query_care_journal',{purpose:'show',category:'bowel',photosOnly:true})};
  seen=JSON.parse(c.toolTrace.at(-1).content);return {kind:'reply',content:'The bowel program is a plan for emptying the bowel at a regular time.',sources:[{title:'Yes You Can',url:'/api/resources/files/u-1'}]};});
 assert.equal(calls,2);assert.deepEqual(seen.entries,[]);assert.match(seen.note,/answer it now from Sources/);
 assert.match(reply.content,/^The bowel program is a plan/);assert.equal(reply.journalResult,undefined);assert.equal(reply.sources.length,1);
 // Asked a second time in the same turn, the journal does say there is nothing, so the turn cannot loop.
 const stuck=await runCareAgent({},'synthetic',s,'Show my bowel records',{},async()=>({kind:'tool',tool:tool('query_care_journal',{purpose:'show',category:'bowel'})}));
 assert.match(stuck.content,/^No saved journal entries match/);
});
test('search_resources adds passages to the turn so the answer can cite them and show their figures',async()=>{
 const s=initialState({real:true}),sources=[],queries=[];let calls=0,seen;
 const search=async query=>{queries.push(query);return {memories:[{body:'Prefers morning exercise.'}],sources:query.includes('shoulder')?[{title:'Yes You Can',url:'/api/resources/files/u-1',text:'Shoulder rotation: bend the elbow to 90 degrees.',body:'Shoulder rotation: bend the elbow to 90 degrees.',upload_id:'u-1'}]:[]};};
 const reply=await runCareAgent({},'synthetic',s,'Explain it to me here',{sources,search},async(_e,_s,_t,c)=>{calls++;
  if(calls===1)return {kind:'tool',tool:tool('search_resources',{query:'shoulder range of motion exercises'})};
  seen=JSON.parse(c.toolTrace.at(-1).content);return {kind:'reply',content:'Shoulder rotation: bend the elbow to 90 degrees.',sources:c.sources.map(({title,url})=>({title,url}))};});
 assert.deepEqual(queries,['shoulder range of motion exercises']);assert.equal(seen.passages[0].resource,'Yes You Can');assert.deepEqual(seen.memories,['Prefers morning exercise.']);
 assert.equal(sources.length,1);assert.equal(sources[0].upload_id,'u-1');assert.equal(reply.sources.length,1);
 let note;await runCareAgent({},'synthetic',s,'What about kites?',{sources:[],search},async(_e,_s,_t,c)=>{if(!c.toolTrace.length)return {kind:'tool',tool:tool('search_resources',{query:'kites'})};note=JSON.parse(c.toolTrace.at(-1).content).note;return {kind:'reply',content:'The resources do not cover that yet.'};});
 assert.match(note,/Nothing in the resources matches/);
 const own=await runCareAgent({},'synthetic',s,'Show me my catheter records from today',{sources:[{title:'Yes You Can',url:'/u',text:'x'}]},async(_e,_s,_t,c)=>c.toolTrace.length?{kind:'reply',content:'Your journal has no catheter records for today.',sources:[{title:'Yes You Can',url:'/u'}]}:{kind:'tool',tool:tool('query_care_journal',{purpose:'show',category:'catheter',relativeDate:'today'})});
 assert.deepEqual(own.sources,[]);
 assert.ok(agentCareTools.some(t=>t.name==='search_resources'));
 const prompt=agentPrompt(s,{sources:[],memories:[]});assert.match(prompt,/never from the journal/);assert.match(prompt,/search_resources/);
});
test('matched chunks are widened with their neighbours and touching matches are merged',async()=>{
 const chunks=new Map(Array.from({length:12},(_,i)=>[`r-book-${i}`,`part${i}`]));
 const env={DB:{prepare:sql=>({bind:(...ids)=>({all:async()=>({results:ids.filter(id=>chunks.has(id)).map(id=>({id,body:chunks.get(id)}))})})})}};
 const base={id:'r-book',title:'Book',url:'/b',upload_id:'u-1'};
 const out=await widenPassages(env,[{...base,body:'part4',score:0.8,chunkId:'r-book-4'},{...base,body:'part5',score:0.9,chunkId:'r-book-5'},{...base,body:'part10',score:0.7,chunkId:'r-book-10'},{...base,body:'part0',score:0.66,chunkId:'r-book-0'},{id:'seed-x',title:'Seed',url:'/s',body:'seed text',score:0.75}]);
 assert.deepEqual(out.map(p=>[p.body,p.score]),[['part3 part4 part5 part6',0.9],['seed text',0.75],['part9 part10 part11',0.7],['part0 part1',0.66]]);
 assert.ok(out.every(p=>p.chunkId===undefined));assert.equal(out[0].upload_id,'u-1');
});
