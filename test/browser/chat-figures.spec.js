import { test, expect } from '@playwright/test';

// Synthetic reply carrying one figure from a published resource.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
test('a reply shows a resource figure with a caption, reserved space and one fetch across re-renders',async({page})=>{
 const figure={id:'f-00000000-0000-0000-0000-000000000001',url:'/api/resources/figures/f-00000000-0000-0000-0000-000000000001',label:'Figure 7',caption:'Lower Motor Neuron Injury',page:43,width:1400,height:1800,title:'Synthetic Guide'};
 const state={mode:'preview',profile:{name:'Test'},settings:{muted:true,handsFree:false,timezone:'America/New_York',textScale:1,catheterIntervalHours:4},inventory:[],medications:[],allergies:[],events:[],photos:[],caregivers:[],reminderTasks:[],
  messages:[{id:'m1',role:'user',content:'What is a lower motor neuron injury?',createdAt:new Date().toISOString()},{id:'m2',role:'assistant',content:'It affects the reflex arc.',createdAt:new Date().toISOString(),sources:[{title:'Synthetic Guide',url:'https://example.org/guide'}],figures:[figure,{url:'https://evil.example/x.png',label:'Bad'}]}]};
 let fetches=0;
 await page.route('**/api/config',route=>route.fulfill({json:{features:{photos:true,notifications:false,transcription:false},authEnvironment:'development'}}));
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 await page.route('**/api/resources/figures/**',route=>{fetches++;return route.fulfill({contentType:'image/png',body:png});});
 await page.route('**/api/chat',route=>{const reply={id:'m3',role:'assistant',content:'Anything else?'};state.messages.push({id:'u3',role:'user',content:'Thanks'},reply);return route.fulfill({json:{reply,state}});});
 await page.goto('/');await expect(page.locator('#app')).toBeVisible();
 const img=page.getByRole('img',{name:'Figure 7: Lower Motor Neuron Injury. Page image from Synthetic Guide.'});
 await expect(img).toBeVisible();await expect.poll(()=>img.evaluate(el=>el.naturalWidth)).toBeGreaterThan(0);
 await expect(page.locator('.resource-figure')).toHaveCount(1);
 await expect(page.locator('.resource-figure figcaption')).toHaveText('Figure 7: Lower Motor Neuron Injury · Synthetic Guide, page 43');
 const frame=await page.locator('.resource-figure-frame').boundingBox();expect(Math.abs(frame.height/frame.width-1800/1400)).toBeLessThan(0.02);
 expect((await page.getByRole('button',{name:'Open Figure 7 larger in a new tab'}).boundingBox()).height).toBeGreaterThanOrEqual(48);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 const input=page.getByRole('textbox',{name:'Message your care companion'});await input.fill('Thanks');await input.press('Control+Enter');
 await expect(page.locator('#messages').getByText('Anything else?')).toBeVisible();await expect(img).toBeVisible();
 expect(fetches).toBe(1);
});
