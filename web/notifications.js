// Browser permission is requested only from an explicit user action. No health
// records or bearer tokens are cached in the service worker or push payload.
const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const body = value => JSON.stringify(value);
const ownerKey = 'sciapp-push-owner';
let activeOwner = null;
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
 return {supported:true,enabled:!!sub && Notification.permission === 'granted',permission:Notification.permission};
}
export async function enableNotifications(api, config, accountId) {
 if (!supported()) throw new Error('This browser does not support push notifications. Open SCIapp in Chrome on Android.');
 if (!config?.features?.notifications || !config.pushPublicKey) throw new Error('Notifications are not connected on the server yet.');
 // Keep requestPermission before network awaits so the click grants user activation.
 const permission = await Notification.requestPermission();
 if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked. Allow notifications for this site in your browser settings, then try again.' : 'Notification permission was not granted. You can enable it later in Settings.');
 await navigator.serviceWorker.register('/sw.js',{scope:'/'});
 const registration = await navigator.serviceWorker.ready;
 let sub = await registration.pushManager.getSubscription();
 if (!sub) sub = await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(config.pushPublicKey)});
 try { await api('/api/push/subscriptions',{method:'POST',body:body({subscription:sub.toJSON(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})}); }
 catch (error) { await sub.unsubscribe(); throw error; }
 if(accountId)rememberOwner(accountId);
 return notificationStatus(accountId);
}
export async function disableNotifications(api) {
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
 const sub = await subscription();
 if (sub && !await sub.unsubscribe()) throw new Error('The browser could not stop notifications for the previous account.');
 rememberOwner(null);
}
export async function testNotification(api) {
 const sub = await subscription();
 if (!sub || Notification.permission !== 'granted') throw new Error('Enable notifications on this device first.');
 return api('/api/push/test',{method:'POST',body:body({endpoint:sub.endpoint})});
}
