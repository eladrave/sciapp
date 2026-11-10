import { test, expect } from '@playwright/test';

async function longConversation(page) {
 const state={mode:'preview',profile:{name:'Test'},settings:{muted:true,handsFree:false,timezone:'America/New_York',textScale:1,catheterIntervalHours:4},inventory:[],medications:[],allergies:[],events:[],photos:[],caregivers:[],reminderTasks:[],messages:Array.from({length:40},(_,index)=>({id:`message-${index}`,role:index%2?'assistant':'user',content:`Turn ${index + 1}. This is a synthetic conversation for checking that a wheelchair user's latest message stays visible. `.repeat(3),createdAt:new Date().toISOString()}))};
 await page.route('**/api/config',route=>route.fulfill({json:{features:{photos:true,notifications:false,transcription:false},authEnvironment:'development'}}));
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 await page.route('**/api/chat',async route=>{
  const text=route.request().postDataJSON().message;
  if(text==='Fail this request')return route.fulfill({status:503,json:{error:'Synthetic temporary failure. Please try again.'}});
  state.messages.push({id:'synthetic-'+Math.random(),role:'user',content:text});
  const reply={id:'synthetic-'+Math.random(),role:'assistant',content:'Latest reply, kept in view.'};state.messages.push(reply);
  return route.fulfill({json:{reply,state}});
 });
 await page.goto('/');await expect(page.locator('#app')).toBeVisible();
 await expect.poll(()=>page.locator('#main').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(3);
 await page.evaluate(()=>document.fonts.ready); return state;
}
const metrics = page=>page.locator('#main').evaluate(el=>({top:el.scrollTop,bottom:el.scrollHeight-el.clientHeight-el.scrollTop,height:el.clientHeight,documentTop:document.scrollingElement.scrollTop}));

test('long mobile chat keeps latest turn visible on send and failed reply without losing draft',async({page})=>{
 await longConversation(page);
 expect((await metrics(page)).top).toBeGreaterThan(1000);
 const input=page.getByRole('textbox',{name:'Message your care companion'});
 await input.fill('A new synthetic turn');await input.press('Control+Enter');
 await expect(page.locator('#messages').getByText('Latest reply, kept in view.',{exact:true})).toBeVisible();
 await expect.poll(async()=>(await metrics(page)).bottom).toBeLessThan(3);
 await expect(input).toBeFocused();
 await input.fill('Fail this request');await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveText('Synthetic temporary failure. Please try again.');
 await expect(input).toHaveValue('Fail this request');
 await expect.poll(async()=>(await metrics(page)).bottom).toBeLessThan(3);
 expect((await metrics(page)).top).toBeGreaterThan(1000);expect((await metrics(page)).documentTop).toBe(0);
 await page.setViewportSize({width:412,height:540});
 await expect.poll(async()=>(await metrics(page)).bottom).toBeLessThan(3);
 expect((await metrics(page)).height).toBeGreaterThan(80);
});

test('returning to conversation and expiry re-render preserve an older turn being read',async({page})=>{
 const state=await longConversation(page);
 // Force a near-term proposal expiry to exercise the real re-render timer.
 // The review sits in the oldest rendered turn; only the latest ten turns are rendered.
 state.messages[30].proposal={id:'synthetic-review',status:'pending',expiresAt:new Date(Date.now()+2500).toISOString(),title:'Synthetic review',details:['No record is changed.']};
 await page.reload();await expect(page.locator('#app')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
 await page.locator('#main').evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel'));el.scrollTop=900;});
 await expect.poll(async()=>(await metrics(page)).top).toBeGreaterThan(850);
 const before=await page.locator('#messages article').evaluateAll(rows=>{const top=document.querySelector('#main').getBoundingClientRect().top;const row=rows.find(row=>row.getBoundingClientRect().bottom>top);return {id:row.dataset.messageId,offset:row.getBoundingClientRect().top-top};});
 await page.getByRole('button',{name:'Supplies',exact:true}).last().click();
 await page.getByRole('button',{name:'Conversation',exact:true}).last().click();
 await expect.poll(async()=>page.locator(`#messages article[data-message-id="${before.id}"]`).evaluate((el,offset)=>Math.abs(el.getBoundingClientRect().top-document.querySelector('#main').getBoundingClientRect().top-offset),before.offset)).toBeLessThan(3);
 await expect(page.getByText('Expired. Please request a new review.',{exact:true})).toBeAttached({timeout:6000});
 const after=await page.locator(`#messages article[data-message-id="${before.id}"]`).evaluate(el=>el.getBoundingClientRect().top-document.querySelector('#main').getBoundingClientRect().top);
 expect(Math.abs(after-before.offset)).toBeLessThan(3);
 expect((await metrics(page)).bottom).toBeGreaterThan(1000);
});

test('hands-free replies never autofocus the software keyboard',async({page})=>{
 await page.addInitScript(()=>{window.SpeechRecognition=class{start(){}abort(){}};});
 const state=await longConversation(page);state.settings.handsFree=true;
 await page.reload();await expect(page.getByRole('button',{name:'Pause listening',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Pause listening',exact:true}).click();
 // A quick reply is a hands-free-friendly action and must not focus the text input.
 await page.getByRole('button',{name:'Today',exact:true}).last().click();
 await page.getByRole('button',{name:'Log an activity',exact:true}).click();
 await expect(page.locator('#messages').getByText('Latest reply, kept in view.',{exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Message your care companion'})).not.toBeFocused();
 await expect.poll(async()=>(await metrics(page)).bottom).toBeLessThan(3);
});

test('late photo/card growth and working-indicator changes keep latest visible without pulling readers away',async({page})=>{
 await longConversation(page);
 // Delayed decoded image/card sizing happens after afterRender's animation frame.
 await page.locator('#messages article').last().evaluate(el=>{const card=document.createElement('div');card.id='late-card';card.style.height='600px';el.append(card);});
 await expect.poll(async()=>(await metrics(page)).bottom).toBeLessThan(3);
 await page.locator('#thinking').evaluate(el=>{el.hidden=false;});
 await expect.poll(async()=>(await metrics(page)).bottom).toBeLessThan(3);
 await page.locator('#main').evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel'));el.scrollTop=900;});
 await expect.poll(async()=>(await metrics(page)).top).toBeLessThan(1000);
 const before=(await metrics(page)).top;
 await page.locator('#late-card').evaluate(el=>el.style.height='1100px');
 await page.setViewportSize({width:412,height:600});
 await expect.poll(async()=>Math.abs((await metrics(page)).top-before)).toBeLessThan(3);
});

test('chat opens on the latest turns and loads earlier ones in batches without moving the turn being read',async({page})=>{
 await longConversation(page);
 const rows=page.locator('#messages article');
 // Only the newest ten of forty turns are rendered, and the newest is already in view.
 await expect(rows).toHaveCount(10);await expect(rows.last()).toHaveAttribute('data-message-id','message-39');
 expect((await metrics(page)).bottom).toBeLessThan(3);
 const more=page.getByRole('button',{name:'See earlier messages (30 more)',exact:true});
 await more.scrollIntoViewIfNeeded();
 const offset=()=>page.locator('#messages article[data-message-id="message-30"]').evaluate(el=>el.getBoundingClientRect().top-document.querySelector('#main').getBoundingClientRect().top);
 const before=await offset();
 expect((await more.boundingBox()).height).toBeGreaterThanOrEqual(48);
 await more.click();
 await expect(rows).toHaveCount(20);await expect(rows.first()).toHaveAttribute('data-message-id','message-20');
 await expect.poll(async()=>Math.abs(await offset()-before)).toBeLessThan(3);
 // Keyboard and screen-reader users keep their place on the control and hear what changed.
 await expect(page.getByRole('button',{name:'See earlier messages (20 more)',exact:true})).toBeFocused();
 await expect(page.locator('#announcer')).toHaveText('Showing 10 earlier messages.');
 await page.keyboard.press('Enter');await expect(rows).toHaveCount(30);
 await page.keyboard.press('Enter');await expect(rows).toHaveCount(40);
 await expect(page.getByRole('button',{name:/See earlier messages/})).toHaveCount(0);
 await expect(page.locator('#announcer')).toHaveText('Showing 10 earlier messages. This is the start of the conversation.');
 // Sending returns to the short, latest view.
 const input=page.getByRole('textbox',{name:'Message your care companion'});
 await input.fill('A new synthetic turn');await input.press('Control+Enter');
 await expect(page.locator('#messages').getByText('Latest reply, kept in view.',{exact:true})).toBeVisible();
 await expect(rows).toHaveCount(10);await expect.poll(async()=>(await metrics(page)).bottom).toBeLessThan(3);
});
