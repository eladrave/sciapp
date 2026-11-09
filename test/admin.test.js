import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { publishedFallback } from '../worker/retrieval.js';

test('administrator auth, CSRF, resource review workflow, archive retrieval, settings concurrency and audit',async()=>{
 const password='test-'+crypto.randomUUID(),salt=crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const derived=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256);
 const verifier=JSON.stringify({salt:Buffer.from(salt).toString('hex'),hash:Buffer.from(derived).toString('hex'),iterations:100000});
 const mf=new Miniflare({workers:[{config:{name:'sciapp',compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],env:{DB:{type:'d1',id:'DB'},RESOURCES:{type:'r2',name:'RESOURCES'},ADMIN_PASSWORD_HASH:{type:'text',value:verifier}},manifest:{mainModule:'worker.js',modulesRoot:process.cwd(),modules:{'worker.js':{type:'esm',contents:await readFile('dist/worker.js','utf8')}}}}}]});
 try{
 const db=await mf.getD1Database('DB');for(const name of ['0001_initial.sql','0002_notifications.sql','0003_account_identities.sql','0004_retrieval.sql','0005_admin.sql','0006_resource_files.sql','0007_resource_transcription.sql'])await db.exec((await readFile('migrations/'+name,'utf8')).replace(/\n/g,' '));
 let cookie='',csrf='';const req=async(path,method='GET',body,extra={})=>{let payload=body?JSON.stringify(body):undefined;const headers={...(cookie?{cookie}:{}),...(method!=='GET'?{origin:'https://sciapp.test','content-type':'application/json','X-Admin-CSRF':csrf}:{}),...extra};if(body instanceof FormData){const encoded=new Response(body);payload=await encoded.arrayBuffer();headers['content-type']=encoded.headers.get('content-type');}return mf.dispatchFetch('https://sciapp.test'+path,{method,headers,...(payload?{body:payload}:{})});};
 assert.equal((await req('/admin')).status,200);assert.equal((await req('/api/admin/resources')).status,401);
 assert.equal((await req('/api/admin/login','POST',{username:'admin',password},{origin:'https://evil.test'})).status,403);
 assert.equal((await req('/api/admin/login','POST',{username:'admin',password:'wrong'})).status,401);
 assert.equal((await req('/api/admin/login','POST',{username:'not-admin',password})).status,401);
 const login=await req('/api/admin/login','POST',{username:'admin',password});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrfToken;
 assert.equal((await req('/api/state')).status,401);
 assert.equal((await req('/api/admin/settings','PUT',[])).status,400);
 const overview=await(await req('/api/admin/overview')).json();assert.equal(overview.memoryPolicy,'Always on for every signed-in user');assert.equal(overview.appVersion,'0.7.2');
 assert.equal((await req('/api/admin/settings','PUT',{version:0,settings:{retrievalThreshold:0.7,resourceReviewDays:90}},{'X-Admin-CSRF':''})).status,403);
 assert.equal((await req('/api/admin/settings','PUT',{version:0,settings:{retrievalThreshold:0.7,resourceReviewDays:90}})).status,200);
 assert.equal((await req('/api/admin/settings','PUT',{version:0,settings:{retrievalThreshold:0.7,resourceReviewDays:90}})).status,409);
 assert.equal((await req('/api/admin/settings','PUT',{version:1,settings:{retrievalThreshold:0.1,resourceReviewDays:90}})).status,400);
 const input={title:'Synthetic educational resource',url:'https://example.com/guide',text:'An educational excerpt for testing administration. It is not medical advice.'};
 assert.equal((await req('/api/admin/resources','POST',{...input,url:'javascript:alert(1)'})).status,400);
 const created=await req('/api/admin/resources','POST',input);assert.equal(created.status,201);const id=(await created.json()).id;
 assert.equal((await req('/api/admin/resources/'+id,'PUT',{...input,title:'Revised draft',version:0})).status,200);
 assert.equal((await req('/api/admin/resources/'+id,'PUT',{...input,version:0})).status,409);
 assert.equal((await req('/api/admin/resources/'+id+'/publish','POST',{version:1})).status,400);
 assert.equal((await req('/api/admin/resources/'+id+'/publish','POST',{version:1,reviewed:true})).status,200);
 assert.equal((await req('/api/admin/resources/'+id,'PUT',{...input,version:2})).status,409);
 assert.equal((await req('/api/admin/resources/'+id+'/review','POST',{version:2,reviewed:true})).status,200);
 assert.equal((await req('/api/admin/resources/'+id+'/archive','POST',{version:3})).status,200);
 const rows=(await(await req('/api/admin/resources')).json()).resources;assert.equal(rows.find(r=>r.id===id).status,'archived');assert.ok(rows.find(r=>r.id===id).reviewed_at);
 await db.prepare("INSERT INTO retrieval_sources(id,scope,account_id,title,body,created_at) VALUES('private-id','personal','clerk:other','Private','Never show this private text',?)").bind(new Date().toISOString()).run();
 assert.equal((await(await req('/api/admin/resources')).json()).resources.length,1);
 await db.prepare("INSERT INTO resource_publication(source_id,status,updated_at) VALUES('seed-shoulders','archived',?)").bind(new Date().toISOString()).run().catch(async()=>{await db.prepare("INSERT INTO retrieval_sources(id,scope,title,body,created_at) VALUES('seed-shoulders','shared','Seed','Seed summary',?)").bind(new Date().toISOString()).run();await db.prepare("INSERT INTO resource_publication(source_id,status,updated_at) VALUES('seed-shoulders','archived',?)").bind(new Date().toISOString()).run();});
 assert.equal((await publishedFallback({DB:db},'shoulder stretching')).some(r=>r.id==='shoulders'),false);
 const audit=(await(await req('/api/admin/audit')).json()).entries;assert.ok(audit.some(e=>e.action==='resource_publish_attempt'));assert.ok(!JSON.stringify(audit).includes(password));
 const form=new FormData();form.append('file',new File(['A synthetic text resource uploaded for admin API integration testing.'],'upload.txt',{type:'text/plain'}));
 assert.equal((await req('/api/admin/uploads','POST',form,{'X-Admin-CSRF':''})).status,403);
 const uploaded=await req('/api/admin/uploads','POST',form);assert.equal(uploaded.status,201);const file=await uploaded.json();assert.equal(file.extractionStatus,'extracted');assert.equal((await req('/api/admin/uploads/'+file.id)).status,200);
 const doc=await req('/api/admin/resources','POST',{title:'Uploaded document',kind:'document',text:file.text,uploadId:file.id,textKind:'extracted'});assert.equal(doc.status,201);const docId=(await doc.json()).id;
 assert.equal((await req('/api/admin/uploads/'+file.id,'DELETE')).status,409);
 const preview=await req('/api/session','POST',{});cookie+='; '+preview.headers.get('set-cookie').split(';')[0];
 assert.equal((await req('/api/resources/files/'+file.id)).status,404);
 assert.equal((await req('/api/admin/resources/'+docId+'/publish','POST',{version:0,reviewed:true})).status,200);
 const download=await req('/api/resources/files/'+file.id);assert.equal(download.status,200);assert.equal(await download.text(),file.text);
 assert.equal((await req('/api/admin/resources/'+docId+'/archive','POST',{version:1})).status,200);assert.equal((await req('/api/resources/files/'+file.id)).status,404);
 await req('/api/admin/logout','POST',{});assert.equal((await req('/api/admin/resources')).status,401);cookie='';csrf='';
 for(let i=0;i<11;i++){const r=await req('/api/admin/login','POST',{username:'admin',password:'wrong'});if(r.status===429)break;assert.ok(i<10);}
 }finally{await mf.dispose();}
});
