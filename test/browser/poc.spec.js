import { test, expect } from '@playwright/test';

async function start(page) { await page.goto('/'); await page.getByRole('button', { name: 'Start private preview', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Message your care companion' })).toBeVisible(); }
async function say(page,text) { await page.getByRole('textbox',{name:'Message your care companion'}).fill(text);await page.getByRole('button',{name:'Send',exact:true}).click(); }
test('phone care entry is saved without an approval tap, survives refresh and can be undone',async({page})=>{
 await start(page);await say(page,'I catheterized 350 mL');await expect(page.locator('#messages').getByText('Saved. You have 59 catheters remaining. Choose Undo if this is wrong.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Approve',exact:true})).toHaveCount(0);await expect(page.locator('.proposal .proposal-status')).toHaveText('✓ Saved');
 await page.reload();await expect(page.locator('#messages').getByText('Saved. You have 59 catheters remaining. Choose Undo if this is wrong.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Supplies',exact:true}).last().click();await expect(page.locator('.stock-number').first()).toHaveText('59');
 await page.getByRole('button',{name:'Conversation',exact:true}).last().click();const undo=page.getByRole('button',{name:/^Undo: /});expect((await undo.boundingBox()).height).toBeGreaterThanOrEqual(44);await undo.click();
 await expect(page.locator('#messages').getByText(/^Undone\./)).toBeVisible();await expect(page.locator('.proposal .proposal-status')).toHaveText('Undone');await expect(undo).toHaveCount(0);
 await page.getByRole('button',{name:'Supplies',exact:true}).last().click();await expect(page.locator('.stock-number').first()).toHaveText('60');
 const overflow=await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+2);expect(overflow).toBe(false);
});
test('foreground voice records care without a send tap or an approval',async({page})=>{
 await page.addInitScript(()=>{window.__voiceTest={instance:null};window.SpeechRecognition=class{start(){window.__voiceTest.instance=this;}abort(){}stop(){this.onend?.();}};});
 await start(page);await say(page,'Wait 2 seconds');await expect(page.locator('#messages').getByText('Saved.',{exact:true})).toBeVisible();
 await say(page,'Turn hands-free on');await expect(page.getByText('Hands-free listening',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.__voiceTest.instance.onresult({results:[[{transcript:'I catheterized 450 mL'}]]}));await expect(page.locator('#messages').getByText('Saved. You have 59 catheters remaining. Choose Undo if this is wrong.',{exact:true})).toBeVisible({timeout:15000});
});
test('hands-free composer button pauses and resumes without changing the setting',async({page})=>{
 await page.addInitScript(()=>{window.__voiceTest={instance:null};window.SpeechRecognition=class{start(){window.__voiceTest.instance=this;}abort(){this.aborted=true;}stop(){this.onend?.();}};});
 await start(page);await say(page,'Turn hands-free on');
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
