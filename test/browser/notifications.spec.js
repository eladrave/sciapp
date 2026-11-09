import { test } from '@playwright/test';
import { initialState } from '../../worker/domain.js';

// Uses synthetic identity, permission events and provider responses, never real device push.
test('mobile notification setup recovers from denied to granted without another permission prompt', async ({page}) => {
 const run=async (page) => {
 const context=await page.context().browser().newContext({viewport:{width:412,height:915}});
 const p=await context.newPage();const fixture=initialState({real:true});let registrations=0;
 try{
 await p.route('**/auth.js',r=>r.fulfill({contentType:'application/javascript',body:''}));
 await p.route('**/api/config',r=>r.fulfill({json:{features:{notifications:true,photos:true},pushPublicKey:'c3ludGhldGljLWtleQ==',authEnvironment:'production'}}));
 await p.route('**/api/state',r=>r.fulfill({json:fixture}));
 await p.route('**/api/push/status',r=>r.fulfill({json:{enabled:false,subscriptions:[]}}));
 await p.route('**/api/push/subscriptions',r=>{registrations++;return r.fulfill({json:{ok:true}})});
 await p.addInitScript(()=>{
   window.Clerk={session:{getToken:async()=> 'synthetic'},user:{id:'synthetic-permission-owner'}};
   window.__permission='denied';window.__requests=0;window.__sub=null;window.__permissionStatus=new EventTarget();
   Object.defineProperty(window,'Notification',{configurable:true,value:{get permission(){return window.__permission},requestPermission:async()=>{window.__requests++;return window.__permission}}});
   window.PushManager=function(){};
   const registration={pushManager:{getSubscription:async()=>window.__sub,subscribe:async()=>window.__sub={endpoint:'https://fcm.googleapis.com/synthetic',toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'synthetic',auth:'synthetic'}}},unsubscribe:async()=>{window.__sub=null;return true}}}};
   Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>registration,ready:Promise.resolve(registration),getRegistration:async()=>registration,addEventListener(){}}});
   Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>window.__permissionStatus}});
 });
 await p.goto('https://sciapp.eladrave.com/');
 await p.waitForFunction(()=>!document.querySelector('#app').hidden,null,{polling:100});
 await p.evaluate(()=>Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.trim()==='Settings').click());
 await p.waitForFunction(()=>document.querySelector('#panel').innerText.includes('How to allow notifications'),null,{polling:100});
 const blocked=await p.evaluate(()=>({text:document.querySelector('#panel').innerText,overflow:document.documentElement.scrollWidth>innerWidth}));
 if(!blocked.text.includes('Android Settings')||blocked.overflow)throw Error('Permission guidance missing or mobile overflow');
 await p.evaluate(()=>Array.from(document.querySelectorAll('#panel button')).find(b=>b.textContent==='How to allow notifications').click());
 await p.waitForFunction(()=>document.querySelector('#error').textContent.includes('blocking'),null,{polling:100});
 if(registrations!==0)throw Error('Registered while denied');
 await p.evaluate(()=>{window.__permission='granted';window.__permissionStatus.dispatchEvent(new Event('change'));});
 await p.waitForFunction(()=>document.querySelector('#panel').innerText.includes('Send test notification'),null,{polling:100,timeout:12000});
 const result=await p.evaluate(()=>({permissionRequests:window.__requests,enabled:!!window.__sub,pending:localStorage.getItem('sciapp-push-pending-owner'),overflow:document.documentElement.scrollWidth>innerWidth}));
 if(registrations!==1||result.permissionRequests!==0||!result.enabled||result.pending||result.overflow)throw Error(JSON.stringify({registrations,...result}));
 return {blockedGuidance:true,lateGrantRecovered:true,registrations,...result};
 } finally {await context.close();}
};
 await run(page);
});
