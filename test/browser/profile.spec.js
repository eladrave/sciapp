import { test, expect } from '@playwright/test';

// Synthetic account: the Settings page shows personal details and saves them with one button.
test('Settings shows About you and saves personal details with large labelled controls',async({page})=>{
 const state={mode:'preview',profile:{name:'You'},settings:{muted:true,handsFree:false,timezone:'America/New_York',textScale:1,catheterIntervalHours:4},inventory:[],medications:[],allergies:[],events:[],photos:[],caregivers:[],reminderTasks:[],messages:[{id:'m1',role:'assistant',content:'Hello.',createdAt:new Date().toISOString()}]};
 await page.route('**/api/config',route=>route.fulfill({json:{features:{photos:true,notifications:false,transcription:false},authEnvironment:'development'}}));
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 let saved=null;
 await page.route('**/api/profile',route=>{saved=route.request().postDataJSON();if(saved.fullName==='Fail')return route.fulfill({status:400,json:{error:'Enter a valid date of birth.'}});Object.assign(state.profile,Object.fromEntries(Object.entries(saved).filter(([,v])=>v)));return route.fulfill({json:{state}});});
 await page.goto('/');await expect(page.locator('#app')).toBeVisible();
 await page.getByRole('button',{name:'Settings',exact:true}).last().click();
 const about=page.getByRole('region',{name:'About you'});
 await expect(about.getByText('Not set')).toHaveCount(6);
 await about.getByRole('button',{name:'Add my details'}).click();
 await expect(page.getByLabel('Preferred name (what I call you)')).toBeFocused();
 await page.getByLabel('Preferred name (what I call you)').fill('Sam');
 await page.getByLabel('Full name').fill('Sam Synthetic Example');
 await page.getByLabel('Gender').selectOption('Non-binary');
 await page.getByLabel('Date of birth').fill('1980-02-29');
 for(const control of [page.getByLabel('Full name'),page.getByLabel('Gender'),about.getByRole('button',{name:'Save my details'})])expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(48);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 await about.getByRole('button',{name:'Save my details'}).click();
 await expect.poll(()=>saved).toEqual({name:'Sam',fullName:'Sam Synthetic Example',gender:'Non-binary',dateOfBirth:'1980-02-29',injuryLevel:'',address:'',emergencyNumber:''});
 await expect(about.getByText('Sam Synthetic Example')).toBeVisible();await expect(about.getByText('February 29, 1980')).toBeVisible();
 await expect(about.getByRole('button',{name:'Edit my details'})).toBeVisible();await expect(about.getByText('Not set')).toHaveCount(2);
});
