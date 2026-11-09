import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { initialState } from '../worker/domain.js';
import { ownerNamespace, backfillMemory, archiveMessages, processIndexJobs, retrieveContext, listMemory, forgetMemory, setMemory, seedResources, addResource, memoryChat, syncMemoryAccounts } from '../worker/retrieval.js';

test('private semantic retrieval enforces namespace and D1 owner checks, always-on memory, deletion and retry',async()=>{
 const mf=new Miniflare({workers:[{config:{name:'test',compatibilityDate:'2026-11-08',env:{DB:{type:'d1',id:'DB'}},manifest:{mainModule:'worker.js',modules:{'worker.js':{type:'esm',contents:'export default {fetch(){return new Response("ok")}}'}}}}}]});
 try{
 const db=await mf.getD1Database('DB');for(const name of ['0001_initial.sql','0004_retrieval.sql','0005_admin.sql','0006_resource_files.sql','0007_resource_transcription.sql','0008_health_systems.sql'])await db.exec((await readFile(`migrations/${name}`,'utf8')).replace(/\n/g,' '));
 for(const id of ['clerk:a','clerk:b'])await db.prepare('INSERT INTO accounts VALUES(?,?,0,?)').bind(id,JSON.stringify(initialState({real:true})),new Date().toISOString()).run();
 let fail=false;const records=new Map(),deleted=[],queries=[];
 const index={upsert:async rows=>{if(fail)throw Error('temporary');for(const r of rows)records.set(r.id,r);},deleteByIds:async ids=>{for(const id of ids){records.delete(id);deleted.push(id);}},query:async(vector,opts)=>{queries.push(opts);return{matches:[...records.keys()].map(id=>({id,score:0.9}))};}};
 const env={DB:db,AI:{run:async()=>({data:[Array(768).fill(0.1)]})},PERSONAL_MEMORY:index,SHARED_RESOURCES:{...index,query:async()=>({matches:[]})}};
 const note=(id,text)=>({id,role:'user',content:text,createdAt:new Date().toISOString()});
 await backfillMemory(env,'clerk:a',{messages:[note('1','I prefer a long pause before sending my spoken messages.')]});
 await archiveMessages(env,'clerk:b',[note('2','My private exercise preference is unrelated to user A.')]);
 await processIndexJobs(env,10);assert.equal(records.size,2);
 const result=await retrieveContext(env,'clerk:a','What voice pause do I prefer?');assert.equal(result.memories.length,1);assert.match(result.memories[0].body,/long pause/);assert.equal(queries[0].namespace,await ownerNamespace('clerk:a'));assert.notEqual(await ownerNamespace('clerk:a'),await ownerNamespace('clerk:b'));
 const [a,b]=await Promise.all([listMemory(env,'clerk:a'),listMemory(env,'clerk:b')]);
 await forgetMemory(env,'clerk:a',b.memories[0].id);assert.equal((await listMemory(env,'clerk:b')).memories.length,1);
 await assert.rejects(setMemory(env,'clerk:a',false),e=>e.status===409);await db.prepare('UPDATE memory_settings SET enabled=0 WHERE account_id=?').bind('clerk:a').run();assert.equal((await listMemory(env,'clerk:a')).enabled,true);assert.equal((await retrieveContext(env,'clerk:a','pause')).memories.length,1);assert.match((await memoryChat(env,'clerk:a','Turn memory off',{})).content,/always on/);await forgetMemory(env,'clerk:a',a.memories[0].id);assert.equal((await retrieveContext(env,'clerk:a','pause')).memories.length,0);
 await archiveMessages(env,'clerk:a',[note('1','I prefer a long pause before sending my spoken messages.')]);assert.equal((await listMemory(env,'clerk:a')).memories.length,0);await processIndexJobs(env,10);assert.ok(deleted.includes(a.memories[0].id+'-0'));
 await archiveMessages(env,'clerk:a',[note('4','Remember this new preference for tomorrow, after clearing.')]);fail=true;await processIndexJobs(env,10);let job=await db.prepare('SELECT attempts FROM retrieval_chunks WHERE account_id=? AND deleted_at IS NULL').bind('clerk:a').first();assert.equal(job.attempts,1);fail=false;await db.prepare('UPDATE retrieval_chunks SET next_attempt_at=0').run();await processIndexJobs(env,10);
 assert.equal((await retrieveContext(env,'clerk:a','preference')).memories.length,1);
 await seedResources(env);await seedResources(env);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM retrieval_sources WHERE scope='shared'").first()).n,4);
 await assert.rejects(addResource(env,'clerk:b',{title:'Test',url:'https://example.com',text:'A sufficiently long general educational excerpt.'}),e=>e.status===403);
 await db.prepare('INSERT INTO resource_admins VALUES(?)').bind('clerk:a').run();await assert.rejects(addResource(env,'clerk:a',{title:'Test',url:'javascript:alert(1)',text:'A sufficiently long general educational excerpt.'}));
 await addResource(env,'clerk:a',{title:'Test',url:'https://example.com/resource',text:'A sufficiently long general educational excerpt.'});
 const publishState=initialState({real:true});await memoryChat(env,'clerk:a','Add shared resource',publishState);await memoryChat(env,'clerk:a','A reviewed synthetic guide',publishState);await memoryChat(env,'clerk:a','https://example.com/guide',publishState);const review=await memoryChat(env,'clerk:a','This synthetic educational excerpt is only for testing resource review.',publishState);assert.ok(review.options.includes('Publish shared resource'));assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM retrieval_sources WHERE scope='shared'").first()).n,5);await memoryChat(env,'clerk:a','Publish shared resource',publishState);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM retrieval_sources WHERE scope='shared'").first()).n,6);
 const state=initialState({real:true});assert.match((await memoryChat(env,'clerk:a','Clear my memories',state)).content,/confirm/);assert.equal((await listMemory(env,'clerk:a')).memories.length,1);await memoryChat(env,'clerk:a','Yes, clear my memories',state);assert.equal((await listMemory(env,'clerk:a')).memories.length,0);
 await archiveMessages(env,'clerk:a',[{...note('missed-before-clear','This old unindexed message must not appear after clearing.'),createdAt:new Date(Date.now()-1000).toISOString()}]);await syncMemoryAccounts(env);assert.equal((await listMemory(env,'clerk:a')).memories.length,0);await archiveMessages(env,'clerk:a',[note('correction','No, I prefer longer pauses before sending voice messages.')]);assert.equal((await listMemory(env,'clerk:a')).memories.length,1);
 }finally{await mf.dispose();}
});
