import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';

test('Worker integration: private sessions, approval concurrency, persistence, undo, photo ownership, and CSRF',async()=>{
 const mf=new Miniflare({workers:[{config:{name:'sciapp',compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],env:{DEBUG:{type:'text',value:'true'},DB:{type:'d1',id:'DB'},PHOTOS:{type:'r2',name:'PHOTOS'}},manifest:{mainModule:'worker.js',modulesRoot:process.cwd(),modules:{'worker.js':{type:'esm',contents:await readFile('dist/worker.js','utf8')}}}}}]});
 try{
  const db=await mf.getD1Database('DB');for(const name of ['0001_initial.sql','0002_notifications.sql','0003_account_identities.sql'])await db.exec((await readFile(`migrations/${name}`,'utf8')).replace(/\n/g,' '));
  const req=async(path,method='GET',body,cookie,extra={})=>{ let payload=body, headers={...(cookie?{cookie}:{}),...extra}; if(body instanceof FormData){const encoded=new Response(body);headers['content-type']=encoded.headers.get('content-type');payload=await encoded.arrayBuffer();}else if(body){headers['content-type']='application/json';payload=JSON.stringify(body);} return mf.dispatchFetch(`https://sciapp.test${path}`,{method,headers,...(body?{body:payload}:{})}); };
  assert.equal((await req('/api/state')).status,401);
  assert.match(await(await req('/privacy')).text(),/SCIapp privacy notice/);
  assert.match(await(await req('/terms')).text(),/Using SCIapp/);
  assert.match(await(await req('/')).text(),/href="\/privacy"/);
  let r=await req('/api/session','POST');assert.equal(r.status,200);const a=r.headers.get('set-cookie').split(';')[0];
  r=await req('/api/session','POST');const b=r.headers.get('set-cookie').split(';')[0];assert.notEqual(a,b);
  r=await req('/api/chat','POST',{message:'I catheterized 350 mL'},a);assert.equal(r.status,200);const p=(await r.json()).reply.proposal.id;
  assert.equal((await req(`/api/actions/${p}`,'POST',{decision:'approve'},b)).status,404);
  const approvals=await Promise.all([req(`/api/actions/${p}`,'POST',{decision:'approve'},a),req(`/api/actions/${p}`,'POST',{decision:'approve'},a)]);
  assert.ok(approvals.every(r=>r.status===200));
  let s=await(await req('/api/state','GET',null,a)).json();assert.equal(s.inventory[0].count,59);assert.equal(s.events.length,1);
  r=await req('/api/chat','POST',{message:'I catheterized 450 mL'},a);const review=(await r.json()).reply.proposal;
  r=await req('/api/chat','POST',{message:'Approved.'},a);let confirmed=await r.json();assert.equal(r.status,200);assert.equal(confirmed.state.inventory[0].count,58);assert.equal(confirmed.state.events.length,2);assert.equal(confirmed.state.messages.filter(m=>m.proposal?.id===review.id).at(-1).proposal.status,'approved');assert.equal(confirmed.reply.proposal,undefined);
  r=await req('/api/chat','POST',{message:'approved'},a);confirmed=await r.json();assert.equal(confirmed.state.inventory[0].count,58);assert.equal(confirmed.state.events.length,2);assert.match(confirmed.reply.content,/already saved/);
  const eventId=s.events[0].id;await req(`/api/events/${eventId}/undo`,'POST',null,a);s=await(await req('/api/state','GET',null,a)).json();assert.equal(s.inventory[0].count,59);
  assert.equal((await req('/api/chat','POST',{message:'Log catheterization'},a,{origin:'https://evil.test'})).status,403);
  assert.equal((await req('/api/state','GET',null,b)).status,200);assert.equal((await(await req('/api/state','GET',null,b)).json()).events.length,0);
  const f=new FormData();f.append('photo',new Blob([Uint8Array.from([137,80,78,71,13,10,26,10])],{type:'image/png'}),'label.png');
  r=await req('/api/photos','POST',f,a);assert.equal(r.status,200);const photo=await r.json();
  const journalA=await(await req('/api/journal','POST',{photosOnly:true},a)).json();assert.equal(journalA.entries[0].photoId,photo.id);assert.equal(journalA.entries[0].status,'unreviewed');assert.equal((await(await req('/api/journal','POST',{photosOnly:true},b)).json()).total,0);assert.equal((await req('/api/journal','POST',{limit:1000},a)).status,400);
  assert.equal((await req(photo.url,'GET',null,b)).status,404);assert.equal((await req(photo.url,'GET',null,a)).status,200);
  assert.equal((await req(photo.url,'DELETE',null,a)).status,200);assert.equal((await req(photo.url,'GET',null,a)).status,404);
  // A medication group is scoped to its account and saved atomically once.
  const rawToken=a.slice(a.indexOf('=')+1),tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rawToken))),n=>n.toString(16).padStart(2,'0')).join('');
  const owner=(await db.prepare('SELECT account_id FROM sessions WHERE token_hash=?').bind(tokenHash).first()).account_id;
  const row=await db.prepare('SELECT state FROM accounts WHERE id=?').bind(owner).first(),fixture=JSON.parse(row.state);
  fixture.medications=['Sample A','Sample B'].map((name,i)=>({id:'group-med-'+i,name,dosage:'5 mg',active:true,times:['00:00'],asNeeded:false,stock:5,unit:'tablets',unitsConfigured:true,unitsPerDose:1,createdAt:'1970-01-01T00:00:00Z',scheduleUpdatedAt:'1970-01-01T00:00:00Z'}));
  await db.prepare('UPDATE accounts SET state=?,version=version+1 WHERE id=?').bind(JSON.stringify(fixture),owner).run();
  const before=await(await req('/api/state','GET',null,a)).json(),group=before.agenda.medicationGroups[0];
  const all=await(await req('/api/medication-checkin','POST',{action:'all',groupId:group.id},a)).json();assert.equal(all.reply.medicationCheckIn.stage,'time');
  const timing={action:'time',timing:'scheduled',checkInId:all.reply.medicationCheckIn.id,revision:all.reply.medicationCheckIn.revision};
  assert.equal((await req('/api/medication-checkin','POST',timing,b)).status,409);
  const pending=await(await req('/api/medication-checkin','POST',timing,a)).json();assert.equal(pending.reply.proposal.kind,'medicationBatch');
  assert.equal((await req('/api/medication-checkin','POST',timing,a)).status,409);
  const batch=pending.reply.proposal.id;const saves=await Promise.all([req('/api/actions/'+batch,'POST',{decision:'approve'},a),req('/api/actions/'+batch,'POST',{decision:'approve'},a)]);assert.ok(saves.every(r=>r.status===200));
  const final=await(await req('/api/state','GET',null,a)).json();assert.deepEqual(final.medications.map(m=>m.stock),[4,4]);assert.equal(final.events.filter(e=>e.batchId===batch).length,2);assert.equal(final.agenda.medicationGroups.length,0);

 } finally {await mf.dispose();}
});
