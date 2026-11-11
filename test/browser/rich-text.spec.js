import { test, expect } from '@playwright/test';

test('assistant formatting is shown as bold text and lists, never as raw marks or injected markup',async({page})=>{
 const content='Here is what helps:\n\n- **Take a warm shower or bath.** It relaxes muscles.\n- *Stretch* gently\n\n1. Sit up\n2. Loosen clothing\n\n<img src=x onerror="window.__hacked=1"> Check with your **care team**.';
 const state={mode:'preview',profile:{name:'Test'},settings:{muted:true,handsFree:false,timezone:'America/New_York',textScale:1,catheterIntervalHours:4},inventory:[],medications:[],allergies:[],events:[],photos:[],caregivers:[],reminderTasks:[],
  messages:[{id:'u1',role:'user',content:'What **helps** with spasms?',createdAt:new Date().toISOString()},{id:'a1',role:'assistant',content,createdAt:new Date().toISOString()}]};
 await page.route('**/api/config',route=>route.fulfill({json:{features:{photos:true,notifications:false,transcription:false},authEnvironment:'development'}}));
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 await page.goto('/');await expect(page.locator('#app')).toBeVisible();
 const reply=page.locator('.message.assistant .message-text');
 await expect(reply.locator('strong').first()).toHaveText('Take a warm shower or bath.');
 expect(await reply.locator('strong').first().evaluate(el=>Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
 await expect(reply.locator('ul li')).toHaveCount(2);await expect(reply.locator('ol li')).toHaveText(['Sit up','Loosen clothing']);await expect(reply.locator('em')).toHaveText('Stretch');
 expect(await reply.innerText()).not.toContain('*');
 await expect(reply.locator('img')).toHaveCount(0);await expect(reply).toContainText('<img src=x onerror="window.__hacked=1"> Check with your care team.');expect(await page.evaluate(()=>window.__hacked)).toBeUndefined();
 // What the user typed is shown exactly as typed.
 await expect(page.locator('.message.user .message-text')).toHaveText('What **helps** with spasms?');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
