import { test, expect } from '@playwright/test';

const steps='Autonomic dysreflexia can be an emergency. Do these steps now, in order:\n1. Sit up straight.\n2. Loosen anything tight.\nUse the Call button below.';
async function open(page,context,{profile={name:'Test'},allow=true}={}){
 if(allow){await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:40.712345,longitude:-74.005678,accuracy:12});}
 const state={mode:'preview',profile,settings:{muted:true,handsFree:false,timezone:'America/New_York',textScale:1,catheterIntervalHours:4},inventory:[],medications:[],allergies:[],events:[],photos:[],caregivers:[],reminderTasks:[],messages:[]};
 let locationSent=false;
 await page.route('**/api/config',route=>route.fulfill({json:{features:{photos:true,notifications:false,transcription:false},authEnvironment:'development'}}));
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 await page.route('**/api/ad-help',route=>{const reply={id:'ad1',role:'assistant',content:steps,adHelp:true,options:['Log blood pressure','I feel better now'],createdAt:new Date().toISOString()};state.messages.push(reply);return route.fulfill({json:{reply,state}});});
 page.on('request',request=>{if(/40\.71|74\.00/.test(request.url()+(request.postData()||'')))locationSent=true;});
 await page.goto('/');await expect(page.locator('#app')).toBeVisible();
 await page.getByRole('button',{name:'Today',exact:true}).last().click();await page.getByRole('button',{name:/^Autonomic dysreflexia help/}).click();
 return ()=>locationSent;
}
test('AD help shows a call button, the saved address and the current location, read on the device only',async({page,context})=>{
 const sent=await open(page,context,{profile:{name:'Test',address:'12 Synthetic Street, Example City',emergencyNumber:'112'}});
 const panel=page.getByRole('region',{name:'Emergency call and your location'});await expect(panel).toBeVisible();
 const call=panel.getByRole('link',{name:'Call 112 now'});await expect(call).toHaveAttribute('href','tel:112');expect((await call.boundingBox()).height).toBeGreaterThanOrEqual(64);
 await expect(panel.getByText('Your home address: 12 Synthetic Street, Example City')).toBeVisible();
 await expect(panel.locator('.emergency-location')).toHaveText('Your location now: latitude 40.71234, longitude -74.00568 (within about 12 metres).');
 await expect(panel.getByRole('link',{name:'Open this location in Maps'})).toHaveAttribute('href','https://www.google.com/maps?q=40.712345,-74.005678');
 await context.setGeolocation({latitude:41.5,longitude:-73.25,accuracy:30});await panel.getByRole('button',{name:'Update my location'}).click();
 await expect(panel.locator('.emergency-location')).toHaveText(/latitude 41\.50000, longitude -73\.25000 \(within about 30 metres\)/);
 expect(sent()).toBe(false);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
test('without a saved address or location permission the panel still calls 911 and says what to do',async({page,context})=>{
 await open(page,context,{allow:false});
 const panel=page.getByRole('region',{name:'Emergency call and your location'});
 await expect(panel.getByRole('link',{name:'Call 911 now'})).toHaveAttribute('href','tel:911');
 await expect(panel.getByText(/No home address saved\. Add it in Settings/)).toBeVisible();
 await expect(panel.locator('.emergency-location')).toHaveText(/Location is turned off for this app|could not be found right now/,{timeout:20000});
 await expect(panel.getByRole('link',{name:'Open this location in Maps'})).toBeHidden();
});
