import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { initialState, finishProposal } from '../worker/domain.js';
import { configureClient, startConnection, completeConnection, listConnections, syncConnection, listRecords, record, prepareReview, confirmReview, healthTool, seal, unseal, processHealthJobs, queueSync } from '../worker/health-systems.js';
import { publicURL, discover, refreshDirectory, catalog } from '../worker/health-providers.js';
import { interpret } from '../worker/conversation.js';
const owner='clerk:health-test-a',other='clerk:health-test-b',key=Buffer.alloc(32,7).toString('base64url');
async function setup(fn){
 const source=await readFile('dist/worker.js','utf8');
 const mf=new Miniflare({workers:[{config:{name:'sciapp',compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],env:{DB:{type:'d1',id:'DB'},PHOTOS:{type:'r2',name:'PHOTOS'},HEALTH_TOKEN_KEY:{type:'text',value:key},APP_ORIGIN:{type:'text',value:'https://sciapp.test'}},manifest:{mainModule:'worker.js',modulesRoot:process.cwd(),modules:{'worker.js':{type:'esm',contents:source}}}}}]});
 try{const db=await mf.getD1Database('DB');for(const n of ['0001_initial','0002_notifications','0003_account_identities','0004_retrieval','0005_admin','0006_resource_files','0007_resource_transcription','0008_health_systems'])await db.exec((await readFile('migrations/'+n+'.sql','utf8')).replace(/\n/g,' '));
 for(const [id,cookie] of [[owner,'a'],[other,'b']]){await db.prepare('INSERT INTO accounts VALUES(?,?,0,?)').bind(id,JSON.stringify(initialState({real:true})),new Date().toISOString()).run();const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cookie))).toString('hex');await db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(digest,id,Date.now()+600000).run();}
 const env={DB:db,HEALTH_TOKEN_KEY:key,APP_ORIGIN:'https://sciapp.test'};
 for(const [id,name] of [['fixture','Fixture Hospital'],['fixture2','Second Hospital']])await db.prepare('INSERT INTO health_providers VALUES(?,?,?,?,?,?)').bind(id,name,'epic-sandbox','https://records.example.com/r4','https://open.epic.com/MyApps/Endpoints',Date.now()).run();
 await configureClient(env,'epic-sandbox',{clientId:'synthetic-client'});
 await fn({mf,db,env});}finally{await mf.dispose();}
}
const metadata={authorization_endpoint:'https://records.example.com/authorize',token_endpoint:'https://records.example.com/token',code_challenge_methods_supported:['S256'],capabilities:['permission-v2','permission-offline'],token_endpoint_auth_methods_supported:['client_secret_basic']};
const json=d=>Response.json(d);
function mock(patient='patient-a'){return async(url,options={})=>{const u=new URL(url);if(u.pathname.endsWith('smart-configuration'))return json(metadata);if(u.pathname==='/token')return json({access_token:'synthetic-private-access',refresh_token:'synthetic-refresh',token_type:'Bearer',patient,expires_in:3600,scope:'patient/Observation.rs'});assert.equal(options.headers.Authorization,'Bearer synthetic-private-access');if(u.pathname.includes('/Patient/'))return json({resourceType:'Patient',id:patient});const type=u.pathname.split('/').at(-1);const r={resourceType:type,id:'resource-a',subject:{reference:'Patient/'+patient},status:'active',code:{text:'Synthetic '+type},meta:{lastUpdated:'2026-11-01T12:00:00Z'}};if(type==='MedicationRequest')Object.assign(r,{medicationCodeableConcept:{text:'Synthetic medicine'},dosageInstruction:[{text:'One tablet daily as prescribed'}]});return json({resourceType:'Bundle',entry:[{resource:r}]});};}
async function authorize(env,p='fixture',fetcher=mock(),id=owner){const start=await startConnection(env,id,p,fetcher);const state=new URL(start.authorizationUrl).searchParams.get('state');const request=new Request('https://sciapp.test/api/health-systems/callback?state='+state+'&code=synthetic-code',{headers:{cookie:start.cookie.split(';')[0]}});const complete=await completeConnection(env,request,fetcher);return {start,request,...complete};}
test('health OAuth uses PKCE, browser-bound single-use state and encrypted owner-bound tokens; multiple systems remain isolated',async()=>setup(async({env,db,mf})=>{
 assert.equal((await catalog(env,'Jackson Health in Miami'))[0].id,'jackson-miami');
 const start=await startConnection(env,owner,'fixture',mock());const u=new URL(start.authorizationUrl);assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.match(u.searchParams.get('scope'),/patient\/MedicationRequest.rs/);assert.equal(u.searchParams.get('scope').includes('offline_access'),false);
 const callback='https://sciapp.test/api/health-systems/callback?state='+u.searchParams.get('state')+'&code=test';await assert.rejects(completeConnection(env,new Request(callback),mock()),/another browser/);
 const request=new Request(callback,{headers:{cookie:start.cookie.split(';')[0]}});const done=await completeConnection(env,request,mock());assert.ok(done.connectionId);
 await assert.rejects(completeConnection(env,request,mock()),/another browser/);
 const raw=await db.prepare('SELECT * FROM health_connections WHERE id=?').bind(done.connectionId).first();assert.equal(raw.token_cipher.includes('synthetic-private-access'),false);assert.equal(JSON.stringify(await listConnections(env,owner)).includes('token_cipher'),false);
 await assert.rejects(unseal(env,raw.token_cipher,other+':'+raw.id));
 await authorize(env,'fixture2');assert.equal((await listConnections(env,owner)).length,2);assert.equal((await listConnections(env,other)).length,0);
 const response=await mf.dispatchFetch('https://sciapp.test/api/health-systems/connections',{headers:{cookie:'__Host-sciapp=a'}});assert.equal(response.status,200);assert.equal((await response.json()).connections.length,2);
 assert.equal((await mf.dispatchFetch('https://sciapp.test/api/health-systems/callback?state=bad')).status,400);
 assert.equal((await mf.dispatchFetch('https://sciapp.test/api/health-systems/connections')).status,401);
}));
test('health imports are idempotent, source-linked, review-only and never populate care schedules or stock',async()=>setup(async({env,db})=>{
 const {connectionId}=await authorize(env);await syncConnection(env,owner,connectionId,mock());await syncConnection(env,owner,connectionId,mock());const records=await listRecords(env,owner);assert.equal(records.length,7);assert.equal((await listRecords(env,other)).length,0);await assert.rejects(record(env,other,records[0].id),/not found/);
 const s=JSON.parse((await db.prepare('SELECT state FROM accounts WHERE id=?').bind(owner).first()).state);assert.equal(s.medications.length,0);assert.equal(s.events.length,0);assert.equal(s.inventory[0].count,null);
 const med=records.find(r=>r.resource_type==='MedicationRequest');const review=await healthTool(env,owner,s,'Add this imported medication',{name:'prepare_imported_medication',arguments:{recordId:med.id}});assert.equal(s.medications.length,0);assert.equal(review.proposal.kind,'carePlan');finishProposal(s,review.proposal.id,'approve');assert.equal(s.medications.length,1);assert.deepEqual(s.medications[0].times,[]);assert.equal(s.medications[0].stock,null);assert.equal(s.events[0].data.sourceRecordId,med.id);
 const duplicate=await healthTool(env,owner,s,'Add this imported medication',{name:'prepare_imported_medication',arguments:{recordId:med.id}});assert.equal(duplicate.proposal,undefined);assert.match(duplicate.content,/already in your care plan/);
}));
test('health imports reject unsafe pagination and wrong-patient resources without forwarding authorization elsewhere',async()=>setup(async({env})=>{
 const {connectionId}=await authorize(env);let leaked=false;const fetcher=async(url,o)=>{if(new URL(url).hostname!=='records.example.com'){leaked=true;throw Error('leak');}if(url.includes('/Patient/'))return mock()(url,o);return json({resourceType:'Bundle',entry:[{resource:{resourceType:new URL(url).pathname.split('/').at(-1),id:'wrong',subject:{reference:'Patient/other-patient'}}}],link:[{relation:'next',url:'https://evil.example.net/steal'}]});};
 const result=await syncConnection(env,owner,connectionId,fetcher);assert.equal(leaked,false);assert.equal(result.warnings.length,7);assert.equal((await listRecords(env,owner)).length,0);
 let requests=0;await syncConnection(env,owner,connectionId,async(url,o)=>{requests++;if(url.includes('/Patient/'))return mock()(url,o);return json({resourceType:'Bundle',entry:[],link:[{relation:'next',url:'https://evil.example.net/steal'}]});});assert.equal(requests,8);
}));
test('disconnect blocks in-flight writes, removes credentials, stops jobs; deleting copies stops background sync',async()=>setup(async({env,db})=>{
 const {connectionId}=await authorize(env);await syncConnection(env,owner,connectionId,mock());assert.equal((await listRecords(env,owner)).length,7);
 const d=await prepareReview(env,owner,connectionId,'disconnect');await assert.rejects(confirmReview(env,other,d.id,'approve'),/expired/);await confirmReview(env,owner,d.id,'approve');const row=await db.prepare('SELECT * FROM health_connections WHERE id=?').bind(connectionId).first();assert.equal(row.token_cipher,null);assert.equal(row.auto_sync,0);assert.equal(row.status,'disconnected');assert.equal((await listRecords(env,owner)).length,7);await assert.rejects(queueSync(env,owner,connectionId),/Reconnect/);
 await authorize(env);const del=await prepareReview(env,owner,connectionId,'delete_records');await confirmReview(env,owner,del.id,'approve');assert.equal((await listRecords(env,owner)).length,0);let revoked=false;
 await assert.rejects(syncConnection(env,owner,connectionId,async(url,o)=>{const response=await mock()(url,o);if(!revoked&&!url.includes('/Patient/')){revoked=true;const review=await prepareReview(env,owner,connectionId,'disconnect');await confirmReview(env,owner,review.id,'approve');}return response;}),/changed/);assert.equal((await listRecords(env,owner)).length,0);
}));
test('health jobs expose completion and fail expired authorization without recording fabricated data',async()=>setup(async({env,db})=>{
 const {connectionId}=await authorize(env);const job=await queueSync(env,owner,connectionId);assert.equal(await queueSync(env,owner,connectionId),job);await processHealthJobs(env,mock());assert.equal((await db.prepare('SELECT status FROM health_jobs WHERE id=?').bind(job).first()).status,'completed');await db.prepare('UPDATE health_connections SET expires_at=0 WHERE id=?').bind(connectionId).run();await queueSync(env,owner,connectionId);await processHealthJobs(env,async()=>new Response('',{status:401}));assert.equal((await listConnections(env,owner))[0].status,'reauthorization_required');
}));
test('health provider discovery and client setup reject insecure hosts and expose no client secrets',async()=>setup(async({env})=>{
 for(const url of ['http://records.example.com','https://127.0.0.1/r4','https://[::1]/r4','https://name:pass@records.example.com','https://api.internal/r4'])assert.throws(()=>publicURL(url));
 await assert.rejects(discover({issuer:'https://records.example.com/r4',vendor:'epic'},async()=>json({...metadata,token_endpoint:'https://evil.example.net/token'})),/unexpected/);
 await configureClient(env,'epic-sandbox',{clientId:'confidential',authMethod:'client_secret_basic',clientSecret:'synthetic-secret'});const {start}=await authorize(env);assert.match(new URL(start.authorizationUrl).searchParams.get('scope'),/offline_access/);
 await assert.rejects(startConnection(env,owner,'jackson-miami',mock()),/registration/);
 const sealed=await seal(env,{access_token:'hidden'},owner);assert.deepEqual(await unseal(env,sealed,owner),{access_token:'hidden'});
}));
test('official Epic directory ingestion supports brands, caches locally and rejects private hosts',async()=>setup(async({env})=>{
 const data={entry:[{resource:{resourceType:'Organization',id:'brand',name:'Synthetic Regional Hospital',endpoint:[{reference:'Endpoint/one'},{reference:'Endpoint/bad'}]}},{resource:{resourceType:'Endpoint',id:'one',status:'active',address:'https://records.example.org/api/FHIR/R4/'}},{resource:{resourceType:'Endpoint',id:'bad',address:'https://127.0.0.1/api/FHIR/R4/'}}]};let calls=0;assert.equal(await refreshDirectory(env,async()=>{calls++;return json(data);},true),1);await refreshDirectory(env,async()=>{calls++;return json(data);});assert.equal(calls,1);
}));
test('model receives health tools, grounded connection context and imported records as untrusted evidence',async()=>{
 let captured;const s=initialState({real:true});s.messages.push({role:'assistant',content:'Choose a system',healthSystems:[{id:'jackson-miami',name:'Jackson'}]});const reply=await interpret({AI:{run:async(_,payload)=>{captured=payload;return {tool_calls:[{name:'connect_health_system',arguments:{providerId:'jackson-miami'}}]};}}},s,'Connect Jackson',{health:{available:true,connections:[]}});assert.equal(reply.tool.name,'connect_health_system');for(const name of ['sync_health_records','disconnect_health_system','confirm_health_connection_action','list_imported_health_records'])assert.ok(captured.tools.some(t=>t.name===name));assert.match(captured.messages[0].content,/HEALTH CONNECTION CONTEXT/);assert.ok(captured.messages.some(m=>m.content.includes('jackson-miami')));
});
