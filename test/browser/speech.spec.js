import { test, expect } from '@playwright/test';

// A short synthetic tone stands in for the voice model's audio.
function wav(){const n=1600,b=Buffer.alloc(44+n);b.write('RIFF',0);b.writeUInt32LE(36+n,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(8000,28);b.writeUInt16LE(1,32);b.writeUInt16LE(8,34);b.write('data',36);b.writeUInt32LE(n,40);for(let i=0;i<n;i++)b[44+i]=128+Math.round(40*Math.sin(i/4));return b;}
async function open(page,{speechOk=true}={}){
 const state={mode:'preview',profile:{name:'Test'},settings:{muted:false,handsFree:false,timezone:'America/New_York',textScale:1,catheterIntervalHours:4},inventory:[],medications:[],allergies:[],events:[],photos:[],caregivers:[],reminderTasks:[],messages:[]};
 const requests=[];
 await page.addInitScript(()=>{localStorage.setItem('sciapp-muted','false');window.__spoken=[];window.speechSynthesis.speak=u=>{window.__spoken.push(u.text);setTimeout(()=>u.onend?.(),0);};window.speechSynthesis.cancel=()=>{};});
 await page.route('**/api/config',route=>route.fulfill({json:{features:{photos:true,notifications:false,transcription:false,speech:true,voices:['thalia','luna','orion'],defaultVoice:'thalia'},authEnvironment:'development'}}));
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 await page.route('**/api/speech',route=>{requests.push(route.request().postDataJSON());return speechOk?route.fulfill({contentType:'audio/mpeg',body:wav()}):route.fulfill({status:503,json:{error:'The natural voice is unavailable right now.'}});});
 await page.route('**/api/chat',route=>{const reply={id:'m'+state.messages.length,role:'assistant',content:'**860 mL** recorded since 7:00 AM today.'};state.messages.push({id:'u'+state.messages.length,role:'user',content:'How much?'},reply);return route.fulfill({json:{reply,state}});});
 await page.goto('/');await expect(page.locator('#app')).toBeVisible();
 return requests;
}
const ask=async page=>{const input=page.getByRole('textbox',{name:'Message your care companion'});await input.fill('How much?');await input.press('Control+Enter');await expect(page.locator('#messages').getByText('recorded since 7:00 AM today.').last()).toBeVisible();};

test('replies are read with the natural voice, in the chosen voice, and not by the browser voice',async({page})=>{
 const requests=await open(page);await ask(page);
 await expect.poll(()=>requests.length).toBe(1);
 expect(requests[0]).toEqual({text:'860 milliliters recorded since 7:00 AM today.',voice:'thalia'});
 await expect.poll(()=>page.evaluate(()=>window.__spoken.length)).toBe(0);
 await page.getByRole('button',{name:'Settings'}).click();
 const select=page.getByLabel('Voice for spoken replies');await expect(select).toBeVisible();
 expect((await select.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await select.selectOption('orion');
 await expect.poll(()=>requests.at(-1)).toEqual({text:'This is how I will read replies to you.',voice:'orion'});
 expect(await page.evaluate(()=>localStorage.getItem('sciapp-voice'))).toBe('orion');
 await page.getByRole('button',{name:'Mute',exact:true}).click();
 const before=requests.length;await page.getByRole('button',{name:'Conversation'}).click();await ask(page);
 await page.waitForTimeout(300);expect(requests.length).toBe(before);
});
test('when the natural voice is unavailable the browser voice reads the reply instead',async({page})=>{
 const requests=await open(page,{speechOk:false});await ask(page);
 await expect.poll(()=>page.evaluate(()=>window.__spoken)).toEqual(['860 milliliters recorded since 7:00 AM today.']);
 expect(requests.length).toBe(1);
});
