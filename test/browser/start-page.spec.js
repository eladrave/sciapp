import { test, expect } from '@playwright/test';

// The app always opens on the conversation. An address left over from an earlier reminder tap
// (?page=Today) must not keep reopening the Today page.
test('the app opens on the conversation, even from an old reminder address',async({page})=>{
 const state={mode:'preview',profile:{name:'Test'},settings:{muted:true,handsFree:false,timezone:'America/New_York',textScale:1,catheterIntervalHours:4},inventory:[],medications:[],allergies:[],events:[],photos:[],caregivers:[],reminderTasks:[],messages:[]};
 await page.route('**/api/config',route=>route.fulfill({json:{features:{photos:true,notifications:false,transcription:false},authEnvironment:'development'}}));
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 for(const address of ['/','/?page=Today']){
  await page.goto(address);await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#conversation')).toBeVisible();await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#page-label')).toHaveText('Conversation');
  expect(new URL(page.url()).search).toBe('');
 }
});
