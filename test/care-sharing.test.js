import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { initialState } from '../worker/domain.js';
import { sharedDay } from '../worker/care-sharing.js';

test('a caregiver sees only the day summary: no photos, notes, conversation or settings',()=>{
 const at=Date.parse('2026-11-10T21:00:00Z'),s=initialState({real:true});
 Object.assign(s.settings,{timezone:'America/New_York',catheterRemindersEnabled:true,catheterScheduleMode:'daily',catheterTimes:['07:00','15:00','22:00'],catheterScheduleUpdatedAt:'2026-11-01T00:00:00Z',catheterScheduleId:'x'});
 s.profile.fullName='Sam Synthetic Example';s.messages.push({id:'m',role:'user',content:'PRIVATE CHAT TEXT',createdAt:new Date(at).toISOString()});s.photos.push({id:'photo-secret'});s.allergies=['SECRET ALLERGY'];
 const add=(kind,data,detail,minutes,extra={})=>s.events.unshift({id:crypto.randomUUID(),kind,title:kind==='careLog'?'Skin check':'Record catheterization',detail,createdAt:new Date(at-minutes*60000).toISOString(),occurredAt:new Date(at-minutes*60000).toISOString(),data,...extra});
 add('catheterization',{volume:400,photoId:'photo-secret'},'400 mL',480);add('careLog',{type:'skinCheck',finding:'concern',note:'PRIVATE NOTE left heel'},'Something to keep an eye on · PRIVATE NOTE left heel · Time: 3 PM',60);
 add('journalNote',{note:'PRIVATE JOURNAL',category:'note'},'PRIVATE JOURNAL',30);add('catheterization',{volume:999},'999 mL voided',20,{voided:true});add('catheterization',{volume:111},'yesterday',60*30);
 const day=sharedDay(s,at),text=JSON.stringify(day);
 assert.equal(day.name,'Sam Synthetic Example');assert.deepEqual(day.unconfirmed.map(t=>[t.title,t.time]),[['Catheterization','3:00 PM']]);assert.deepEqual(day.upcoming.map(t=>t.time),['10:00 PM']);
 assert.deepEqual(day.records.map(r=>r.title).sort(),['Record catheterization','Skin check']);assert.equal(day.today.urineMl,400);
 for(const secret of ['PRIVATE','SECRET','photo-secret','999','yesterday','messages','settings','medications'])assert.equal(text.includes(secret),false,secret);
 assert.deepEqual(Object.keys(day).sort(),['localNow','name','records','supplyWarnings','timezone','today','unconfirmed','upcoming']);
});

test('invitation links work once, only for signed-in accounts, and either side can end sharing',async()=>{
 const mf=new Miniflare({workers:[{config:{name:'sciapp',compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],env:{DB:{type:'d1',id:'DB'},PHOTOS:{type:'r2',name:'PHOTOS'}},manifest:{mainModule:'worker.js',modulesRoot:process.cwd(),modules:{'worker.js':{type:'esm',contents:await readFile('dist/worker.js','utf8')}}}}}]});
 try{
  const db=await mf.getD1Database('DB');for(const name of (await readdir('migrations')).sort())await db.exec((await readFile(`migrations/${name}`,'utf8')).replace(/\n/g,' '));
  for(const label of ['a','b','c']){
   const state=initialState({real:true});if(label==='a'){state.profile.fullName='Owner Synthetic';state.messages.push({id:'m',role:'user',content:'PRIVATE CHAT TEXT',createdAt:new Date().toISOString()});}if(label==='b')state.profile.name='Helper';
   await db.prepare('INSERT INTO accounts VALUES (?,?,0,?)').bind(`clerk:test-${label}`,JSON.stringify(state),new Date().toISOString()).run();
   const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(label))).toString('hex');
   await db.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(digest,`clerk:test-${label}`,Date.now()+600000).run();
  }
  const req=async(path,method='GET',data,label='a')=>{const r=await mf.dispatchFetch('https://sciapp.test'+path,{method,headers:{cookie:`__Host-sciapp=${label}`,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};};
  assert.deepEqual((await req('/api/sharing')).body,{available:true,caregivers:[],caringFor:[],openInvites:0});
  const invite=await req('/api/sharing/invites','POST',{});assert.equal(invite.status,201);
  const code=new URL(invite.body.link).searchParams.get('invite');assert.match(code,/^[a-f0-9]{64}$/);assert.ok(Date.parse(invite.body.expiresAt)>Date.now()+6*86400000);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM care_invites WHERE code_hash=?').bind(code).first()).n,0,'the code itself is never stored');
  assert.equal((await req('/api/sharing')).body.openInvites,1);
  assert.equal((await req('/api/sharing/accept','POST',{code})).status,409,'own link');
  assert.equal((await req('/api/sharing/accept','POST',{code:'0'.repeat(64)},'b')).status,404);assert.equal((await req('/api/sharing/accept','POST',{code:'short'},'b')).status,404);
  const accepted=await req('/api/sharing/accept','POST',{code},'b');assert.equal(accepted.status,200);assert.equal(accepted.body.name,'Owner Synthetic');assert.match(accepted.body.accessId,/^ca-/);
  assert.equal((await req('/api/sharing/accept','POST',{code},'c')).status,404,'used link');
  const owner=(await req('/api/sharing')).body;assert.deepEqual(owner.caregivers.map(c=>c.name),['Helper']);assert.equal(owner.openInvites,0);
  const helper=(await req('/api/sharing','GET',null,'b')).body;assert.deepEqual(helper.caringFor.map(c=>[c.id,c.name]),[[accepted.body.accessId,'Owner Synthetic']]);
  await req('/api/quick-record','POST',{kind:'careLog',params:{type:'fluid',volume:300}});
  const day=await req(`/api/sharing/access/${accepted.body.accessId}/today`,'GET',null,'b');assert.equal(day.status,200);assert.equal(day.body.today.fluidMl,300);assert.equal(day.body.records.length,1);assert.equal(JSON.stringify(day.body).includes('PRIVATE'),false);
  assert.equal((await req(`/api/sharing/access/${accepted.body.accessId}/today`,'GET',null,'c')).status,404);assert.equal((await req(`/api/sharing/access/${accepted.body.accessId}/today`)).status,404,'the owner is not the caregiver of the link');
  assert.equal((await req(`/api/sharing/access/${accepted.body.accessId}`,'DELETE',null,'c')).status,404);
  // The caregiver cannot read or change the owner's account through their own session.
  assert.equal((await req('/api/state','GET',null,'b')).body.events.length,0);
  assert.equal((await req(`/api/sharing/access/${accepted.body.accessId}`,'DELETE')).status,200);
  assert.equal((await req(`/api/sharing/access/${accepted.body.accessId}/today`,'GET',null,'b')).status,404);assert.deepEqual((await req('/api/sharing','GET',null,'b')).body.caringFor,[]);
  // A second invitation, accepted, then ended by the caregiver; unused links can be cancelled.
  const second=new URL((await req('/api/sharing/invites','POST',{})).body.link).searchParams.get('invite');const again=await req('/api/sharing/accept','POST',{code:second},'b');
  assert.equal((await req(`/api/sharing/access/${again.body.accessId}`,'DELETE',null,'b')).status,200);assert.deepEqual((await req('/api/sharing')).body.caregivers,[]);
  const third=new URL((await req('/api/sharing/invites','POST',{})).body.link).searchParams.get('invite');assert.equal((await req('/api/sharing/invites','DELETE')).status,200);assert.equal((await req('/api/sharing/accept','POST',{code:third},'b')).status,404);
  await db.prepare('UPDATE care_invites SET expires_at=1').run();
  const expiring=new URL((await req('/api/sharing/invites','POST',{})).body.link).searchParams.get('invite');await db.prepare('UPDATE care_invites SET expires_at=1').run();assert.equal((await req('/api/sharing/accept','POST',{code:expiring},'b')).status,404,'expired link');
  // Preview sessions cannot share or accept.
  const preview=await mf.dispatchFetch('https://sciapp.test/api/session',{method:'POST',headers:{origin:'https://sciapp.test','content-type':'application/json'},body:'{}'});const cookie=preview.headers.get('set-cookie').split(';')[0];
  const anon=async(path,method='GET',data)=>{const r=await mf.dispatchFetch('https://sciapp.test'+path,{method,headers:{cookie,origin:'https://sciapp.test',...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};};
  assert.equal((await anon('/api/sharing')).body.available,false);assert.equal((await anon('/api/sharing/invites','POST',{})).status,403);
  const fresh=new URL((await req('/api/sharing/invites','POST',{})).body.link).searchParams.get('invite');assert.equal((await anon('/api/sharing/accept','POST',{code:fresh})).status,403);
 }finally{await mf.dispose();}
});
