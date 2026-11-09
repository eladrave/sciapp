import {createJournalUI} from './journal.js';
import { questionChoices } from './question-choices.js';
import { createHealthUI } from './health-systems.js';
import { createChatScroll } from './chat-scroll.js';
import { confirmationDelay } from './conversation-controls.js';
import { notificationStatus, watchNotificationPermission, pendingNotificationEnable, permissionGuidance, enableNotifications, disableNotifications, detachBrowserNotifications, testNotification } from './notifications.js';
const $ = (selector) => document.querySelector(selector);
const ui = Object.fromEntries(['welcome','app','start-preview','sign-in','welcome-error','messages','message','composer','send','error','thinking','mute','mute-label','mute-icon','voice','voice-label','recording-status','photo','photo-input','camera-input','photo-options','take-photo','upload-image','attachment','attachment-image','attachment-status','remove-photo','panel','conversation','page-label','composer-area','avatar','date-label','composer-hint','account','announcer'].map(id => [id, document.getElementById(id)]));
let state, config, activePage = 'Conversation', busy = false, photo = null, photoPreview, recorder, recordStream, recording = false, recognition, audioChunks = [], uploadBusy = false;
let photoGeneration = 0, accountGeneration = 0, voiceGeneration = 0, silenceTimer, handsFreeRecognition, handsFreeRunning = false, assistantSpeaking = false, manualVoiceActive = false, handsFreePaused = false, speechGeneration = 0;
const chatScroll = createChatScroll($('#main'),ui.messages,() => activePage === 'Conversation' && !ui.app.hidden);
const pendingRequests = new Set();
let approvalTimer, pushStatus = {supported:false,enabled:false,permission:'unknown'}, notificationBusy = false, pushServerStatus = null;
function staleError() { const e = new Error('Account changed.'); e.name = 'AbortError'; return e; }
const historicalPhotoUrls = new Set();
let muted = localStorage.getItem('sciapp-muted') !== 'false';
const icons = {
 Conversation: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-9.5A8.5 8.5 0 1 1 21 11.5Z"/>',
 Today: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18m-13 5 3 3 5-5"/>',
 Supplies: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10M7.5 4.5l9 5"/>',
 History: '<path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2"/>',
 Settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>'
};
function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function button(text, className, handler) { const el = node('button', className, text); el.type = 'button'; el.addEventListener('click', handler); return el; }
async function readPhoto(photoId){const generation=accountGeneration;const headers=new Headers();const token=await window.Clerk?.session?.getToken();if(token)headers.set('Authorization',`Bearer ${token}`);const r=await fetch(`/api/photos/${encodeURIComponent(photoId)}`,{headers,credentials:'same-origin'});if(generation!==accountGeneration)throw staleError();if(!r.ok)throw new Error('Original photo unavailable.');const blob=await r.blob();if(generation!==accountGeneration)throw staleError();return blob;}
const journalUI=createJournalUI({api,node,button,readPhoto,send,error,formatTime});
const healthUI=createHealthUI({api,node,button,send,error});
function focusComposer(explicit = false) { if (!ui.app.hidden && (!state?.settings?.handsFree || explicit) && (explicit || document.activeElement === ui.message)) ui.message.focus({preventScroll:true}); }
function error(message) { ui.error.textContent = message || ''; ui.error.hidden = !message; }
async function api(path, options = {}) {
 const generation = accountGeneration; const controller = new AbortController(); pendingRequests.add(controller);
 try {
 const headers = new Headers(options.headers);
 const token = await window.Clerk?.session?.getToken();
 if (generation !== accountGeneration) throw staleError();
 if (token) headers.set('Authorization', `Bearer ${token}`);
 if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
 const res = await fetch(path, { credentials: 'same-origin', ...options, headers, signal:controller.signal });
 const data = await res.json().catch(() => ({}));
 if (generation !== accountGeneration) throw staleError();
 if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status}). Please try again.`); e.status = res.status; throw e; }
 return data;
 } finally { pendingRequests.delete(controller); }
}
function setBusy(value) { busy = value; ui.thinking.hidden = !value; ui.send.disabled = value || uploadBusy || recording; ui.message.readOnly = value; ui.composer.setAttribute('aria-busy',String(value)); ui.photo.disabled = value || uploadBusy; ui['take-photo'].disabled = ui['upload-image'].disabled = value || uploadBusy; if(value || uploadBusy)closePhotoOptions(); document.querySelectorAll('[data-action]').forEach(el => { el.disabled = value; }); document.querySelectorAll('.quick-replies button,[data-answer-control]').forEach(el=>{el.disabled=value||uploadBusy||recording||el.dataset.staleQuestion==='true';}); }
function showApp(next) { const healthResult=new URL(location.href).searchParams.get('health');if(healthResult){error(healthResult==='connected'?'Health system authorized. Ask to sync your health records.':'Health system connection cancelled.');history.replaceState(null,'',location.pathname);} ui.welcome.hidden = true; ui.app.hidden = false; update(next); resumeHandsFree(); refreshNotificationStatus();  if (new URL(location.href).searchParams.get('page') === 'Today') switchPage('Today'); }
function update(next) {
 if (next) {
  if (state && next.settings?.muted !== state.settings?.muted && typeof next.settings?.muted === 'boolean') setMute(next.settings.muted);
  state = next;
  if (new Date(state.settings?.quietUntil || 0).getTime() > Date.now()) window.speechSynthesis?.cancel();
 }
 if (!state) return;
 if (!state.settings?.handsFree) { stopHandsFree(); handsFreePaused = false; }
 syncVoiceControl();
 const scale = Math.max(1, Math.min(1.5, Number(state.settings?.textScale) || 1));
 document.documentElement.style.setProperty('--scale', scale);
 const personal = state.mode === 'personal';
 document.getElementById('mode-badge').textContent = personal ? 'Personal beta' : 'Sample preview';
 ui.avatar.textContent = (state.profile?.name || 'You').slice(0, 1).toUpperCase();
 renderMessages(); if (activePage !== 'Conversation') renderPanel();
}
function formatTime(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString([], { month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:state?.settings?.timezone || undefined }); }
function revokeHistoricalPhotos() { photoGeneration++; for (const url of historicalPhotoUrls) URL.revokeObjectURL(url); historicalPhotoUrls.clear(); }
async function loadHistoricalPhoto(img, photoId, generation) {
 try {
  const headers = new Headers(); const token = await window.Clerk?.session?.getToken(); if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`/api/photos/${encodeURIComponent(photoId)}`, {headers,credentials:'same-origin'});
  if (!response.ok) throw new Error('A saved photo could not be loaded.');
  const blob = await response.blob(); if (generation !== photoGeneration || !img.isConnected) return;
  const url = URL.createObjectURL(blob); historicalPhotoUrls.add(url); img.src = url;
 } catch(e) { if (generation === photoGeneration && img.isConnected) { const position = chatScroll.capture(); img.replaceWith(node('p','photo-message error-text','Saved photo unavailable. Try reloading this page.')); chatScroll.afterRender(position); error(e.message); } }
}
function renderMessages() {
 const scrollPosition = chatScroll.capture();
 revokeHistoricalPhotos(); const generation = photoGeneration; const photoLoads = [];
 const fragment = document.createDocumentFragment();
 const messages = state.messages || [];
 for (const message of messages) {
  const row = node('article', `message ${message.role === 'user' ? 'user' : 'assistant'}`); row.dataset.messageId = message.id;
  if (message.role !== 'user') { const mark = node('span','assistant-mark','✳'); mark.setAttribute('aria-hidden','true'); row.append(mark); }
  const body = node('div','message-body'); body.append(node('div','message-meta',message.role === 'user' ? 'YOU' : 'SCIAPP COMPANION'));
  body.append(node('p','message-text',message.content || ''));
  if (message.photoId && state.photos?.some(photo => photo.id === message.photoId)) { const img = node('img','photo-message'); img.alt = 'Photo attached to this message'; body.append(img); photoLoads.push(() => loadHistoricalPhoto(img,message.photoId,generation)); body.append(button('Delete photo','secondary',() => deleteSavedPhoto(message.photoId))); }
  if (message.proposal) body.append(proposalCard(message.proposal));
  healthUI.render(body,message);
  if(message.journalResult)journalUI.appendResults(body,message.journalResult);
  if (message.sources?.length) { const sources = node('div','sources'); sources.append(node('strong','','Learn more')); for (const source of message.sources) { try { const url = new URL(source.url,location.origin); if (url.protocol !== 'https:') continue; const a = node('a','',source.title || url.hostname); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; sources.append(a); } catch {} } body.append(sources); }
  const answers=questionChoices(message);
  if (answers.choices.length) { const options = node('div','quick-replies');options.setAttribute('role','group');options.setAttribute('aria-label','Suggested answers');const currentQuestion=[...messages].reverse().find(m=>m.role==='assistant')?.id;answers.choices.forEach(text=>{const choice=button(text,'',()=>chooseReply(text,answers.reference));choice.dataset.staleQuestion=String(!!answers.reference&&message.id!==currentQuestion);choice.disabled=busy||uploadBusy||recording||choice.dataset.staleQuestion==='true';options.append(choice);});body.append(options);if(answers.reference){body.append(node('p','answer-hint',answers.hint));const other=button('Type or say something else','secondary',()=>{focusComposer(true);ui.announcer.textContent='Type your answer, or select Listen to speak.';});other.dataset.answerControl='true';other.dataset.staleQuestion=String(message.id!==currentQuestion);other.disabled=busy||uploadBusy||recording||other.dataset.staleQuestion==='true';body.append(other);} }
  row.append(body); fragment.append(row);
 }
 if (!messages.length) {
  const row = node('article','message assistant'); const mark = node('span','assistant-mark','✳'); mark.setAttribute('aria-hidden','true'); row.append(mark); const body = node('div','message-body'); body.append(node('div','message-meta','LET’S START HERE'),node('p','message-text','I can help you keep track of your day. Choose something below, or tell me what you need.')); const replies = node('div','quick-replies'); ['Log catheterization','Record medication','Add supplies','Invite a caregiver'].forEach(t => replies.append(button(t,'',() => send(t)))); body.append(replies); row.append(body); fragment.append(row);
 }
 const latestBody=fragment.lastElementChild?.querySelector('.message-body');if(latestBody)appendCareCheckIn(latestBody);
 ui.messages.replaceChildren(fragment); photoLoads.forEach(load => load());
 clearTimeout(approvalTimer); const expiry = (state.messages || []).map(m => m.proposal).filter(p => p?.status === 'pending' && Date.parse(p.expiresAt) > Date.now()).map(p => Date.parse(p.expiresAt)); if (expiry.length) approvalTimer = setTimeout(renderMessages, Math.min(...expiry) - Date.now() + 50);
 chatScroll.afterRender(scrollPosition);
}
function proposalCard(proposal) {
 const expired = proposal.status === 'pending' && Date.parse(proposal.expiresAt) <= Date.now();
 const card = node('section','proposal'); card.setAttribute('aria-label','Review proposed change');
 card.append(node('span','proposal-label',proposal.status === 'pending' ? 'FOR YOUR REVIEW' : 'REVIEWED CHANGE'),node('h3','',proposal.title || 'Review this change'));
 const details = node('ul'); (proposal.details || []).forEach(item => details.append(node('li','',item))); card.append(details);
 if (expired) { card.append(node('p','proposal-status','Expired. Please request a new review.'),button('Ask again','secondary',() => send(`Please create a fresh review for: ${proposal.title}. ${proposal.details.join('. ')}`))); }
 else if (proposal.status === 'pending') { const actions = node('div','proposal-buttons'); for (const [label,decision,css] of [['Approve','approve','primary'],['No, cancel','cancel','secondary']]) { const el = button(label,css,() => act(proposal.id,decision)); el.dataset.action = proposal.id; el.disabled = busy; actions.append(el); } if(proposal.editablePhotoCare){actions.append(button('Change time','secondary',()=>send('Change time')),button('Change amount','secondary',()=>send('Change amount')));} card.append(actions); }
 else card.append(node('p','proposal-status',proposal.status === 'approved' ? '✓ Approved' : 'Cancelled'));
 return card;
}
function changesSound(proposal) { return proposal?.kind === 'settings' && proposal.changedSettings?.includes('muted'); }
function replyText(reply) { if (!reply) return ''; return [reply.content, reply.proposal?.title, ...(reply.proposal?.details || []), reply.proposal?.status === 'pending' ? 'Choose Approve or Cancel, or type or say a correction.' : '',reply.answerHint||''].filter(Boolean).join('. '); }
function receive(result, soundApproval = false) { if(activePage === 'Conversation') chatScroll.latest(); update(result.state); if (soundApproval && typeof state.settings?.muted === 'boolean') setMute(state.settings.muted); const text = replyText(result.reply); ui.announcer.textContent = text; speak(text); }
async function act(id, decision) {
 if (busy) return; const generation = accountGeneration; const settingsApproval = decision === 'approve' && state.messages?.some(message => message.proposal?.id === id && changesSound(message.proposal)); setBusy(true); error(); stopHandsFree(); chatScroll.latest();
 try { const result = await api(`/api/actions/${encodeURIComponent(id)}`,{method:'POST',body:JSON.stringify({decision})}); receive(result,settingsApproval); }
 catch(e) { if(e.name !== 'AbortError') error(e.message); }
 finally { if(generation === accountGeneration) { setBusy(false); focusComposer(); resumeHandsFree(); } }
}
async function send(text = ui.message.value, responseToQuestion) {
 if (busy || uploadBusy || recording) return;
 const content = text.trim(); if (!content && !photo) { focusComposer(true); return; }
 const generation = accountGeneration;
 const pendingSettings = new Set((state.messages || []).filter(message => changesSound(message.proposal) && message.proposal.status === 'pending').map(message => message.proposal.id));
 stopHandsFree();
 switchPage('Conversation',{latest:true}); setBusy(true); error();
 try { const result = await api('/api/chat',{method:'POST',body:JSON.stringify({message:content || 'Help me record this photo.',...(responseToQuestion?{responseToQuestion}:{}),...(photo ? {photoId:photo.id} : {})})}); ui.message.value = ''; ui.message.style.height = ''; removePhoto({deleteRemote:false}); receive(result,state.messages?.some(message => pendingSettings.has(message.proposal?.id) && result.state.messages?.some(next => next.proposal?.id === message.proposal.id && next.proposal.status === 'approved'))); }
 catch(e) { if(e.name !== 'AbortError') error(e.message); } finally { if(generation === accountGeneration) { setBusy(false); focusComposer(); resumeHandsFree(); } }
}
function speak(text) {
 if (muted || new Date(state?.settings?.quietUntil || 0).getTime() > Date.now() || !text || !('speechSynthesis' in window)) { assistantSpeaking = false; resumeHandsFree(); return; }
 stopHandsFree(); const speechId = ++speechGeneration; speechSynthesis.cancel(); assistantSpeaking = true;
 const generation = accountGeneration; const utterance = new SpeechSynthesisUtterance(text); utterance.rate = .95;
 const done = () => { if(generation === accountGeneration && speechId === speechGeneration) {assistantSpeaking = false; resumeHandsFree();} }; utterance.onend = done; utterance.onerror = done; speechSynthesis.speak(utterance);
}
function setMute(value, persist = true) { muted = value; if (persist) localStorage.setItem('sciapp-muted',String(value)); if (value) { speechGeneration++; window.speechSynthesis?.cancel(); assistantSpeaking = false; resumeHandsFree(); } ui.mute.setAttribute('aria-pressed',String(value)); ui.mute.setAttribute('aria-label',value ? 'Turn on spoken replies' : 'Mute spoken replies'); ui['mute-label'].textContent = value ? 'Sound off' : 'Sound on'; ui['mute-icon'].textContent = value ? '◌' : '◖'; }
function switchPage(page, {latest = false} = {}) {
 const previous = activePage;
 if (previous === 'Conversation' && page !== previous) chatScroll.save();
 activePage = page; ui.conversation.hidden = page !== 'Conversation'; ui.panel.hidden = page === 'Conversation'; ui['page-label'].textContent = page;
 document.querySelectorAll('[data-page]').forEach(el => { el.classList.toggle('active',el.dataset.page === page); el.setAttribute('aria-current',el.dataset.page === page ? 'page' : 'false'); });
 if (page !== 'Conversation') renderPanel();
 if (page === 'Settings') refreshNotificationStatus();
 if (page === 'Conversation') { if (latest) chatScroll.latest(); else if (previous !== page) chatScroll.restore(); }
 else if (previous !== page) $('#main').scrollTop = 0;
}
function panelHeader(title, description) { const wrap = document.createDocumentFragment(); wrap.append(node('span','eyebrow','YOUR DAILY SPACE'),node('h1','',title),node('p','panel-intro',description)); return wrap; }
function chatButton(text, prompt = text) { return button(text,'secondary',() => send(prompt)); }
function careMedications() { return (state.medications || []).filter(med => med.active !== false); }
function stockText(value,unit) { return value == null ? 'Stock not entered' : `${value} ${unit || 'units'} remaining`; }
function appendMedicationCards(panel) {
 const section = node('section','care-section'); section.setAttribute('aria-label','Medication list');
 section.append(node('h2','section-heading','Medications'));
 const meds = careMedications();
 for (const med of meds) {
  const card = node('article','data-card medication-card');
  card.append(node('h3','',med.name),node('p','',`${med.dosage || 'Dose not entered'} · ${med.frequency || 'Frequency not entered'}${med.asNeeded ? ' · As needed' : ''}`));
  card.append(node('p','',med.times?.length ? `Reminder times: ${med.times.join(', ')} (${state.settings.timezone})` : med.asNeeded ? 'As needed. No automatic dose reminders.' : 'Reminder times not set.'));
  card.append(node('p','',stockText(med.stock,med.unit)));
  if (med.unitsPerDose == null) card.append(node('p','','Units per dose not entered. Logging will not guess a pill count.'));
  const actions = node('div','care-actions'); actions.append(chatButton('Record taken',`I took ${med.name}`));
  if (!med.asNeeded) actions.append(chatButton('Set reminder times',`Set reminders for ${med.name}`));
  card.append(actions); section.append(card);
 }
 if (!meds.length) section.append(node('p','empty-state','No personal medications added. Paste your list or add one through the conversation.'));
 section.append(chatButton('Add medication','Add medication')); panel.append(section);
 const allergies = node('section','data-card'); allergies.append(node('h2','','Allergies'));
 if (state.allergies?.length) { const list = node('ul','care-list'); for (const item of state.allergies) list.append(node('li','',typeof item === 'string' ? item : item.name)); allergies.append(list); }
 else allergies.append(node('p','','No allergy information entered. This does not mean no known allergies.'));
 allergies.append(chatButton('Add allergies','Add allergies')); panel.append(allergies);
}
function dailyClock(value) {
 const match=String(value).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
 if(!match)return String(value);
 const hour=Number(match[1]);return `${hour%12||12}:${match[2]} ${hour>=12?'PM':'AM'}`;
}
function appendProfile(panel) {
 const profile=node('section','data-card profile-card');profile.setAttribute('aria-label','Your profile');
 profile.append(node('h2','','Profile'),node('p','profile-name',state.profile?.name||'You'),node('p','',`Timezone: ${state.settings.timezone||'Not set'}`));
 const catheter=node('section','profile-section');catheter.append(node('h3','','Catheterization schedule'));
 const daily=state.settings.catheterScheduleMode==='daily'&&state.settings.catheterTimes?.length;
 catheter.append(node('p','profile-schedule',daily?'Every day: '+state.settings.catheterTimes.map(dailyClock).join(' · '):state.settings.catheterStartAt||state.settings.catheterRemindersEnabled?'Every '+state.settings.catheterIntervalHours+' hours (interval schedule)':'Schedule not set.'));
 catheter.append(node('p','',state.settings.catheterRemindersEnabled?'Catheter reminders on. Device notification permission is separate.':'Catheter reminders off.'));
 catheter.append(chatButton('Change catheter schedule','Set catheter reminders'));profile.append(catheter);
 const medications=node('section','profile-section');medications.append(node('h3','','Medications and schedules'));
 if(!careMedications().length)medications.append(node('p','','No medications saved.'));
 for(const med of careMedications()){
 const row=node('article','profile-medication');row.append(node('h4','',med.name),node('p','',[med.dosage,med.frequency].filter(Boolean).join(' · ')),node('p','profile-schedule',med.asNeeded?'As needed. No routine reminder schedule.':med.times?.length?'Every day: '+med.times.map(dailyClock).join(' · '):'Reminder times not set.'));
 if(!med.asNeeded)row.append(chatButton(med.times?.length?'Change reminder times':'Set reminder times',`Set reminders for ${med.name}`));medications.append(row);
 }
 medications.append(chatButton('Update medication list','Add medication'));profile.append(medications);
 const allergies=node('section','profile-section');allergies.append(node('h3','','Allergies'));
 if(state.allergies?.length){const list=node('ul','care-list');for(const a of state.allergies)list.append(node('li','',typeof a==='string'?a:a.name));allergies.append(list);}else allergies.append(node('p','','No allergy information entered.'));
 allergies.append(chatButton('Update allergies','Add allergies'));profile.append(allergies,chatButton('Change timezone','Change my timezone'));panel.append(profile);
}
function appendReminders(panel) {
 const card = node('section','data-card'); card.append(node('h2','','Upcoming reminders'));
 card.append(node('p','',`Timezone: ${state.settings.timezone || 'Not set'}`));
 if(state.settings.catheterScheduleMode==='daily'&&state.settings.catheterTimes?.length)card.append(node('p','',`Catheterization every day: ${state.settings.catheterTimes.join(', ')}`));
 const tasks = state.reminderTasks || [];
 for (const task of tasks) card.append(node('p','',`${task.title} · ${formatTime(task.dueAt)}`));
 if (!tasks.length) card.append(node('p','','No upcoming reminders. Set exact medication times or start catheterization reminders.'));
 card.append(chatButton(state.settings.catheterRemindersEnabled ? 'Stop catheter reminders' : 'Start catheter reminders',state.settings.catheterRemindersEnabled ? 'Stop catheter reminders' : 'Start catheter reminders'));
 card.append(chatButton('Set timezone','Change my timezone')); panel.append(card);
}
function renderPanel() {
 const panel = ui.panel; panel.replaceChildren();
 if (activePage === 'Supplies') {
  panel.append(panelHeader('A little peace of mind.','Counts change only when you confirm an action. Unknown stock stays unknown until you enter it.'));
  const grid = node('div','stat-grid');
  for (const item of state.inventory || []) {
   const card = node('article','data-card'); card.append(node('h2','',item.name));
   const count = node('div'); count.append(node('span',item.count == null ? 'stock-unknown' : 'stock-number',item.count == null ? 'Not entered' : String(item.count)),node('span','stock-unit',item.unit || 'remaining')); card.append(count); if(item.id==='catheter')card.append(chatButton('Set current stock','Set catheter stock')); grid.append(card);
  }
  for (const med of careMedications()) {
   const card = node('article','data-card'); card.append(node('h2','',med.name),node('p','',stockText(med.stock,med.unit)),chatButton('Set stock',`Set stock for ${med.name}`),chatButton('Units per dose',`Set units per dose for ${med.name}`)); grid.append(card);
  }
  panel.append(grid,chatButton('Add a delivery','Add supplies'));
  if (!state.inventory?.length) panel.append(node('p','empty-state','No supplies added yet. Tell me what you have, or send a photo of a box.'));
 }
 if(activePage==='History')journalUI.render(panel);
 if (activePage === 'Today') {
  panel.append(panelHeader('Your day, at a glance.','Due care, your medication list, and confirmed activities.'));
  appendCareCheckIn(panel);appendReminders(panel);appendMedicationCards(panel);
  const dateKey = date => new Intl.DateTimeFormat('en-CA',{timeZone:state.settings?.timezone || undefined,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  const events=(state.events||[]).filter(e=>dateKey(new Date(e.occurredAt||e.createdAt))===dateKey(new Date()));
  for(const event of events){const card=node('article','data-card event-row');card.append(node('h2','',event.title),node('p','',event.detail),node('p','',`Observed: ${formatTime(event.occurredAt||event.createdAt)}${event.voided?' · Corrected':''}`));if(!event.voided&&['catheterization','bag','vitals','medication','supplies','journalNote'].includes(event.kind))card.append(button('Undo','secondary',()=>undo(event.id)));panel.append(card);}
  if(!events.length)panel.append(node('p','','Nothing logged today.'));
 }
 if (activePage === 'Settings') {
  panel.append(panelHeader('Your profile and preferences.','Your daily routine at a glance. You can change it here or through the conversation.'));
  appendProfile(panel);
  healthUI.settings(panel,config?.features?.healthSystems&&state.mode==='personal');
  const notifications = node('section','data-card'); notifications.append(node('h2','','Device notifications'));
  notifications.append(node('p','',pushStatus.enabled ? (state.settings.notificationsEnabled===false ? 'This device is connected, but scheduled notifications are turned off for your account. Enable again to resume them.' : 'Enabled on this browser. Lock-screen messages contain no medication names or health details.') : pushStatus.permission === 'denied' ? 'Chrome or Android is blocking this device. Your schedule is saved, but this device cannot receive reminders until permission is allowed.' : 'Off on this device. Enable to receive reminders even when this page is closed.'));
  if (pushServerStatus?.lastAcceptedAt) notifications.append(node('p','',`Last accepted by push service: ${formatTime(pushServerStatus.lastAcceptedAt)}`));
  if (pushServerStatus?.lastError) notifications.append(node('p','error-text',`Latest delivery attempt: ${pushServerStatus.lastError}`));
  notifications.append(node('p','','Delivery depends on your browser, connection, and device settings. Reminders are not emergency alarms.'));
  if(pushStatus.permission==='denied'||pushStatus.permission==='default'){
   const help=node('details','notification-help');help.open=pushStatus.permission==='denied';help.append(node('summary','','How to allow notifications on Android'));
   const steps=node('ol');['In Chrome, tap ⋮ → Site controls → Permissions → Notifications. Choose Allow.','If Chrome notifications are off for the whole phone, open Android Settings → Apps → Chrome → Notifications and turn them on.','Return to SCIapp. If it is not connected automatically, select Enable notifications on this device. Then send a test notification.'].forEach(text=>steps.append(node('li','',text)));help.append(steps,node('p','','A small Get notifications? message may appear below the address bar instead of a pop-up. Tap Allow there.'));
   const guide=node('a','','Google Chrome notification instructions');guide.href='https://support.google.com/chrome/answer/3220216?co=GENIE.Platform%3DAndroid&hl=en';guide.target='_blank';guide.rel='noopener noreferrer';help.append(guide);notifications.append(help);
  }
  const notifyActions = node('div','care-actions');
  const enable = button(pushStatus.permission==='denied'?'How to allow notifications':'Enable notifications on this device','secondary',()=>notificationAction('enable')); enable.disabled = notificationBusy || !config?.features?.notifications || !window.Clerk?.session;
  notifyActions.append(enable);
  if (pushStatus.enabled) { const test = button('Send test notification','secondary',()=>notificationAction('test')); const off = button('Disable notifications on this device','secondary',()=>notificationAction('disable')); test.disabled = off.disabled = notificationBusy; notifyActions.append(test,off); }
  if (!window.Clerk?.session) notifications.append(node('p','','Sign in to enable notifications for your personal account.'));
  notifications.append(notifyActions); panel.append(notifications);
  const sound = node('section','data-card setting-row'); const text = node('div'); text.append(node('h2','','Spoken replies'),node('p','',muted ? 'Off. Replies stay on screen.' : 'On. New replies are read aloud.')); sound.append(text,button(muted ? 'Turn on' : 'Mute','secondary',() => {setMute(!muted); renderPanel();})); panel.append(sound);
  const hands = node('section','data-card'); hands.append(node('h2','','Foreground hands-free'),node('p','',state.settings?.handsFree ? 'Enabled while this page is open. Your microphone status is shown below. Speech is sent after your chosen pause.' : 'Optional browser voice conversation while this page is open. No background listening.'),chatButton(state.settings?.handsFree ? 'Turn hands-free off' : 'Turn hands-free on',state.settings?.handsFree ? 'Turn hands-free off' : 'Turn hands-free on')); if(state.settings?.handsFree) hands.append(button(handsFreePaused ? 'Resume listening' : 'Pause listening','secondary',() => {toggleHandsFreePause();})); panel.append(hands);
  const access = node('section','data-card'); access.append(node('h2','','Comfort and access'),node('p','','Change text size, quiet hours, and other preferences through the conversation.'),chatButton('Set my preferences','Settings')); panel.append(access);
  const caregivers = node('section','data-card'); caregivers.append(node('h2','','Your support circle'),node('p','',`${state.caregivers?.length || 0} invitation draft${state.caregivers?.length === 1 ? '' : 's'}. No access granted yet.`),chatButton('Invite a caregiver','I want to add a caretaker to help me follow up on my activities')); panel.append(caregivers);
  const about = node('section','data-card'); about.append(node('h2','',state.mode === 'personal' ? 'About this personal beta' : 'About this sample preview'),node('p','',state.mode === 'personal' ? 'Your records are saved to your signed-in account. This beta organizes your entered care plan; it does not prescribe, diagnose, or replace your care team. Caregiver invitations are still drafts.' : 'This separate preview uses sample supplies. Sign in to create your personal medication list and care journal.'));
  if (config?.authEnvironment === 'development') about.append(node('p','','Sign-in currently uses a development environment. Production deployment and operational review remain in progress.'));
  panel.append(about);
 }
}
function notificationCommand(text) {
 const command = String(text).trim().toLowerCase().replace(/[.!?]$/,'');
 if (['enable notifications on this device','enable notifications','turn on notifications'].includes(command)) return 'enable';
 if (['disable notifications on this device','disable notifications','turn off notifications'].includes(command)) return 'disable';
 if (['send test notification','test notifications','test notification'].includes(command)) return 'test';
 return null;
}
function chooseReply(text,questionId) { if(questionId)return send(text,questionId);const command = notificationCommand(text); return command ? notificationAction(command) : send(text); }
async function refreshNotificationStatus() {
 const generation = accountGeneration;
 try { const next = await notificationStatus(window.Clerk?.user?.id || window.Clerk?.session?.user?.id); const server = window.Clerk?.session ? await api('/api/push/status',next.endpoint?{method:'POST',body:JSON.stringify({endpoint:next.endpoint})}:{}) : null; if (generation !== accountGeneration) return; pushServerStatus = server; pushStatus = next; if (activePage === 'Settings' && state) renderPanel();if(activePage==='Conversation'&&state)renderMessages();const id=window.Clerk?.user?.id||window.Clerk?.session?.user?.id;if(!notificationBusy&&window.Clerk?.session&&next.permission==='granted'&&(pendingNotificationEnable(id)||(next.enabled&&!server?.deviceRegistered)))await notificationAction('enable',{resume:true}); } catch {}
}
async function notificationAction(action,{resume=false}={}) {
 if (notificationBusy) return;
 if (!window.Clerk?.session) { error('Sign in before enabling personal notifications.'); return; }
 if (action === 'enable' && !resume && navigator.userActivation && !navigator.userActivation.isActive) { switchPage('Settings'); error('Select Enable notifications on this device to allow the browser permission request.'); return; }
 notificationBusy = true; error();
 const generation = accountGeneration;
 const notificationApi = (path,options) => { if (generation !== accountGeneration) throw staleError(); return api(path,options); };
 try {
  let next;
  if (action === 'enable') next = await enableNotifications(notificationApi,config,window.Clerk?.user?.id || window.Clerk?.session?.user?.id);
  else if (action === 'disable') next = await disableNotifications(notificationApi);
  else await testNotification(notificationApi);
  if (generation !== accountGeneration) return;
  if (next) pushStatus = next;
  if (action === 'enable') update(await notificationApi('/api/state'));
  const text = action === 'test' ? 'Test notification sent to this device’s push service. Check the notification tray.' : action === 'enable' ? 'Notifications enabled on this device. Set your reminder times in the conversation.' : 'Notifications disabled on this device.';
  ui.announcer.textContent = text; error(text);
 } catch(e) { if (generation === accountGeneration) error(typeof Notification!=='undefined'&&Notification.permission==='denied'&&pendingNotificationEnable(window.Clerk?.user?.id||window.Clerk?.session?.user?.id)?permissionGuidance('denied'):e.message); }
 finally { if (generation === accountGeneration) { notificationBusy = false; await refreshNotificationStatus(); } }
}
async function undo(id) { if (busy) return; const generation = accountGeneration; setBusy(true); error(); stopHandsFree(); try { const result = await api(`/api/events/${encodeURIComponent(id)}/undo`,{method:'POST'}); receive(result); } catch(e) { if(e.name !== 'AbortError') error(e.message); } finally { if(generation === accountGeneration) {setBusy(false); focusComposer(); resumeHandsFree();} } }
function removePhoto({deleteRemote = true} = {}) {
 const previous = photo; photo = null; if (photoPreview) URL.revokeObjectURL(photoPreview); photoPreview = null; ui.attachment.hidden = true; ui['photo-input'].value = ''; ui['camera-input'].value = ''; ui['attachment-image'].removeAttribute('src');
 if(deleteRemote && previous) api(`/api/photos/${encodeURIComponent(previous.id)}`,{method:'DELETE'}).catch(e => {if(e.name !== 'AbortError') error('The photo was detached, but could not be deleted. Please try again.');});
}
async function deleteSavedPhoto(id) { if(busy) return; const generation = accountGeneration; setBusy(true); try { await api(`/api/photos/${encodeURIComponent(id)}`,{method:'DELETE'}); state.photos = state.photos.filter(photo => photo.id !== id); for(const message of state.messages) if(message.photoId === id) { delete message.photoId; delete message.photoUrl; } update(state); ui.announcer.textContent = 'Photo deleted.'; } catch(e) {if(e.name !== 'AbortError') error(e.message);} finally {if(generation === accountGeneration) {setBusy(false); focusComposer();}} }
async function uploadPhoto(file) {
 if (!file) return; const generation = accountGeneration; error(); if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { error('Choose a JPEG, PNG, or WebP photo.'); return; } if (file.size > 5 * 1024 * 1024) { error('This photo is too large. Please choose one under 5 MB.'); return; }
 removePhoto(); photoPreview = URL.createObjectURL(file); ui['attachment-image'].src = photoPreview; ui.attachment.hidden = false; ui['attachment-status'].textContent = 'Uploading photo…'; uploadBusy = true; ui['remove-photo'].disabled = true; setBusy(busy);
 try { const data = new FormData(); data.append('photo',file); photo = await api('/api/photos',{method:'POST',body:data}); ui['attachment-status'].textContent = 'Add a note, or send it as it is.'; }
 catch(e) { if(e.name !== 'AbortError') {removePhoto(); error(e.message);} } finally { if(generation === accountGeneration) {uploadBusy = false; ui['remove-photo'].disabled = false; setBusy(busy);} }
}
function resetRecording() { manualVoiceActive = false; recording = false; ui.composer.classList.remove('recording'); syncVoiceControl(); ui['recording-status'].textContent = ''; recordStream?.getTracks().forEach(track => track.stop()); recordStream = null; setBusy(busy); }
async function toggleVoice() {
 if (state?.settings?.handsFree) { toggleHandsFreePause(); return; }
 if (busy || uploadBusy) return;
 if (recording) { recorder ? recorder.stop() : recognition?.stop(); return; }
 error(); stopHandsFree(); manualVoiceActive = true; window.speechSynthesis?.cancel(); assistantSpeaking = false;
 if (config?.features?.transcription === false) { browserVoice(); return; }
 if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { browserVoice(); return; }
 const generation = accountGeneration; const voiceId = ++voiceGeneration; const draft = ui.message.value;
 try { const stream = await navigator.mediaDevices.getUserMedia({audio:true}); if(generation !== accountGeneration || voiceId !== voiceGeneration) {stream.getTracks().forEach(track => track.stop()); return;} recordStream = stream; recorder = new MediaRecorder(recordStream); audioChunks = []; recorder.addEventListener('dataavailable',event => { if (event.data.size) audioChunks.push(event.data); }); recorder.addEventListener('stop',async () => { if(generation !== accountGeneration || voiceId !== voiceGeneration) return; const mimeType = recorder.mimeType || 'audio/webm'; resetRecording(); recorder = null; setBusy(true); ui['recording-status'].textContent = 'Transcribing…'; try { const form = new FormData(); form.append('audio',new Blob(audioChunks,{type:mimeType}),'recording.webm'); const result = await api('/api/transcribe',{method:'POST',body:form}); ui.message.value = [draft,result.text || ''].filter(Boolean).join(' '); ui['composer-hint'].textContent = 'Review your words, then press Send.'; focusComposer(); if (!result.text) error('No words were detected. Try again or type your message.'); } catch(e) { if(e.name !== 'AbortError') error(`${e.message} You can type your message instead.`); } finally { if(generation === accountGeneration) {ui['recording-status'].textContent = ''; setBusy(false);} } }); recorder.start(); recording = true; ui.composer.classList.add('recording'); ui['voice-label'].textContent = 'Stop'; ui.voice.setAttribute('aria-label','Stop recording and transcribe'); ui['recording-status'].textContent = 'Listening…'; setBusy(false); }
 catch(e) { if(generation !== accountGeneration) return; resetRecording(); error(e.name === 'NotAllowedError' ? 'Microphone permission is off. Allow it in your browser, or type your message.' : 'The microphone could not start. You can type your message instead.'); }
}
function browserVoice() {
 const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
 if (!SpeechRecognition) { resetRecording(); error('Voice input is unavailable in this browser. Please type your message.'); return; }
 const generation = accountGeneration; const voiceId = ++voiceGeneration; const draft = ui.message.value;
 recognition = new SpeechRecognition(); recognition.lang = navigator.language || 'en-US'; recognition.interimResults = false; recognition.continuous = false; let resultText = '';
 recognition.onresult = event => { if(generation !== accountGeneration || voiceId !== voiceGeneration) return; resultText = Array.from(event.results).map(result => result[0].transcript).join(' '); ui.message.value = [draft,resultText].filter(Boolean).join(' '); ui['composer-hint'].textContent = 'Browser voice input. Review your words, then press Send.'; };
 recognition.onerror = event => { if(generation !== accountGeneration || voiceId !== voiceGeneration) return; error(`Browser voice input: ${event.error}. You can type your message instead.`); };
 recognition.onend = () => { if(generation !== accountGeneration || voiceId !== voiceGeneration) return; resetRecording(); recognition = null; if (resultText) focusComposer(); };
 try { recognition.start(); recording = true; ui.composer.classList.add('recording'); ui['voice-label'].textContent = 'Stop'; ui.voice.setAttribute('aria-label','Stop browser voice input'); ui['recording-status'].textContent = 'Browser voice input'; setBusy(false); } catch { resetRecording(); error('Browser voice input could not start. Please type your message.'); }
}
function syncVoiceControl() {
 const handsFree = Boolean(state?.settings?.handsFree);
 ui['voice-label'].textContent = handsFree ? (handsFreePaused ? 'Listen' : 'Pause') : (recording ? 'Stop' : 'Talk');
 ui.voice.setAttribute('aria-label', handsFree ? (handsFreePaused ? 'Resume listening' : 'Pause listening') : (recording ? 'Stop voice recording' : 'Start voice recording'));
 if (handsFree && handsFreePaused) {
  ui['recording-status'].textContent = 'Listening paused';
  ui['composer-hint'].textContent = 'Microphone paused. Select Listen to resume. You can still type or send a photo.';
 } else if (handsFree) {
  ui['composer-hint'].textContent = 'Hands-free, while this page is open. Speech sends after your pause. Select Pause to stop listening.';
 } else if (!recording) {
  ui['composer-hint'].textContent = 'Type, talk, or send a photo. Review voice input before sending.';
 }
}
function toggleHandsFreePause() {
 handsFreePaused = !handsFreePaused;
 if (handsFreePaused) stopHandsFree(); else { error(); resumeHandsFree(); }
 syncVoiceControl();
 if (activePage === 'Settings') renderPanel();
}
function stopHandsFree() {
 clearTimeout(silenceTimer); silenceTimer = null;
 if(handsFreeRecognition) { const current = handsFreeRecognition; handsFreeRecognition = null; current.onend = null; current.onresult = null; current.onerror = null; try {current.abort();} catch {} }
 handsFreeRunning = false;
 if(!manualVoiceActive && !recording) ui['recording-status'].textContent = state?.settings?.handsFree && handsFreePaused ? 'Listening paused' : '';
 syncVoiceControl();
}
function resumeHandsFree() {
 if(!state?.settings?.handsFree || handsFreePaused || handsFreeRunning || assistantSpeaking || busy || uploadBusy || recording || manualVoiceActive || ui.app.hidden || document.visibilityState === 'hidden') return;
 const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
 if(!SpeechRecognition) { handsFreePaused = true; syncVoiceControl(); error('Hands-free voice is unavailable in this browser. Turn hands-free off for manual Talk, or type your message.'); return; }
 const generation = accountGeneration; const current = new SpeechRecognition(); const draft = ui.message.value;
 handsFreeRecognition = current; current.lang = navigator.language || 'en-US'; current.continuous = true; current.interimResults = true;
 current.onresult = event => {
  if(generation !== accountGeneration || current !== handsFreeRecognition) return;
  const transcript = Array.from(event.results).map(result => result[0].transcript).join(' ').trim();
  ui.message.value = [draft,transcript].filter(Boolean).join(' ');
  clearTimeout(silenceTimer);
  const normal = Math.max(2000,Math.min(15000,Number(state.settings.voicePauseMs) || 5000));
  const final = Array.from(event.results).every(result => result.isFinal);
  const pending = state.messages.some(m => m.proposal?.status === 'pending' && Date.parse(m.proposal.expiresAt) > Date.now());
  const pause = confirmationDelay(transcript, { pending, final, draft, normal });
  ui['recording-status'].textContent = pause < normal ? 'Heard your answer · sending…' : `Listening · sends after ${pause / 1000}s pause`;
  silenceTimer = setTimeout(() => { if(generation === accountGeneration && state?.settings?.handsFree && !handsFreePaused && ui.message.value.trim()) {stopHandsFree(); send();} },pause);
 };
 current.onerror = event => {
  if(generation !== accountGeneration || current !== handsFreeRecognition) return;
  if(['not-allowed','service-not-allowed','audio-capture','network'].includes(event.error)) { handsFreePaused = true; stopHandsFree(); error(`Hands-free voice paused (${event.error}). Select Listen to retry, or type.`); }
 };
 current.onend = () => {
  if(generation !== accountGeneration || current !== handsFreeRecognition) return;
  handsFreeRecognition = null; handsFreeRunning = false;
  setTimeout(() => {if(generation === accountGeneration) resumeHandsFree();},250);
 };
 try { current.start(); handsFreeRunning = true; ui['recording-status'].textContent = 'Hands-free listening'; syncVoiceControl(); }
 catch { handsFreeRecognition = null; handsFreeRunning = false; handsFreePaused = true; syncVoiceControl(); error('Hands-free could not start. Select Listen to retry, or type.'); }
}
document.addEventListener('visibilitychange',() => {if(document.visibilityState === 'hidden') stopHandsFree(); else resumeHandsFree();});
for (const navId of ['desktop-nav','mobile-nav']) { for (const page of Object.keys(icons)) { const el = button('',page === activePage ? 'active' : '',() => switchPage(page)); el.dataset.page = page; const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true'); svg.innerHTML = icons[page]; el.append(svg,node('span','',page)); el.setAttribute('aria-current',page === activePage ? 'page' : 'false'); document.getElementById(navId).append(el); } }
document.querySelectorAll('[data-chat]').forEach(el => el.addEventListener('click',() => send(el.dataset.chat)));
ui.composer.addEventListener('submit',event => { event.preventDefault(); send(); });
ui.message.addEventListener('keydown',event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); } });
ui.message.addEventListener('input',() => {ui.message.style.height = 'auto'; ui.message.style.height = `${Math.min(ui.message.scrollHeight,140)}px`;});
ui.mute.addEventListener('click',() => { setMute(!muted); if (activePage === 'Settings') renderPanel(); });
function closePhotoOptions() { ui['photo-options'].hidden = true; ui.photo.setAttribute('aria-expanded','false'); }
ui.photo.addEventListener('click',() => { const open=ui['photo-options'].hidden; ui['photo-options'].hidden=!open; ui.photo.setAttribute('aria-expanded',String(open)); });
ui['take-photo'].addEventListener('click',() => { closePhotoOptions(); ui['camera-input'].click(); });
ui['upload-image'].addEventListener('click',() => { closePhotoOptions(); ui['photo-input'].click(); });
ui['photo-input'].addEventListener('change',() => uploadPhoto(ui['photo-input'].files[0]));
ui['camera-input'].addEventListener('change',() => uploadPhoto(ui['camera-input'].files[0]));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!ui['photo-options'].hidden){closePhotoOptions();ui.photo.focus();}}); ui['remove-photo'].addEventListener('click',() => removePhoto()); ui.voice.addEventListener('click',toggleVoice);
ui['start-preview'].addEventListener('click',async () => { ui['start-preview'].disabled = true; ui['start-preview'].textContent = 'Opening your space…'; ui['welcome-error'].textContent = ''; try { await api('/api/session',{method:'POST'}); showApp(await api('/api/state')); } catch(e) { ui['welcome-error'].textContent = e.message; } finally { ui['start-preview'].disabled = false; ui['start-preview'].textContent = 'Start private preview ↗'; } });
ui.account.addEventListener('click',async () => {
 if (window.Clerk?.session) {
  try { await api('/api/session',{method:'DELETE'}); await window.sciappSignOut(); showWelcomeAfterSignOut(); } catch(e) {error(e.message);}
 } else if (config?.clerkPublishableKey) await window.sciappSignIn();
});
function clearAccountWork() { journalUI.reset(); closePhotoOptions(); chatScroll.reset(); notificationBusy = false; pushServerStatus = null; pushStatus = {supported:false,enabled:false,permission:'unknown'}; accountGeneration++; voiceGeneration++; pendingRequests.forEach(controller => controller.abort()); pendingRequests.clear(); clearTimeout(approvalTimer); stopHandsFree(); handsFreePaused = false; if(recognition) {recognition.onend = null; recognition.abort(); recognition = null;} if(recorder?.state === 'recording') recorder.stop(); recorder = null; audioChunks = []; recordStream?.getTracks().forEach(track => track.stop()); resetRecording(); assistantSpeaking = false; window.speechSynthesis?.cancel(); uploadBusy = false; setBusy(false); revokeHistoricalPhotos(); removePhoto({deleteRemote:false}); state = null; ui.messages.replaceChildren(); ui.panel.replaceChildren(); ui.message.value = ''; ui.announcer.textContent = ''; ui.app.hidden = true; ui.welcome.hidden = false; switchPage('Conversation'); }
function showWelcomeAfterSignOut() {
 clearAccountWork(); state = null; ui.messages.replaceChildren(); ui.panel.replaceChildren(); ui.message.value = ''; window.speechSynthesis?.cancel(); ui.app.hidden = true; ui.welcome.hidden = false; ui.account.hidden = true;
}
window.sciappBeforeSignOut = () => disableNotifications(api);
window.sciappBeforeAuthChange = () => detachBrowserNotifications();
window.addEventListener('sciapp:auth-ready',() => { ui.account.hidden = false; ui.account.textContent = window.Clerk?.session ? 'Sign out' : 'Sign in'; });
window.addEventListener('sciapp:signed-out',showWelcomeAfterSignOut);
window.addEventListener('sciapp:auth-error',event => { const message = event.detail?.message || 'Sign-in is unavailable. Please try again.'; ui['welcome-error'].textContent = message; if (!ui.app.hidden) error(message); });
ui['sign-in'].addEventListener('click',async () => { if (window.sciappSignIn) await window.sciappSignIn(); else if (window.Clerk?.openSignIn) window.Clerk.openSignIn(); else ui['welcome-error'].textContent = 'Sign-in is not configured yet. You can explore the private synthetic preview.'; });
setMute(muted,false); ui['date-label'].textContent = new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'}).toUpperCase();
try { config = await api('/api/config'); if (config.clerkPublishableKey) { ui['sign-in'].hidden = false; window.dispatchEvent(new CustomEvent('sciapp:auth-config',{detail:config})); } try { showApp(await api('/api/state')); } catch(e) { if (e.status !== 401) ui['welcome-error'].textContent = e.message; ui.welcome.hidden = false; } }
catch(e) { ui.welcome.hidden = false; ui['welcome-error'].textContent = `Could not connect to sciapp. ${e.message}`; }
window.addEventListener('sciapp:signed-in',async () => { clearAccountWork(); ui.account.hidden = false; ui.account.textContent = 'Sign out'; try { showApp(await api('/api/state')); } catch(e) { ui['welcome-error'].textContent = e.message; } });
window.addEventListener('pagehide',() => { stopHandsFree(); revokeHistoricalPhotos(); recordStream?.getTracks().forEach(track => track.stop()); window.speechSynthesis?.cancel(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='sciapp:open-today' && state){switchPage('Today');api('/api/state').then(update).catch(e=>error(e.message));}});

watchNotificationPermission(()=>{if(state&&!notificationBusy)refreshNotificationStatus();});

function appendCareCheckIn(parent){
 const agenda=state.agenda;if(!agenda)return;
 const card=node('section','data-card care-check-in');card.setAttribute('aria-label','Current care reminders');
 card.append(node('h3','','Your care check-in'),node('p','',`As of ${agenda.localNow} (${agenda.timezone})`));
 if(agenda.next)card.append(node('p','',`Next: ${agenda.next.title} at ${formatTime(agenda.next.dueAt)}`));
 const due=agenda.overdue.filter(t=>!state.reminderSnoozes?.[t.id]||Date.parse(state.reminderSnoozes[t.id])<=Date.now());
 if(due.length)card.append(node('p','','These scheduled items have no confirmed record. Did you complete any of them?'));
 for(const task of due){const row=node('div','care-due');row.append(node('p','',`${task.title} · ${formatTime(task.dueAt)}`));
 if(task.kind==='medication'){
 row.append(button('I took this dose','secondary',()=>{const d=node('dialog','journal-dialog');d.append(node('h2','','When did you take it?'),node('p','',task.title));for(const [label,timing]of [['At the scheduled time','scheduled'],['Just now','now']])d.append(button(label,'primary',()=>{d.close();d.remove();reviewReminder(task,timing);}));d.append(button('Another time','secondary',()=>{d.close();d.remove();send(`I took ${task.title}, scheduled for ${task.dueAt}, at a different time. Ask me when.`);}));d.append(button('Cancel','secondary',()=>{d.close();d.remove();}));d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();}));
 row.append(button('Ask again in 30 minutes','secondary',async()=>{try{const r=await api('/api/reminders/snooze',{method:'POST',body:JSON.stringify({occurrenceId:task.id})});update(r.state);}catch(e){error(e.message);}}));
 }else row.append(chatButton('Record this catheterization',`Help me record catheterization scheduled for ${task.dueAt}. Ask whether I did it and the volume.`));card.append(row);}
 if(agenda.unscheduledMedications.length)card.append(node('p','',`No reminder times: ${agenda.unscheduledMedications.map(m=>m.name).join(', ')}. Tell me the times to add them.`));
 if(window.Clerk?.session&&!pushStatus.enabled)card.append(node('p','','This browser is not connected for notifications. Chat check-ins still work.'),button('Enable notifications on this device','primary',()=>notificationAction('enable')));
 card.append(node('p','answer-hint','Choose a button, or type or say anything else. A missing record does not mean a dose was missed.'));
 card.querySelectorAll('button').forEach(b=>{b.dataset.answerControl='true';b.disabled=busy||uploadBusy||recording;});
 parent.append(card);
}
async function reviewReminder(task,timing){if(busy)return;const generation=accountGeneration;setBusy(true);stopHandsFree();try{receive(await api('/api/reminders/review',{method:'POST',body:JSON.stringify({occurrenceId:task.id,timing})}));}catch(e){error(e.message);}finally{if(generation===accountGeneration){setBusy(false);resumeHandsFree();}}}
setInterval(async()=>{if(!state||busy||uploadBusy||recording||document.visibilityState!=='visible'||!['Conversation','Today'].includes(activePage)||ui.message.value.trim())return;try{const next=await api('/api/state');if(!busy&&!uploadBusy&&!recording&&['Conversation','Today'].includes(activePage)&&!ui.message.value.trim()&&!document.querySelector('dialog[open]'))update(next);}catch{}},60000);
