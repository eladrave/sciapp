// Deliberately no fetch/cache handler: health data and auth never enter a cache.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let id = 'care';
 try { const data=event.data?.json(),tag=data?.tag || data?.id;if(typeof tag==='string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(tag))id=tag; } catch {}
 event.waitUntil(self.registration.showNotification('Care reminder',{
  body:'Open SCIapp to review your scheduled task.',icon:'/favicon.svg',badge:'/favicon.svg',
  tag:`sciapp-${id}`,data:{url:'/'},renotify:false,
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
  if(existing){await existing.focus();existing.postMessage({type:'sciapp:open-today'});return;}
  await self.clients.openWindow('/?page=Today');
 })());
});
