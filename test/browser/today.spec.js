import { test, expect } from '@playwright/test';

// Synthetic account: three medicines share one time today; tomorrow's reminders must not appear.
test('Today lists only today and groups medicines that share a time',async({page})=>{
 const noon=new Date();noon.setHours(12,0,0,0);
 const at=offsetHours=>new Date(noon.getTime()+offsetHours*3600000).toISOString();
 const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const state={mode:'preview',profile:{name:'Test'},settings:{muted:true,handsFree:false,timezone,textScale:1,catheterIntervalHours:4},inventory:[],medications:[],allergies:[],events:[],photos:[],caregivers:[],messages:[{id:'m1',role:'assistant',content:'Hello.',createdAt:new Date().toISOString()}],
  reminderTasks:[
   {id:'cath-1',kind:'catheterization',title:'Catheterization',dueAt:at(-1)},
   {id:'med-a',kind:'medication',title:'Alpha 5 mg',dueAt:at(0)},{id:'med-b',kind:'medication',title:'Beta 10 mg',dueAt:at(0)},{id:'med-c',kind:'medication',title:'Gamma 1 mg',dueAt:at(0)},
   {id:'med-d',kind:'medication',title:'Alpha 5 mg',dueAt:at(4)},
   {id:'med-tomorrow',kind:'medication',title:'Tomorrow Only 1 mg',dueAt:at(24)},{id:'cath-later',kind:'catheterization',title:'Catheterization',dueAt:at(48)}]};
 await page.route('**/api/config',route=>route.fulfill({json:{features:{photos:true,notifications:false,transcription:false},authEnvironment:'development'}}));
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 let dismissed=null;
 await page.route('**/api/reminders/dismiss',route=>{dismissed=route.request().postDataJSON();return route.fulfill({json:{reply:{id:'r',role:'assistant',content:'Reminders dismissed.'},state}});});
 await page.goto('/');await expect(page.locator('#app')).toBeVisible();
 await page.getByRole('button',{name:'Today',exact:true}).last().click();
 const card=page.locator('section.data-card',{has:page.getByRole('heading',{name:'Today’s reminders'})});
 await expect(card).toBeVisible();
 await expect(card.locator('.care-due')).toHaveCount(3);
 await expect(card.getByText(/· 3 medications$/)).toBeVisible();
 await expect(card.getByText('Alpha 5 mg, Beta 10 mg, Gamma 1 mg')).toBeVisible();
 await expect(card.getByText('Tomorrow Only 1 mg')).toHaveCount(0);
 const all=card.getByRole('button',{name:/Dismiss all 3 medication reminders/});
 const box=await all.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);
 await all.click();
 await expect.poll(()=>dismissed?.occurrenceIds).toEqual(['med-a','med-b','med-c']);
});
