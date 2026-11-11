import { AppError, now, message } from './domain.js';
import { resources, retrieve } from './resources.js';
export const EMBEDDING_MODEL='@cf/baai/bge-base-en-v1.5';
export const retrievalReady=env=>!!(env.DB&&env.AI&&env.PERSONAL_MEMORY&&env.SHARED_RESOURCES);
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');
export const ownerNamespace=async id=>'u-'+(await digest(id)).slice(0,48);
export function splitText(text){const source=/^WEBVTT\b|\d{2}:\d{2}[^\n]*-->/m.test(text)?text.split(/\r?\n/).filter(line=>line.trim()&&!/^(?:WEBVTT|\d+$|\d{2}:\d{2}[^\n]*-->)/.test(line.trim())).join(' '):text;return (source.match(/[\s\S]{1,500}(?=\s|$)|[\s\S]{1,500}/g)||[]).map(chunk=>chunk.trim()).filter(Boolean);}
// Inserts every chunk of a long text in a few statements: each statement carries up to 100 chunks as one JSON value.
export function chunkInsertStatements(env,sourceId,body,guardSql,guardParams){const chunks=splitText(body),statements=[];for(let offset=0;offset<chunks.length;offset+=100)statements.push(env.DB.prepare(`INSERT OR IGNORE INTO retrieval_chunks(id,source_id,scope,body) SELECT ?||'-'||CAST(key+? AS INTEGER),?,'shared',value FROM json_each(?) WHERE ${guardSql}`).bind(sourceId,offset,sourceId,JSON.stringify(chunks.slice(offset,offset+100)),...guardParams));return statements;}
export async function memorySettings(env,id){const row=await env.DB.prepare('SELECT backfilled,last_sync_at FROM memory_settings WHERE account_id=?').bind(id).first();return {enabled:1,backfilled:row?.backfilled||0,last_sync_at:row?.last_sync_at||0};}
export async function resourceAdmin(env,id){return !!await env.DB.prepare('SELECT account_id FROM resource_admins WHERE account_id=?').bind(id).first();}
async function addSource(env,{id,scope,accountId=null,title,url=null,body,observedAt=null}){
 const allowed=scope==='personal'?" WHERE ?>=COALESCE((SELECT last_sync_at FROM memory_settings WHERE account_id=?),0)":'';
 const values=[id,scope,accountId,title,url,body,now(),...(scope==='personal'?[Date.parse(observedAt||now()),accountId]:[])];
 const statements=[env.DB.prepare('INSERT OR IGNORE INTO retrieval_sources(id,scope,account_id,title,url,body,created_at) SELECT ?,?,?,?,?,?,?'+allowed).bind(...values)];
 splitText(body).forEach((chunk,i)=>statements.push(env.DB.prepare('INSERT OR IGNORE INTO retrieval_chunks(id,source_id,scope,account_id,body) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM retrieval_sources WHERE id=? AND deleted_at IS NULL)').bind(`${id}-${i}`,id,scope,accountId,chunk,id)));
 await env.DB.batch(statements);
}
export async function seedResources(env){for(const r of resources)await addSource(env,{id:'seed-'+r.id,scope:'shared',title:r.title,url:r.url,body:r.text});}
export async function archiveMessages(env,id,messages){
 if(!retrievalReady(env)||!id.startsWith('clerk:'))return;
 const settings=await memorySettings(env,id);
 for(const m of messages.filter(m=>m.role==='user'&&Date.parse(m.createdAt||now())>=settings.last_sync_at&&m.content?.length>=20&&!/^(?:(?:turn|switch) (?:my )?memory (?:on|off)|show (?:my memories|shared resources)|publish shared resource|forget memory \d+|(?:yes,? )?clear (?:all )?(?:my )?memor(?:y|ies))[.!]?$/i.test(m.content))){
  const key='m-'+(await digest(id+'|'+m.id)).slice(0,48);
  await addSource(env,{id:key,scope:'personal',accountId:id,title:`User statement (${m.createdAt||now()})`,body:m.content,observedAt:m.createdAt});
 }
}
export async function backfillMemory(env,id,state){
 if(!retrievalReady(env)||!id.startsWith('clerk:'))return;
 const settings=await memorySettings(env,id);if(settings.backfilled)return;
 await archiveMessages(env,id,state.messages);
 await env.DB.prepare('INSERT INTO memory_settings(account_id,enabled,backfilled) VALUES(?,1,1) ON CONFLICT(account_id) DO UPDATE SET backfilled=1').bind(id).run();
}
export async function setMemory(env,id,enabled){if(!enabled)throw new AppError('Personal memory is always on for signed-in users.',409);return {enabled:true};}
export async function listMemory(env,id,all=false){const rows=await env.DB.prepare("SELECT id,title,body,created_at FROM retrieval_sources WHERE scope='personal' AND account_id=? AND deleted_at IS NULL ORDER BY created_at DESC"+(all?"":" LIMIT 100")).bind(id).all();return {enabled:!!(await memorySettings(env,id)).enabled,memories:rows.results};}
export async function forgetMemory(env,id,sourceId=null){
 // Tombstones take effect at hydration time, before Vectorize's asynchronous removal.
 const condition=sourceId?' AND id=?':'';const params=sourceId?[now(),id,sourceId]:[now(),id];
 await env.DB.prepare("UPDATE retrieval_sources SET deleted_at=?,body='' WHERE scope='personal' AND account_id=? AND deleted_at IS NULL"+condition).bind(...params).run();
 await env.DB.prepare("UPDATE retrieval_chunks SET deleted_at=?,body='',next_attempt_at=0 WHERE account_id=? AND source_id IN (SELECT id FROM retrieval_sources WHERE account_id=? AND deleted_at IS NOT NULL)").bind(now(),id,id).run();
 // Prevent an automatic backfill from recreating memories after clear-all.
 if(!sourceId)await env.DB.prepare('INSERT INTO memory_settings(account_id,enabled,backfilled,last_sync_at) VALUES(?,1,1,?) ON CONFLICT(account_id) DO UPDATE SET backfilled=1,last_sync_at=excluded.last_sync_at').bind(id,Date.now()).run();
}
export async function addResource(env,id,data){
 if(!await resourceAdmin(env,id))throw new AppError('Only a resource administrator can publish shared resources.',403);
 const clean=resourceInput(data);
 const sourceId='r-'+crypto.randomUUID();await addSource(env,{id:sourceId,scope:'shared',title:clean.title,url:clean.url,body:clean.text});return {id:sourceId,pendingIndex:true};
}
async function embed(env,text){const r=await env.AI.run(EMBEDDING_MODEL,{text:[text]});const v=r.data?.[0];if(!Array.isArray(v)||v.length!==768||v.some(n=>!Number.isFinite(n)))throw Error('Invalid embedding response');return v;}
const validVector=v=>Array.isArray(v)&&v.length===768&&v.every(n=>Number.isFinite(n));
async function embedMany(env,texts){const r=await env.AI.run(EMBEDDING_MODEL,{text:texts});if(!Array.isArray(r.data)||r.data.length!==texts.length||!r.data.every(validVector))throw Error('Invalid embedding response');return r.data;}
// Indexes pending chunks. New chunks are embedded and stored together, so a whole book is indexed in
// minutes; if a group fails, each chunk is retried on its own so one bad chunk cannot hold back the rest.
// Returns how many jobs were claimed, so a caller can keep going while there is work.
export async function processIndexJobs(env,max=4){
 if(!retrievalReady(env))return 0;
 const jobs=(await env.DB.prepare('SELECT * FROM retrieval_chunks WHERE NOT EXISTS(SELECT 1 FROM resource_publication WHERE source_id=retrieval_chunks.source_id AND status!=\'published\') AND (indexed_at IS NULL OR deleted_at IS NOT NULL) AND next_attempt_at<=? AND lease_until<? ORDER BY next_attempt_at, id LIMIT ?').bind(Date.now(),Date.now(),max).all()).results;
 if(!jobs.length)return 0;
 const lease=Date.now()+60000+Math.floor(Math.random()*1000),ids=JSON.stringify(jobs.map(j=>j.id));
 await env.DB.prepare('UPDATE retrieval_chunks SET lease_until=? WHERE id IN (SELECT value FROM json_each(?)) AND lease_until<?').bind(lease,ids,Date.now()).run();
 const claimed=(await env.DB.prepare('SELECT * FROM retrieval_chunks WHERE lease_until=? AND id IN (SELECT value FROM json_each(?)) ORDER BY next_attempt_at, id').bind(lease,ids).all()).results;
 const retry=async job=>{await env.DB.prepare('UPDATE retrieval_chunks SET attempts=attempts+1,next_attempt_at=?,lease_until=0 WHERE id=?').bind(Date.now()+Math.min(3600000,30000*2**Math.min(job.attempts,7)),job.id).run();console.warn(JSON.stringify({event:'retrieval_index_retry',scope:job.scope}));};
 const indexOf=job=>job.scope==='personal'?env.PERSONAL_MEMORY:env.SHARED_RESOURCES;
 const namespaceOf=async job=>job.scope==='personal'?await ownerNamespace(job.account_id):'shared';
 const one=async job=>{try{const values=await embed(env,job.body);await indexOf(job).upsert([{id:job.id,values,namespace:await namespaceOf(job)}]);await env.DB.prepare('UPDATE retrieval_chunks SET indexed_at=?,lease_until=0 WHERE id=? AND deleted_at IS NULL').bind(now(),job.id).run();}catch{await retry(job);}};
 for(const job of claimed.filter(j=>j.deleted_at)){try{await indexOf(job).deleteByIds([job.id]);await env.DB.prepare('DELETE FROM retrieval_chunks WHERE id=? AND deleted_at IS NOT NULL').bind(job.id).run();}catch{await retry(job);}}
 for(const scope of ['personal','shared']){
  const group=claimed.filter(j=>!j.deleted_at&&j.scope===scope);if(!group.length)continue;
  if(group.length===1){await one(group[0]);continue;}
  try{
   const vectors=await embedMany(env,group.map(j=>j.body)),rows=[];for(const [i,job] of group.entries())rows.push({id:job.id,values:vectors[i],namespace:await namespaceOf(job)});
   await indexOf(group[0]).upsert(rows);
   await env.DB.prepare('UPDATE retrieval_chunks SET indexed_at=?,lease_until=0 WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL').bind(now(),JSON.stringify(group.map(j=>j.id))).run();
  }catch{for(const job of group)await one(job);}
 }
 return claimed.length;
}
export async function publishedFallback(env,text){
 const found=[];for(const source of retrieve(text)){const row=await env.DB.prepare("SELECT status FROM resource_publication WHERE source_id=?").bind('seed-'+source.id).first();if(!row||row.status==='published')found.push(source);}return found;
}
// A matched 500-character chunk is rarely a whole thought. Each match is widened with the chunks
// before and after it, and matches that touch are merged, so the assistant reads full passages.
export async function widenPassages(env,sources,maxPassages=6){
 const groups=new Map();
 for(const source of sources){const parts=String(source.chunkId||'').match(/^(.*)-(\d+)$/);if(!parts){groups.set(Symbol(),{source,indexes:null});continue;}const group=groups.get(source.id)||{source,indexes:new Map()};group.indexes.set(Number(parts[2]),source.score);if(source.score>group.source.score)group.source=source;groups.set(source.id,group);}
 const passages=[];
 for(const {source,indexes} of groups.values()){
  if(!indexes){passages.push(source);continue;}
  const wanted=new Set();for(const index of indexes.keys())for(const near of [index-1,index,index+1])if(near>=0)wanted.add(near);
  const ids=[...wanted].sort((a,b)=>a-b),rows=new Map();
  for(let i=0;i<ids.length;i+=50){const slice=ids.slice(i,i+50);const found=await env.DB.prepare(`SELECT id,body FROM retrieval_chunks WHERE deleted_at IS NULL AND id IN (${slice.map(()=>'?').join(',')})`).bind(...slice.map(n=>`${source.id}-${n}`)).all();for(const row of found.results)rows.set(Number(row.id.slice(source.id.length+1)),row.body);}
  let run=[];const flush=()=>{if(!run.length)return;const score=Math.max(...run.map(n=>indexes.get(n)||0));const {chunkId,...rest}=source;passages.push({...rest,body:run.map(n=>rows.get(n)).join(' '),score});run=[];};
  for(const n of ids){if(!rows.has(n))continue;if(run.length&&n!==run.at(-1)+1)flush();run.push(n);if(run.length>=6)flush();}
  flush();
 }
 return passages.sort((a,b)=>b.score-a.score).slice(0,maxPassages).map(({chunkId,...rest})=>rest);
}
export async function retrieveContext(env,id,text){
 if(!retrievalReady(env))return {memories:[],sources:[]};
 const settings=id.startsWith('clerk:')?await memorySettings(env,id):{enabled:0};
 const row=await env.DB.prepare("SELECT value_json FROM system_settings WHERE id='general'").first();const threshold=row?JSON.parse(row.value_json).retrievalThreshold:0.65;
 const fallback=await publishedFallback(env,text);let vector;try{vector=await embed(env,text.slice(0,2000));}catch{return {memories:[],sources:fallback.map(s=>({...s,body:s.text}))};}
 const searches=await Promise.allSettled([settings.enabled?env.PERSONAL_MEMORY.query(vector,{namespace:await ownerNamespace(id),topK:5,returnMetadata:'none'}):Promise.resolve({matches:[]}),env.SHARED_RESOURCES.query(vector,{namespace:'shared',topK:8,returnMetadata:'none'})]);
 const result={memories:[],sources:[]};
 for(let i=0;i<searches.length;i++){
  if(searches[i].status!=='fulfilled')continue;
  for(const match of searches[i].value.matches||[]){
   if(match.score<threshold)continue;
   const row=await env.DB.prepare('SELECT c.body,s.id,s.title,s.url,s.created_at,m.kind,m.text_kind,m.upload_id FROM retrieval_chunks c JOIN retrieval_sources s ON s.id=c.source_id LEFT JOIN resource_materials m ON m.source_id=s.id WHERE c.id=? AND c.scope=? AND (?=\'shared\' OR c.account_id=?) AND c.deleted_at IS NULL AND s.deleted_at IS NULL AND (c.scope=\'personal\' OR NOT EXISTS(SELECT 1 FROM resource_publication WHERE source_id=s.id AND status!=\'published\'))').bind(match.id,i?'shared':'personal',i?'shared':'personal',id).first();
   if(row)result[i?'sources':'memories'].push({...row,score:match.score,...(i?{chunkId:match.id}:{})});
  }
 }
 result.sources=await widenPassages(env,result.sources);
 for(const source of fallback)if(!result.sources.some(s=>s.url===source.url))result.sources.push({...source,body:source.text});
 return result;
}
export async function memoryChat(env,id,text,state = {}){
 if(!retrievalReady(env)||!id.startsWith('clerk:'))return null;
 if(/^show shared resources[.!]?$/i.test(text)){const rows=(await env.DB.prepare("SELECT title,url FROM retrieval_sources WHERE scope='shared' AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM resource_publication WHERE source_id=retrieval_sources.id AND status!='published') ORDER BY created_at DESC LIMIT 20").all()).results;return message('assistant',rows.length?'Here are the shared educational resources available to search.':'No shared resources have been published yet.',{sources:rows,options:await resourceAdmin(env,id)?['Add shared resource']:[]});}
 if(/^add shared resource[.!]?$/i.test(text)){if(!await resourceAdmin(env,id))return message('assistant','Only a resource administrator can publish material for everyone.');state.draft={kind:'sharedResource',stage:'title'};return message('assistant','What is the resource title?',{options:['Cancel']});}
 if(state.draft?.kind==='sharedResource'&&!/^cancel$/i.test(text)){
  if(!await resourceAdmin(env,id))throw new AppError('Administrator access required.',403);
  const d=state.draft;
  if(d.stage==='title'){if(text.length>200)return message('assistant','Use a title up to 200 characters.');d.title=text;d.stage='url';return message('assistant','What is the original HTTPS source link?',{options:['Cancel']});}
  if(d.stage==='url'){try{const u=new URL(text);if(u.protocol!=='https:'||u.username||u.password)throw Error();d.url=u.href;}catch{return message('assistant','Please provide an HTTPS source link.');}d.stage='text';return message('assistant','Paste the resource excerpt or summary you want everyone to be able to retrieve. Please use material you can share.',{options:['Cancel']});}
  if(d.stage==='text'){if(text.length<30)return message('assistant','Please provide at least 30 characters of resource text.');d.text=text;d.stage='review';return message('assistant',`Publish this resource for all users?\n${d.title}\n${d.url}\n\n${d.text}`,{options:['Publish shared resource','Cancel']});}
  if(d.stage==='review'&&/^publish shared resource[.!]?$/i.test(text)){await addResource(env,id,d);state.draft=null;return message('assistant','The resource is saved. Semantic search will include it after indexing completes.',{options:['Show shared resources']});}
  return message('assistant','Publish the resource, or cancel?',{options:['Publish shared resource','Cancel']});
 }
 if(/^forget memory \d+[.!]?$/i.test(text)&&state.draft?.kind==='memoryList'){const n=Number(text.match(/\d+/)[0]);const key=state.draft.ids[n-1];if(!key)return message('assistant','Choose a memory from the displayed list.');await forgetMemory(env,id,key);state.draft=null;return message('assistant','That saved memory was removed. Its original chat message and care records are unchanged.',{options:['Show my memories']});}

 if(/^(?:show|list|what (?:do you|does the app) remember).*memor|^what do you remember about me\??$/i.test(text)){await backfillMemory(env,id,state);const data=await listMemory(env,id);const shown=data.memories.slice(0,8);state.draft={kind:'memoryList',ids:shown.map(m=>m.id)};return message('assistant',shown.length?shown.map((m,i)=>`${i+1}. ${m.body}`).join('\n\n'):'You do not have saved personal memories yet.',{options:[...shown.map((_,i)=>`Forget memory ${i+1}`),'Clear my memories']});}
 if(/^(?:turn|switch) (?:my )?memory (on|off)[.!]?$/i.test(text))return message('assistant','Personal memory is automatic and always on for your account. You can ask me to correct or forget a specific remembered statement.');
 if(/^clear (?:all )?(?:my )?memor(?:y|ies)[.!]?$/i.test(text))return message('assistant','Clear the saved personal memories? This does not delete your original care records or chat history. Say “Yes, clear my memories” to confirm.',{options:['Yes, clear my memories','Cancel']});
 if(/^yes,? clear (?:all )?(?:my )?memor(?:y|ies)[.!]?$/i.test(text)){await forgetMemory(env,id);return message('assistant','Your saved personal memories were cleared. Original care records and chat history are unchanged. New messages can create new memories while memory is on.',{options:['Show my memories']});}
 return null;
}

// Reconcile saved recent messages after an interrupted request. Rotate accounts so
// one busy account cannot prevent others from being repaired by the minute cron.
export async function syncMemoryAccounts(env,max=4){
 if(!retrievalReady(env))return;
 const rows=await env.DB.prepare("SELECT a.id,a.state,a.updated_at FROM accounts a LEFT JOIN memory_settings m ON m.account_id=a.id WHERE a.id LIKE 'clerk:%' AND CAST(unixepoch(a.updated_at,'subsec')*1000 AS INTEGER)>COALESCE(m.last_sync_at,0) ORDER BY COALESCE(m.last_sync_at,0) LIMIT ?").bind(max).all();
 for(const row of rows.results){await archiveMessages(env,row.id,JSON.parse(row.state).messages);await env.DB.prepare('INSERT INTO memory_settings(account_id,enabled,backfilled,last_sync_at) VALUES(?,1,1,?) ON CONFLICT(account_id) DO UPDATE SET backfilled=1,last_sync_at=MAX(memory_settings.last_sync_at,excluded.last_sync_at)').bind(row.id,Date.parse(row.updated_at)).run();}
}

export function resourceInput(data,maxText=120000){
 if(!data||typeof data.title!=='string'||!data.title.trim()||data.title.length>200||typeof data.text!=='string'||data.text.trim().length<30||data.text.length>maxText)throw new AppError(`Provide a title and resource text between 30 and ${maxText.toLocaleString('en-US')} characters.`);
 let url;try{url=new URL(data.url);if(url.protocol!=='https:'||url.username||url.password)throw Error();}catch{throw new AppError('Provide an HTTPS source URL.');}
 return {title:data.title.trim(),url:url.href,text:data.text.trim()};
}
