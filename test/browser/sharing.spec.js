import { test, expect } from '@playwright/test';

const code='ab'.repeat(32);
async function open(page,url='/'){
 const state={mode:'personal',profile:{name:'Helper'},settings:{muted:true,handsFree:false,timezone:'America/New_York',textScale:1,catheterIntervalHours:4},inventory:[],medications:[],allergies:[],events:[],photos:[],caregivers:[],reminderTasks:[],messages:[]};
 const calls=[];let sharing={available:true,caregivers:[{id:'ca-1',name:'Dana Synthetic',since:'2026-11-01T00:00:00Z'}],caringFor:[],openInvites:0};
 const day={name:'Sam Synthetic',timezone:'America/New_York',localNow:'Nov 10, 2026, 4:00 PM',unconfirmed:[{title:'Catheterization',time:'3:00 PM',status:'unconfirmed'}],upcoming:[{title:'Bowel program',time:'8:00 PM',status:'upcoming'}],records:[{title:'Fluid intake',detail:'500 mL of water',time:'2:10 PM'}],today:{urineMl:400,urineRecords:1,fluidMl:500,fluidRecords:1},supplyWarnings:['Catheters: about 4 days left (12 catheters).']};
 await page.route('**/api/config',route=>route.fulfill({json:{features:{photos:true,notifications:false,transcription:false},authEnvironment:'development'}}));
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 await page.route('**/api/sharing**',route=>{const path=new URL(route.request().url()).pathname,method=route.request().method();calls.push(method+' '+path);
  if(path==='/api/sharing')return route.fulfill({json:sharing});
  if(path==='/api/sharing/invites'&&method==='POST'){sharing={...sharing,openInvites:1};return route.fulfill({status:201,json:{link:'https://sciapp.test/?invite='+code,expiresAt:'2026-11-17T00:00:00Z'}});}
  if(path==='/api/sharing/accept'){expect(route.request().postDataJSON()).toEqual({code});sharing={...sharing,caringFor:[{id:'ca-2',name:'Sam Synthetic',since:'2026-11-10T00:00:00Z'}]};return route.fulfill({json:{accessId:'ca-2',name:'Sam Synthetic'}});}
  if(path==='/api/sharing/access/ca-2/today')return route.fulfill({json:day});
  if(path==='/api/sharing/access/ca-1'&&method==='DELETE'){sharing={...sharing,caregivers:[]};return route.fulfill({json:{ok:true}});}
  return route.fulfill({status:404,json:{error:'Unexpected'}});});
 await page.goto(url);await expect(page.locator('#app')).toBeVisible();return calls;
}
test('the owner invites a caregiver with a one-time link and can remove them',async({page})=>{
 await open(page);await page.getByRole('button',{name:'Settings',exact:true}).last().click();
 const card=page.locator('.support-circle');await expect(card.getByText(/Dana Synthetic · since/)).toBeVisible();
 const invite=card.getByRole('button',{name:'Invite a caregiver'});expect((await invite.boundingBox()).height).toBeGreaterThanOrEqual(44);await invite.click();
 await expect(card.getByLabel('Invitation link')).toHaveValue('https://sciapp.test/?invite='+code);await expect(card.getByText(/works once and expires/)).toBeVisible();
 await expect(card.getByRole('button',{name:'Cancel unused links'})).toBeVisible();
 await card.getByRole('button',{name:"Remove Dana Synthetic's access"}).click();await expect(card.getByText(/No one yet\./)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
test('a caregiver opens an invitation link, accepts it and sees the day, view only',async({page})=>{
 const calls=await open(page,'/?invite='+code);
 expect(new URL(page.url()).search).toBe('');
 const card=page.locator('.support-circle');await expect(card.getByText(/You opened a caregiver invitation/)).toBeVisible();
 await card.getByRole('button',{name:'Accept invitation'}).click();
 const day=card.locator('.shared-day');await expect(day.getByRole('heading',{name:"Sam Synthetic's day"})).toBeVisible();
 await expect(day.getByText('Catheterization · due 3:00 PM')).toBeVisible();await expect(day.getByText('Bowel program · 8:00 PM')).toBeVisible();await expect(day.getByText('2:10 PM · Fluid intake · 500 mL of water')).toBeVisible();
 await expect(day.getByText('Drank 500 mL · Urine 400 mL')).toBeVisible();await expect(day.getByText(/Running low\. Catheters/)).toBeVisible();await expect(day.getByText(/View only/)).toBeVisible();
 await expect(card.getByText(/You opened a caregiver invitation/)).toHaveCount(0);await expect(card.getByRole('button',{name:'Stop following Sam Synthetic'})).toBeVisible();
 expect(calls.filter(c=>c==='POST /api/sharing/accept')).toHaveLength(1);expect(await page.evaluate(()=>sessionStorage.getItem('sciapp-invite'))).toBe(null);
});
