import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { enableNotifications, disableNotifications, notificationStatus, pendingNotificationEnable, watchNotificationPermission } from '../web/notifications.js';

function browser() {
 const saved = Object.fromEntries(['navigator','window','Notification'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const events=[];let current=null;
 const sub={endpoint:'https://fcm.googleapis.com/example',toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'sample',auth:'sample'}};},async unsubscribe(){events.push('unsubscribe');current=null;return true;}};
 const registration={pushManager:{async getSubscription(){return current;},async subscribe(options){events.push(['subscribe',options]);current=sub;return sub;}}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{PushManager:function(){},Notification:function(){}}});
 Object.defineProperty(globalThis,'Notification',{configurable:true,value:{permission:'default',async requestPermission(){events.push('permission');this.permission='granted';return this.permission;}}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{async register(path){events.push(['register',path]);return registration;},ready:Promise.resolve(registration),async getRegistration(){return registration;}}}});
 return {events,sub,restore(){for(const [key,value]of Object.entries(saved)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}};
}
const config={features:{notifications:true},pushPublicKey:Buffer.from('public-key').toString('base64url')};
test('push enable requests permission, registers encrypted subscription and device timezone',async()=>{
 const b=browser();try{
  const calls=[];const result=await enableNotifications(async(path,options)=>calls.push({path,...options}),config);
  assert.equal(b.events[0],'permission');assert.deepEqual(b.events[1],['register','/sw.js']);assert.equal(result.enabled,true);
  assert.equal(calls[0].path,'/api/push/subscriptions');const payload=JSON.parse(calls[0].body);assert.equal(payload.subscription.endpoint,b.sub.endpoint);assert.equal(typeof payload.timezone,'string');
  await disableNotifications(async(path,options)=>calls.push({path,...options}));assert.equal((await notificationStatus()).enabled,false);assert.equal(calls[1].method,'DELETE');assert.equal(b.events.at(-1),'unsubscribe');
 }finally{b.restore();}
});
test('failed subscription registration revokes browser subscription',async()=>{
 const b=browser();try{await assert.rejects(enableNotifications(async()=>{throw new Error('Server unavailable');},config),/Server unavailable/);assert.equal((await notificationStatus()).enabled,false);assert.equal(b.events.at(-1),'unsubscribe');}finally{b.restore();}
});
test('blocked permission never registers a service worker or sends a subscription',async()=>{
 const b=browser();try{Notification.permission='denied';await assert.rejects(enableNotifications(async()=>assert.fail('No network write expected'),config),/blocked/);assert.deepEqual(b.events,[]);}finally{b.restore();}
});
test('service worker never displays health details supplied in a push payload',async()=>{
 const handlers={};let shown;
 const self={addEventListener(type,handler){handlers[type]=handler;},registration:{showNotification(title,options){shown={title,...options};return Promise.resolve();}}};
 vm.runInNewContext(readFileSync(new URL('../web/sw.js',import.meta.url),'utf8'),{self,URL});
 let completion;handlers.push({data:{json:()=>({id:'opaque-id',title:'Sensitive name',body:'Sensitive information'})},waitUntil(promise){completion=promise;}});await completion;
 assert.equal(shown.title,'Care reminder');assert.equal(shown.body,'Open SCIapp to review your scheduled task.');assert.equal(shown.tag,'sciapp-opaque-id');assert.equal(JSON.stringify(shown).includes('Sensitive'),false);
});

test('another signed-in account cannot inherit a browser subscription',async()=>{
 const b=browser();try{
  await enableNotifications(async()=>({ok:true}),config,'account-a');
  assert.equal((await notificationStatus('account-a')).enabled,true);
  assert.equal((await notificationStatus('account-b')).enabled,false);
  assert.equal(b.events.at(-1),'unsubscribe');
 }finally{b.restore();}
});

test('a dismissed Chrome prompt can finish later after Site controls grants permission, for the requesting account only',async()=>{
 const b=browser();try{
  Notification.requestPermission=async()=>{b.events.push('permission');return 'default';};
  await assert.rejects(enableNotifications(async()=>assert.fail('Do not register before grant'),config,'late-account'),/not granted permission yet/);
  assert.equal(pendingNotificationEnable('late-account'),true);assert.equal(pendingNotificationEnable('other-account'),false);
  let listener,removed=false,work;const permission={addEventListener(event,fn){assert.equal(event,'change');listener=fn;},removeEventListener(){removed=true;}};navigator.permissions={query:async()=>permission};
  const stop=watchNotificationPermission(()=>{if(pendingNotificationEnable('late-account'))work=enableNotifications(async()=>({ok:true}),config,'late-account');});
  await Promise.resolve();Notification.permission='granted';listener();await work;
  assert.equal((await notificationStatus('late-account')).enabled,true);assert.equal(pendingNotificationEnable('late-account'),false);assert.equal(b.events.filter(e=>e==='permission').length,1);
  stop();assert.equal(removed,true);
 }finally{b.restore();}
});

test('diagnostics preserve click ordering and distinguish a blocked permission from an unaccepted prompt',async()=>{
 const b=browser();try{
  const records=[];const api=async(path,options)=>{b.events.push(['api',path]);if(path==='/api/push/diagnostics')records.push(JSON.parse(options.body));return{ok:true};};
  await enableNotifications(api,{...config,features:{...config.features,notificationDiagnostics:true}},'diagnostic-account');
  assert.equal(b.events[0],'permission');assert.ok(records.some(r=>r.phase==='permission-requested'&&r.beforePermission==='default'&&r.requestCalled));assert.ok(records.some(r=>r.phase==='permission-result'&&r.permissionResult==='granted'));assert.ok(records.some(r=>r.phase==='ready'&&r.hasSubscription));
  records.length=0;b.events.length=0;Notification.permission='denied';
  await assert.rejects(enableNotifications(api,{...config,features:{...config.features,notificationDiagnostics:true}},'diagnostic-account'),/cannot show another prompt/);
  assert.equal(b.events.includes('permission'),false);assert.ok(records.some(r=>r.phase==='permission-blocked'&&r.requestCalled===false));assert.equal(b.events.some(e=>e?.[1]==='/api/push/subscriptions'),false);
 }finally{b.restore();}
});
test('failure to send diagnostics cannot prevent granting permission or registering push',async()=>{
 const b=browser();try{let registered=false;const r=await enableNotifications(async(path)=>{if(path==='/api/push/diagnostics')throw Error('telemetry unavailable');if(path==='/api/push/subscriptions')registered=true;return{ok:true};},{...config,features:{...config.features,notificationDiagnostics:true}});assert.equal(registered,true);assert.equal(r.enabled,true);assert.equal(b.events[0],'permission');}finally{b.restore();}
});
