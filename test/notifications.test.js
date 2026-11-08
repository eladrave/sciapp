import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { enableNotifications, disableNotifications, notificationStatus } from '../web/notifications.js';

function browser() {
 const saved = Object.fromEntries(['navigator','window','Notification'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const events=[];let current=null;
 const sub={endpoint:'https://fcm.googleapis.com/example',toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'sample',auth:'sample'}};},async unsubscribe(){events.push('unsubscribe');current=null;return true;}};
 const registration={pushManager:{async getSubscription(){return current;},async subscribe(options){events.push(['subscribe',options]);current=sub;return sub;}}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{PushManager:function(){},Notification:function(){}}});
 Object.defineProperty(globalThis,'Notification',{configurable:true,value:{permission:'granted',async requestPermission(){events.push('permission');return this.permission;}}});
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
 const b=browser();try{Notification.permission='denied';await assert.rejects(enableNotifications(async()=>assert.fail('No network write expected'),config),/blocked/);assert.deepEqual(b.events,['permission']);}finally{b.restore();}
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
