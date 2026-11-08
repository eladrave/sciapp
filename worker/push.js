import { buildPushPayload } from '@block65/webcrypto-web-push';
import { AppError } from './domain.js';
import { dueTasks } from './reminders.js';
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
const approvedHosts = new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
export function validateSubscription(value) {
 let url;try{url=new URL(value?.endpoint);}catch{throw new AppError('Invalid push subscription.');}
 if(url.protocol!=='https:'||!approvedHosts.has(url.hostname)||url.port||url.username||url.password||url.hash||url.href.length>4096)throw new AppError('Unsupported push notification provider. Use Chrome, Firefox, or Safari.');
 const keys=value.keys;
 for(const [key,size]of [['auth',16],['p256dh',65]]){
  const text=keys?.[key];let length=0;try{if(typeof text==='string'&&/^[\w-]+={0,2}$/.test(text))length=atob(text.replace(/-/g,'+').replace(/_/g,'/')).length;}catch{}
  if(length!==size)throw new AppError('Invalid push encryption keys. Please enable notifications again.');
 }
 return {endpoint:url.href,expirationTime:null,keys:{auth:keys.auth,p256dh:keys.p256dh}};
}
export async function subscribe(env,accountId,value){
 const subscription=validateSubscription(value),id=await digest(subscription.endpoint);
 const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE account_id=?').bind(accountId).first();
 if(count.n>=10){const old=await env.DB.prepare('SELECT account_id FROM push_subscriptions WHERE id=?').bind(id).first();if(old?.account_id!==accountId)throw new AppError('You already have ten notification devices. Disable one first.',409);}
 // An endpoint belongs to one signed-in account at a time, including shared devices.
 await env.DB.prepare('INSERT INTO push_subscriptions(id,account_id,endpoint,subscription,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,subscription=excluded.subscription,last_error=NULL').bind(id,accountId,subscription.endpoint,JSON.stringify(subscription),Date.now()).run();
 return id;
}
export async function unsubscribe(env,accountId,endpoint){if(typeof endpoint!=='string'||endpoint.length>4096)throw new AppError('Invalid device.');await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=? AND account_id=?').bind(await digest(endpoint),accountId).run();}
export async function pushStatus(env,accountId){const r=await env.DB.prepare('SELECT COUNT(*) AS devices,MAX(last_accepted_at) AS lastAcceptedAt FROM push_subscriptions WHERE account_id=?').bind(accountId).first();const e=await env.DB.prepare('SELECT last_error FROM push_subscriptions WHERE account_id=? AND last_error IS NOT NULL LIMIT 1').bind(accountId).first();return {...r,lastError:e?.last_error||null};}
export async function sendPush(env,row,tag,fetcher=fetch){
 const sub=validateSubscription(JSON.parse(row.subscription));
 const payload=await buildPushPayload({data:JSON.stringify({tag}),options:{ttl:120}},sub,{subject:'mailto:eladrave@gmail.com',publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
 const response=await fetcher(sub.endpoint,{...payload,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(response.status===404||response.status===410){await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=? AND account_id=?').bind(row.id,row.account_id).run();return {expired:true};}
 if(!response.ok)throw new Error(`push_${response.status}`);
 await env.DB.prepare('UPDATE push_subscriptions SET last_accepted_at=?,last_error=NULL WHERE id=? AND account_id=?').bind(Date.now(),row.id,row.account_id).run();
 return {accepted:true};
}
export async function testPush(env,accountId,endpoint){
 const row=await env.DB.prepare('SELECT * FROM push_subscriptions WHERE id=? AND account_id=?').bind(await digest(String(endpoint)),accountId).first();
 if(!row)throw new AppError('Enable notifications on this device first.',404);
 try{const result=await sendPush(env,row,crypto.randomUUID());if(result.expired)throw new Error('expired');return result;}catch{throw new AppError('The test was not accepted by the push provider. Enable notifications again and retry.',502);}
}
export async function dispatchReminders(env,at=Date.now(),fetcher=fetch){
 if(!env.VAPID_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY)return;
 let cursor='';let accepted=0,failed=0;
 for(;;){
  const {results}=await env.DB.prepare('SELECT DISTINCT a.id,a.state FROM accounts a JOIN push_subscriptions p ON p.account_id=a.id WHERE a.id>? ORDER BY a.id LIMIT 100').bind(cursor).all();
  if(!results.length)break;
  for(const account of results){
   cursor=account.id;if(!account.id.startsWith('clerk:'))continue;
   try{
    const state=JSON.parse(account.state),tasks=dueTasks(state,at);
    if(!tasks.length)continue;
    const {results:devices}=await env.DB.prepare('SELECT * FROM push_subscriptions WHERE account_id=?').bind(account.id).all();
    for(const task of tasks)for(const device of devices){
     const lease=at+60000;
     const claim=await env.DB.prepare("INSERT INTO notification_deliveries(subscription_id,occurrence_id,account_id,status,attempts,lease_until) VALUES (?,?,?,'sending',1,?) ON CONFLICT(subscription_id,occurrence_id) DO UPDATE SET status='sending',attempts=attempts+1,lease_until=excluded.lease_until WHERE notification_deliveries.status!='accepted' AND notification_deliveries.lease_until<? AND notification_deliveries.attempts<5").bind(device.id,task.id,account.id,lease,at).run();
     if(claim.meta.changes!==1)continue;
     // Recheck current owner and state after claiming, so cancelled schedules do not send from an old scan.
     const current=await env.DB.prepare('SELECT a.state FROM push_subscriptions p JOIN accounts a ON a.id=p.account_id WHERE p.id=? AND p.account_id=?').bind(device.id,account.id).first();
     if(!current||!dueTasks(JSON.parse(current.state),at).some(t=>t.id===task.id))continue;
     try{
      const result=await sendPush(env,device,await digest(`${account.id}:${task.id}`),fetcher);
      await env.DB.prepare('UPDATE notification_deliveries SET status=?,accepted_at=?,last_error=NULL WHERE subscription_id=? AND occurrence_id=? AND lease_until=?').bind(result.accepted?'accepted':'expired',result.accepted?Date.now():null,device.id,task.id,lease).run();
      if(result.accepted)accepted++;
     }catch{
      failed++;
      await env.DB.batch([env.DB.prepare("UPDATE notification_deliveries SET status='failed',last_error='provider_unavailable' WHERE subscription_id=? AND occurrence_id=? AND lease_until=?").bind(device.id,task.id,lease),env.DB.prepare("UPDATE push_subscriptions SET last_error='provider_unavailable' WHERE id=? AND account_id=?").bind(device.id,account.id)]);
     }
    }
   }catch{failed++;}
  }
 }
 await env.DB.batch([env.DB.prepare('DELETE FROM notification_deliveries WHERE lease_until<?').bind(at-30*86400000),env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(at),env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(at)]);
 console.log(JSON.stringify({event:'reminder_dispatch',accepted,failed}));
}
