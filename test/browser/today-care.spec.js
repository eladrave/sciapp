import { test, expect } from '@playwright/test';

async function start(page) { await page.goto('/'); await page.getByRole('button', { name: 'Start private preview', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Message your care companion' })).toBeVisible(); }
test('Today has one-tap records, running totals and the AD help steps',async({page})=>{
 await start(page);await page.getByRole('button',{name:'Today',exact:true}).last().click();
 const totals=page.getByRole('region',{name:'Today so far'});await expect(totals).toContainText('Nothing recorded');
 const glass=page.getByRole('button',{name:'Drank a glass (250 mL)'});expect((await glass.boundingBox()).height).toBeGreaterThanOrEqual(48);
 await glass.click();await expect(totals.locator('dd').first()).toHaveText('250 mL');
 await glass.click();await expect(totals.locator('dd').first()).toHaveText('500 mL');
 await page.getByRole('button',{name:'Bowel program done'}).click();await expect(page.locator('.event-row h2').filter({hasText:'Bowel program'})).toHaveCount(1);
 await page.locator('.event-row').filter({hasText:'Bowel program'}).getByRole('button',{name:'Undo'}).click();await expect(page.locator('.event-row:has(h2:text-is("Bowel program"))')).toContainText('Corrected');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 const help=page.getByRole('button',{name:/^Autonomic dysreflexia help/});expect((await help.boundingBox()).height).toBeGreaterThanOrEqual(56);await help.click();
 await expect(page.locator('#messages ol li').first()).toHaveText(/^Sit up straight/);await expect(page.locator('#messages ol li')).toHaveCount(6);await expect(page.locator('#messages').getByText(/Call emergency services now/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Log blood pressure',exact:true})).toBeVisible();
});
