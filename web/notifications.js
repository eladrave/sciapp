// Browser permission is requested only from an explicit user action. No health
// records or bearer tokens are cached in the service worker or push payload.
const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const body = value => JSON.stringify(value);
const ownerKey = 'sciapp-push-owner';
let activeOwner = null, pendingOwner = null;
const pendingKey="sciapp-push-pending-owner";
function pending(){try{return window.localStorage?.getItem(pendingKey)||pendingOwner;}catch{return pendingOwner;}}
function rememberPending(id){pendingOwner=id;try{if(id)window.localStorage?.setItem(pendingKey,id);else window.localStorage?.removeItem(pendingKey);}catch{}}
function clearPending(id){if(!id||pending()===id)rememberPending(null);}
export const pendingNotificationEnable=id=>!!id&&pending()===id;
export function permissionGuidance(permission){return permission==='denied'
 ?'Chrome reports SCIapp notification permission as blocked (denied). It cannot show another prompt while blocked. Open SCIapp → ⋮ → Site controls → Permissions → Notifications and choose Allow, or reset permissions for this site and try again. If SCIapp is listed under Managed by app, open Android Settings → Apps → SCIapp → Notifications. Other websites can still have their own permission.'
 :'Chrome has not granted permission yet. Look below the address bar for Get notifications? and tap Allow. In Chrome Settings → Site settings → Notifications, temporarily choose Expand all requests to make the request more visible. You can also allow it through SCIapp → ⋮ → Site controls → Permissions → Notifications.';}
let diagnosticBrowserId;
function browserId(){if(diagnosticBrowserId)return diagnosticBrowserId;try{const existing=window.localStorage?.getItem('sciapp-notification-browser-id');if(/^[a-f0-9-]{36}$/.test(existing||''))diagnosticBrowserId=existing;}catch{}if(!diagnosticBrowserId){diagnosticBrowserId=crypto.randomUUID();try{window.localStorage?.setItem('sciapp-notification-browser-id',diagnosticBrowserId);}catch{}}return diagnosticBrowserId;}
export async function reportNotificationDiagnostic(api,phase,extra={}){
 try{
  let permissionApi='unavailable';try{permissionApi=(await navigator.permissions?.query({name:'notifications'}))?.state||'unavailable';}catch{}
  const payload={browserId:browserId(),phase,permission:typeof Notification==='undefined'?'unavailable':Notification.permission,permissionApi,supported:supported(),secureContext:globalThis.isSecureContext===true,topLevel:window.top===window.self,standalone:!!(window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone),userActivation:navigator.userActivation?.isActive===true,chromeMajor:Number(navigator.userAgent?.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1])||null,...extra};
  await api('/api/push/diagnostics',{method:'POST',body:body(payload)});
 }catch{/* Setup diagnostics must not prevent permission or push registration. */}
}
export function watchNotificationPermission(changed){
 let stopped=false,status;const notify=()=>{if(!stopped)changed();};const visible=()=>{if(typeof document!=='undefined'&&document.visibilityState==='visible')notify();};
 if(typeof navigator!=='undefined'&&navigator.permissions?.query)navigator.permissions.query({name:'notifications'}).then(result=>{if(stopped)return;status=result;status.addEventListener('change',notify);}).catch(()=>{});
 window.addEventListener?.('focus',notify);if(typeof document!=='undefined')document.addEventListener('visibilitychange',visible);
 return ()=>{stopped=true;status?.removeEventListener('change',notify);window.removeEventListener?.('focus',notify);if(typeof document!=='undefined')document.removeEventListener('visibilitychange',visible);};
}
function owner() { try { return window.localStorage?.getItem(ownerKey) || activeOwner; } catch { return activeOwner; } }
function rememberOwner(value) { activeOwner = value; try { if(value)window.localStorage?.setItem(ownerKey,value);else window.localStorage?.removeItem(ownerKey); } catch {} }
function applicationKey(value) {
 const padded = value + '='.repeat((4 - value.length % 4) % 4);
 return Uint8Array.from(atob(padded.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
async function subscription() {
 if (!supported()) return null;
 const registration = await navigator.serviceWorker.getRegistration('/');
 return registration?.pushManager.getSubscription();
}
export async function notificationStatus(accountId) {
 if (!supported()) return {supported:false,enabled:false,permission:'unavailable'};
 let sub = await subscription();
 if(sub && accountId && owner() !== accountId) { if(!await sub.unsubscribe()) throw new Error('Unable to stop notifications belonging to the previous account.');sub=null;rememberOwner(null); }
 return {supported:true,enabled:!!sub && Notification.permission === 'granted',permission:Notification.permission,endpoint:sub?.endpoint||null};
}
export async function enableNotifications(api, config, accountId) {
 if (!supported()) throw new Error('This browser does not support push notifications. Open SCIapp in Chrome on Android.');
 if (!config?.features?.notifications || !config.pushPublicKey) throw new Error('Notifications are not connected on the server yet.');
 const beforePermission=Notification.permission,userActivationAtRequest=navigator.userActivation?.isActive===true;let requestCalled=false;
 const report=(phase,extra={})=>config.features.notificationDiagnostics?reportNotificationDiagnostic(api,phase,{beforePermission,requestCalled,userActivationAtRequest,...extra}):Promise.resolve();
 if(accountId)rememberPending(accountId);
 try{
  if(beforePermission==='denied'){await report('permission-blocked');throw new Error(permissionGuidance('denied'));}
  let permission=beforePermission;
  if(permission!=='granted'){
   const started=Date.now();requestCalled=true;
   // Call synchronously from the click, before any network or permission-query await.
   const permissionRequest=Notification.requestPermission();
   await report('permission-requested');
   permission=await permissionRequest;
   await report('permission-result',{permissionResult:permission,elapsedMs:Math.min(3600000,Date.now()-started)});
  }
  if(permission!=='granted')throw new Error(permissionGuidance(permission));
  await report('service-worker');
  await navigator.serviceWorker.register('/sw.js',{scope:'/'});
  const registration=await navigator.serviceWorker.ready;
  let sub=await registration.pushManager.getSubscription();
  await report('subscribing',{hasSubscription:!!sub});
  if(!sub)sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(config.pushPublicKey)});
  await report('registering',{hasSubscription:true});
  try{await api('/api/push/subscriptions',{method:'POST',body:body({subscription:sub.toJSON(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})});}
  catch(error){await sub.unsubscribe();throw error;}
  if(accountId)rememberOwner(accountId);clearPending(accountId);
  await report('ready',{hasSubscription:true});
  return notificationStatus(accountId);
 }catch(error){await report('setup-failed',{errorName:/^[A-Za-z][A-Za-z0-9]{0,59}$/.test(error.name||'')?error.name:'Error'});if(Notification.permission==='granted')clearPending(accountId);throw error;}
}
export async function disableNotifications(api) {
 clearPending();
 const sub = await subscription();
 if (!sub) return notificationStatus();
 let failure;
 try { await api('/api/push/subscriptions',{method:'DELETE',body:body({endpoint:sub.endpoint})}); }
 catch (error) { failure = error; }
 const removed = await sub.unsubscribe();
 if (!removed) throw new Error('The browser could not stop notifications. Try again before sharing this device.');
 rememberOwner(null);
 if (failure && failure.status !== 401) throw new Error('Notifications were stopped on this device, but server cleanup failed. Try again when connected.');
 return notificationStatus();
}
export async function detachBrowserNotifications() {
 clearPending();
 const sub = await subscription();
 if (sub && !await sub.unsubscribe()) throw new Error('The browser could not stop notifications for the previous account.');
 rememberOwner(null);
}
export async function testNotification(api) {
 const sub = await subscription();
 if (!sub || Notification.permission !== 'granted') throw new Error('Enable notifications on this device first.');
 return api('/api/push/test',{method:'POST',body:body({endpoint:sub.endpoint})});
}
