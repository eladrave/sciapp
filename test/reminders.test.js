import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderChat } from '../worker/reminder-chat.js';
import { initialState } from '../worker/domain.js';
import { zonedTime, reminderTasks, dueTasks } from '../worker/reminders.js';
import { validateSubscription, subscribe, unsubscribe, dispatchReminders } from '../worker/push.js';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
const b64=bytes=>Buffer.from(bytes).toString('base64url');
async function keys(){const key=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);return {p256dh:b64(await crypto.subtle.exportKey('raw',key.publicKey)),auth:b64(crypto.getRandomValues(new Uint8Array(16)))};}
function state(){return {profile:{mode:'personal'},settings:{timezone:'America/New_York',notificationsEnabled:true},events:[],medications:[{id:'medicine-a',name:'Sample A',dosage:'2 mg',times:['08:00','20:00'],createdAt:'2026-10-01T00:00:00Z',scheduleUpdatedAt:'2026-10-01T00:00:00Z',active:true,asNeeded:false}]};}
test('Timezone handles DST gap and repeat as one reminder occurrence',()=>{
 assert.equal(new Date(zonedTime('2026-11-08','08:00','America/New_York')).toISOString(),'2026-11-08T13:00:00.000Z');
 assert.equal(new Date(zonedTime('2026-11-01','01:30','America/New_York')).toISOString(),'2026-11-01T05:30:00.000Z');
 assert.equal(new Date(zonedTime('2026-03-08','02:30','America/New_York')).toISOString(),'2026-03-08T07:30:00.000Z');
});
test('due reminders require explicit times, exclude PRN, suppress logged occurrence, never consume stock',()=>{
 const s=state(),at=Date.parse('2026-11-08T13:00:20Z');s.medications[0].stock=40;
 s.medications.push({...s.medications[0],id:'prn',asNeeded:true},{...s.medications[0],id:'no-times',times:[]});
 assert.equal(dueTasks(s,at).length,1);assert.equal(s.medications[0].stock,40);
 s.events.push({kind:'medication',occurredAt:'2026-11-08T12:55:00Z',data:{medicationId:'medicine-a'}});assert.equal(dueTasks(s,at).length,0);
 assert.ok(reminderTasks(s,at).some(t=>t.dueAt==='2026-11-09T01:00:00.000Z'));
 s.settings.notificationsEnabled=false;assert.equal(dueTasks(s,Date.parse('2026-11-09T01:00:20Z')).length,0);
});
test('catheter reminders reset on confirmed records and never assume a schedule',()=>{
 const s=state(),at=Date.parse('2026-11-08T13:00:20Z');s.medications=[];
 assert.equal(reminderTasks(s,at).length,0);
 Object.assign(s.settings,{catheterRemindersEnabled:true,catheterIntervalHours:4,catheterStartAt:'2026-11-08T09:00:00Z'});
 assert.equal(dueTasks(s,at).length,1);
 s.events.unshift({kind:'catheterization',occurredAt:'2026-11-08T12:50:00Z'});
 assert.equal(dueTasks(s,at).length,0);assert.equal(reminderTasks(s,at)[0].dueAt,'2026-11-08T16:50:00.000Z');
});
test('subscription validation blocks arbitrary hosts, credentials, invalid keys',async()=>{
 const sub={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:await keys()};assert.ok(validateSubscription(sub));
 for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://fcm.googleapis.com.attacker.test/x','https://user:pass@fcm.googleapis.com/x','https://fcm.googleapis.com:444/x'])assert.throws(()=>validateSubscription({...sub,endpoint}));
 assert.throws(()=>validateSubscription({...sub,keys:{auth:'bad',p256dh:'bad'}}));
});
test('scheduled dispatch encrypts generic payloads, retries failures, deduplicates and expires dead endpoints',async()=>{
 const mf=new Miniflare({workers:[{config:{name:'test',compatibilityDate:'2026-11-08',env:{DB:{type:'d1',id:'DB'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("ok")}}'}}}}}]});
 try{
  const db=await mf.getD1Database('DB');for(const n of ['0001_initial.sql','0002_notifications.sql','0003_account_identities.sql'])await db.exec((await readFile(`migrations/${n}`,'utf8')).replace(/\n/g,' '));
  const s=state(),at=Date.parse('2026-11-08T13:00:20Z');
  for(const id of ['clerk:a','clerk:b'])await db.prepare('INSERT INTO accounts VALUES (?,?,0,?)').bind(id,JSON.stringify(s),new Date(at).toISOString()).run();
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
  const env={DB:db,VAPID_PUBLIC_KEY:b64(await crypto.subtle.exportKey('raw',pair.publicKey)),VAPID_PRIVATE_KEY:jwk.d};
  const sub={endpoint:'https://fcm.googleapis.com/fcm/send/testing',keys:await keys()};
  await subscribe(env,'clerk:a',sub);await subscribe(env,'clerk:b',sub);
  assert.equal((await db.prepare('SELECT account_id FROM push_subscriptions').first()).account_id,'clerk:b');
  await unsubscribe(env,'clerk:a',sub.endpoint);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first()).n,1);
  let sends=0;const requests=[];
  const fetcher=async(url,payload)=>{sends++;requests.push(payload);return new Response('',{status:sends===1?503:201});};
  await dispatchReminders(env,at,fetcher);assert.equal(sends,1);
  await dispatchReminders(env,at+30000,fetcher);assert.equal(sends,1);
  await dispatchReminders(env,at+61000,fetcher);assert.equal(sends,2);
  assert.equal(requests[1].headers['content-encoding'],'aes128gcm');assert.ok(requests[1].body instanceof Uint8Array||requests[1].body instanceof ArrayBuffer);
  assert.ok(!new TextDecoder().decode(requests[1].body).includes('Sample A'));
  await dispatchReminders(env,at+125000,fetcher);assert.equal(sends,2);
  assert.equal((await db.prepare('SELECT status FROM notification_deliveries').first()).status,'accepted');
  await db.prepare('DELETE FROM notification_deliveries').run();await dispatchReminders(env,at,async()=>new Response('',{status:410}));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first()).n,0);
 }finally{await mf.dispose();}
});

test('chat keeps medication intervals separate from catheter schedules and supports cancelling stock setup',()=>{
 const s=initialState({real:true});
 const reply=reminderChat(s,'Set medication reminders every 4 hours');assert.equal(reply.proposal,undefined);assert.equal(s.settings.catheterRemindersEnabled,false);
 reminderChat(s,'Set catheter stock');assert.equal(s.draft.kind,'catheterStock');assert.equal(reminderChat(s,'Cancel'),null);
});
