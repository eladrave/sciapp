import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { initialState } from '../worker/domain.js';

test('personal API persists reviewed medicines separately, logs doses once and configures explicit reminders',async()=>{
 const mf=new Miniflare({workers:[{config:{name:'sciapp',compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],env:{DEBUG:{type:'text',value:'true'},DB:{type:'d1',id:'DB'},PHOTOS:{type:'r2',name:'PHOTOS'}},manifest:{mainModule:'worker.js',modulesRoot:process.cwd(),modules:{'worker.js':{type:'esm',contents:await readFile('dist/worker.js','utf8')}}}}}]});
 try{
  const db=await mf.getD1Database('DB');for(const name of ['0001_initial.sql','0002_notifications.sql','0003_account_identities.sql','0004_retrieval.sql','0005_admin.sql','0006_resource_files.sql','0007_resource_transcription.sql','0008_health_systems.sql','0009_ai_configuration.sql'])await db.exec((await readFile(`migrations/${name}`,'utf8')).replace(/\n/g,' '));
  // Test-only session seeds an authenticated account identity without contacting Clerk.
  for(const label of ['a','b']){
   await db.prepare('INSERT INTO accounts VALUES (?,?,0,?)').bind(`clerk:test-${label}`,JSON.stringify(initialState({real:true})),new Date().toISOString()).run();
   const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(label))).toString('hex');
   await db.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(digest,`clerk:test-${label}`,Date.now()+600000).run();
  }
  const req=async(path,method='GET',data,label='a')=>mf.dispatchFetch('https://sciapp.test'+path,{method,headers:{cookie:`__Host-sciapp=${label}`,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const chat=async text=>{const r=await req('/api/chat','POST',{message:text});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;};
  const approve=async result=>{const r=await req(`/api/actions/${result.reply.proposal.id}`,'POST',{decision:'approve'});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;};
  // This account asks before saving, which keeps the review flow below; the default saves at once (checked at the end).
  assert.equal((await req('/api/preferences','POST',{askBeforeSaving:'yes'})).status,400);
  assert.equal((await(await req('/api/preferences','POST',{askBeforeSaving:true})).json()).state.settings.askBeforeSaving,true);
  let state=await(await req('/api/state')).json();assert.equal(state.mode,'personal');assert.equal(state.inventory[0].count,null);assert.equal(state.medications.length,0);
  const imported=await chat('Current Medications\n• Sample Alpha 2 mg, twice daily\n• Sample Beta 5 mg, at bedtime as needed\nAllergies\n• Sample allergen');assert.equal(imported.state.medications.length,0);
  state=(await approve(imported)).state;assert.equal(state.medications.length,2);assert.deepEqual(state.allergies,['Sample allergen']);
  assert.equal((await(await req('/api/state','GET',null,'b')).json()).medications.length,0);
  state=(await approve(await chat('Remind me to take Sample Alpha at 08:00 and 20:00'))).state;
  assert.deepEqual(state.medications[0].times,['08:00','20:00']);assert.ok(state.reminderTasks.length);
  await approve(await chat('I have 40 Sample Alpha tablets'));
  await approve(await chat('Use 1 tablet per dose for Sample Alpha'));
  const pendingDose=await chat('I took Sample Alpha');
  const clarification=await chat('No, This was just my schedule, so you can keep track of it, and remind me');
  assert.match(clarification.reply.content,/What times/);assert.equal(clarification.state.medications[0].stock,40);assert.ok(Array.isArray(clarification.state.reminderTasks));
  assert.equal(clarification.state.messages.find(m=>m.proposal?.id===pendingDose.reply.proposal.id).proposal.status,'cancelled');
  await approve(await chat('08:00 and 20:00'));
  const dose=await chat('I took Sample Alpha');state=(await approve(dose)).state;assert.equal(state.medications[0].stock,39);
  const repeat=await approve(dose);assert.equal(repeat.state.medications[0].stock,39);
  await approve(await chat('I have 100 catheters'));
  await approve(await chat('I catheterized 250 mL'));
  assert.equal((await(await req('/api/state')).json()).inventory[0].count,99);
  await approve(await chat('Set catheter reminders every 4 hours'));
  state=await(await req('/api/state')).json();assert.equal(state.settings.catheterRemindersEnabled,true);assert.ok(state.reminderTasks.some(t=>t.kind==='catheterization'));
  assert.equal((await req('/api/push/subscriptions','POST',{subscription:{endpoint:'https://evil.test'}})).status,503);
  assert.equal((await req('/api/account/export')).status,200);
  // Saving without asking: the record and stock change at once, and one Undo call reverses both.
  await req('/api/preferences','POST',{askBeforeSaving:false});
  const saved=await chat('I catheterized 300 mL');
  assert.equal(saved.reply.proposal.status,'approved');assert.equal(saved.reply.proposal.autoSaved,true);assert.equal(saved.reply.proposal.undoable,true);
  assert.equal(saved.state.inventory[0].count,98);assert.match(saved.reply.content,/^Saved\..*Choose Undo if this is wrong\.$/);
  assert.equal(saved.state.messages.at(-1).proposal.autoSaved,true);
  const undone=await(await req(`/api/actions/${saved.reply.proposal.id}/undo`,'POST',{})).json();
  assert.equal(undone.state.inventory[0].count,99);assert.equal(undone.state.messages.find(m=>m.proposal?.id===saved.reply.proposal.id).proposal.undone,true);
  assert.equal((await req(`/api/actions/${saved.reply.proposal.id}/undo`,'POST',{},'b')).status,404);
  // One-tap records and the spoken AD steps do not need the AI model.
  const drink=await(await req('/api/quick-record','POST',{kind:'careLog',params:{type:'fluid',volume:250,time:'2020-01-01T00:00:00Z'}})).json();
  assert.equal(drink.reply.proposal.autoSaved,true);assert.equal(drink.state.insights.today.fluidMl,250);assert.ok(Date.parse(drink.state.events[0].occurredAt)>Date.now()-60000);
  assert.equal((await req('/api/quick-record','POST',{kind:'carePlan',params:{}})).status,400);assert.equal((await req('/api/quick-record','POST',{kind:'careLog',params:{type:'fluid'}})).status,400);
  const bp=await(await req('/api/quick-record','POST',{kind:'vitals',params:{systolic:160,diastolic:95}})).json();assert.equal(bp.reply.proposal.autoSaved,true);
  const ad=await(await req('/api/ad-help','POST',{})).json();assert.equal(ad.reply.adHelp,true);assert.match(ad.state.messages.at(-1).content,/1\. Sit up straight/);
 }finally{await mf.dispose();}
});
