import { test, expect } from '@playwright/test';

async function start(page) { await page.goto('/'); await page.getByRole('button', { name: 'Start private preview', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Message your care companion' })).toBeVisible(); }
async function say(page,text) { await page.getByRole('textbox',{name:'Message your care companion'}).fill(text);await page.getByRole('button',{name:'Send',exact:true}).click(); }
test('phone care entry is approved once and survives refresh',async({page})=>{
 await start(page);await say(page,'I catheterized 350 mL');await page.getByRole('button',{name:'Approve',exact:true}).click();await expect(page.getByText('Saved. You have 59 catheters remaining.',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByText('Saved. You have 59 catheters remaining.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Supplies',exact:true}).last().click();await expect(page.locator('.stock-number').first()).toHaveText('59');
 const overflow=await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+2);expect(overflow).toBe(false);
});
test('foreground voice can propose and approve care without a send tap',async({page})=>{
 await page.addInitScript(()=>{window.__voiceTest={instance:null};window.SpeechRecognition=class{start(){window.__voiceTest.instance=this;}abort(){}stop(){this.onend?.();}};});
 await start(page);await say(page,'Wait 2 seconds');await page.getByRole('button',{name:'Approve',exact:true}).click();await expect(page.getByText('Saved.',{exact:true})).toBeVisible();
 await say(page,'Turn hands-free on');await page.getByRole('button',{name:'Approve',exact:true}).click();await expect(page.getByText('Hands-free listening',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.__voiceTest.instance.onresult({results:[[{transcript:'I catheterized 450 mL'}]]}));await expect(page.getByRole('button',{name:'Approve',exact:true})).toBeVisible({timeout:10000});
 await page.evaluate(()=>window.__voiceTest.instance.onresult({results:[Object.assign([{transcript:'Approved.'}],{isFinal:true})]}));await expect(page.getByText('Saved. You have 59 catheters remaining.',{exact:true})).toBeVisible({timeout:10000});
});
test('hands-free composer button pauses and resumes without changing the setting',async({page})=>{
 await page.addInitScript(()=>{window.__voiceTest={instance:null};window.SpeechRecognition=class{start(){window.__voiceTest.instance=this;}abort(){this.aborted=true;}stop(){this.onend?.();}};});
 await start(page);await say(page,'Turn hands-free on');await page.getByRole('button',{name:'Approve',exact:true}).click();
 await expect(page.getByRole('button',{name:'Pause listening',exact:true})).toBeVisible();
 await page.evaluate(()=>window.__voiceTest.instance.onresult({results:[Object.assign([{transcript:'Unsent draft'}],{isFinal:true})]}));
 await page.getByRole('button',{name:'Pause listening',exact:true}).click();
 await expect(page.getByRole('button',{name:'Resume listening',exact:true})).toBeVisible();
 await expect(page.getByText('Listening paused',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__voiceTest.instance.aborted)).toBe(true);
 await page.waitForTimeout(5500);await expect(page.getByRole('textbox',{name:'Message your care companion'})).toHaveValue('Unsent draft');
 expect(await page.evaluate(async()=> (await (await fetch('/api/state')).json()).settings.handsFree)).toBe(true);
 await page.getByRole('button',{name:'Resume listening',exact:true}).click();
 await expect(page.getByRole('button',{name:'Pause listening',exact:true})).toBeVisible();
});
