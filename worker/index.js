import {appHelp,completeOnboarding} from './onboarding.js';
import {snoozeCareCheckIn,dismissReminders} from './care-checkin.js';
import {savePushDiagnostic} from './push-diagnostics.js';
import {extractPhotoCaptureTime,resolvePhotoCaptureTime} from './photo-metadata.js';
import {scheduledBagPhotoReview,bagPhotoTiming} from './photo-review.js';
import {medicationCheckInAction,applyMedicationSelectionDraft,medicationCheckInResume} from './medication-checkin.js';
import {journalQuery} from './journal.js';
import {updateProfile} from './profile.js';
import { questionChoices } from '../web/question-choices.js';
import { runCareAgent } from './care-orchestrator.js';
import { aiConfiguration } from './ai-config.js';
import { healthRoute, completeConnection, healthContext, processHealthJobs, healthMaintenance, listConnections, listRecords } from './health-systems.js';
import { retrievalReady, memoryChat, listMemory, forgetMemory, retrieveContext, archiveMessages, backfillMemory, processIndexJobs, seedResources, syncMemoryAccounts, resourceAdmin, addResource } from './retrieval.js';
import { executeCareTool, offlineCareReply } from './chat-tools.js';
import { processTranscriptions } from './resource-transcription.js';
import { resourceDownload } from './resource-files.js';
import { adminRoute } from './admin.js';
import { accountIdForSubject } from './identity.js';
import { createClerkClient } from '@clerk/backend';
import { initialState, AppError, message, proposal, finishProposal, undoEvent, view, now, uid } from './domain.js';
import { migratePersonalState } from './domain.js';
import { reminderTasks,careAgenda } from './reminders.js';
import { reminderChat, repairLegacyScheduleReview } from './reminder-chat.js';
import { subscribe, unsubscribe, pushStatus, testPush, dispatchReminders } from './push.js';
import { assistantAction } from './assistant-actions.js';
import { handleKnown, interpret, analyzePhoto, CHAT_MODEL, VISION_MODEL } from './conversation.js';
import { configuredOrigins, contentSecurityPolicy, canonicalHome } from './origins.js';
import { assets } from '../generated/assets.js';

function publicState(state) { return { ...view(state), reminderTasks: reminderTasks(state),agenda:careAgenda(state),medicationCheckInResume:medicationCheckInResume(state) }; }
const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()', 'Cache-Control': 'no-store' };
const json = (value, status = 200, extra = {}) => Response.json(value, { status, headers: { ...security, ...extra } });
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');

async function boundedBody(request, max) {
  if (Number(request.headers.get('content-length') || 0) > max) throw new AppError('This upload is too large.', 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const chunks = []; let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw new AppError('This upload is too large.', 413); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; } return bytes;
}
async function bodyJSON(request, max=16000) { if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new AppError('Expected JSON.', 415); try { return JSON.parse(new TextDecoder().decode(await boundedBody(request, max))); } catch (e) { if (e instanceof AppError) throw e; throw new AppError('Could not read the request.'); } }
async function form(request, max) { if(!(request.headers.get('content-type')||'').startsWith('multipart/form-data;')) throw new AppError('Expected a multipart upload.',415); const bytes = await boundedBody(request, max); return new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData(); }
async function load(env, id) {
 for (let attempt=0;attempt<4;attempt++) {
  const row=await env.DB.prepare('SELECT state,version FROM accounts WHERE id=?').bind(id).first();
  if(!row)throw new AppError('Your session has expired. Sign in or start a new preview.',401);
  const state=JSON.parse(row.state),before=JSON.stringify(state);
  if(id.startsWith('clerk:')){migratePersonalState(state);repairLegacyScheduleReview(state);}
  if(JSON.stringify(state)!==before){
   const r=await env.DB.prepare('UPDATE accounts SET state=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(JSON.stringify(state),now(),id,row.version).run();
   if(r.meta.changes!==1)continue;
   return {state,version:row.version+1};
  }
  return {state,version:row.version};
 }
 throw new AppError('Another action updated your records. Please retry.',409);
}
async function ensureAccount(env,id) { await env.DB.prepare('INSERT OR IGNORE INTO accounts (id,state,version,updated_at) VALUES (?,?,0,?)').bind(id,JSON.stringify(initialState({real:id.startsWith('clerk:')})),now()).run(); }
async function store(env, id, state, version) {
  // Keep POC memory bounded without discarding the confirmed event ledger.
  state.messages = state.messages.slice(-100); state.proposals = state.proposals.slice(-100);
  const r = await env.DB.prepare('UPDATE accounts SET state=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(JSON.stringify(state), now(), id, version).run();
  if (r.meta.changes !== 1) throw new AppError('Another action updated your records. Refresh and try again; this action was not saved.', 409);
}
async function mutate(env, id, fn) { for (let attempt = 0; attempt < 4; attempt++) { const { state, version } = await load(env, id); const reply = fn(state); state.messages.push(reply); try { await store(env, id, state, version); return { reply, state: publicState(state) }; } catch (e) { if (e.status !== 409 || attempt === 3) throw e; } } }
async function user(request, env) {
  const pk = env.CLERK_PUBLISHABLE_KEY;
  if (pk && (request.headers.has('authorization') || /(?:^|;\s*)__session=/.test(request.headers.get('cookie') || ''))) {
    const client = createClerkClient({ publishableKey: pk, secretKey: env.CLERK_SECRET_KEY || undefined, jwtKey: env.CLERK_JWT_KEY || undefined });
    const auth = await client.authenticateRequest(request, { authorizedParties: [new URL(request.url).origin], acceptsToken: 'session_token' });
    const data = auth.toAuth(); if (!data?.userId) throw new AppError('Please sign in again.', 401);
    const id = await accountIdForSubject(env.DB,data.userId); await ensureAccount(env, id); return id;
  }
  const token = (request.headers.get('cookie') || '').match(/(?:^|;\s*)__Host-sciapp=([^;]+)/)?.[1];
  if (!token) throw new AppError('Start a private preview or sign in first.', 401);
  const row = await env.DB.prepare('SELECT account_id FROM sessions WHERE token_hash=? AND expires_at>?').bind(await hash(token), Date.now()).first();
  if (!row) throw new AppError('Your preview session has expired. Start a new preview.', 401);
  return row.account_id;
}
async function limit(request, env, scope, max) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const key = `${scope}:${await hash(ip)}:${new Date().toISOString().slice(0,10)}`;
  const row = await env.DB.prepare('INSERT INTO rate_limits(id,count,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(key, Date.now() + 2*86400000).first();
  if (row.count > max) throw new AppError('The daily request limit has been reached. Please return tomorrow.', 429);
}
function attachmentOwner(state, photoId) { if (typeof photoId !== 'string' || !state.photos.some(p => p.id === photoId)) throw new AppError('Photo not found.', 404); }

export default {
  async scheduled(controller,env,ctx) { if(env.HEALTH_TOKEN_KEY)ctx.waitUntil(healthMaintenance(env)); ctx.waitUntil(dispatchReminders(env,controller.scheduledTime)); ctx.waitUntil(processTranscriptions(env)); ctx.waitUntil((async()=>{if(retrievalReady(env)){await seedResources(env);await syncMemoryAccounts(env);await processIndexJobs(env,8);}})()); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url); const path = url.pathname;
    try {
      if (!configuredOrigins(env,url.origin).includes(url.origin))return json({error:'This hostname is not configured for SCIapp.'},421);
      const canonical=canonicalHome(request,env);
      if(canonical)return new Response(null,{status:302,headers:{...security,Location:canonical}});
      if (path === '/api/health') {const {settings}=await aiConfiguration(env);return json({ status:'ok',version:'0.11.9',chatModel:settings.provider==='openai'?settings.chatModel:CHAT_MODEL,visionModel:settings.provider==='openai'?settings.visionModel:VISION_MODEL,provider:settings.provider,mode:'personal-beta' });}
      if (path === '/api/config' && request.method === 'GET') return json({ appOrigin:env.APP_ORIGIN||url.origin, clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY || null, authEnvironment: env.CLERK_PUBLISHABLE_KEY?.startsWith('pk_live_') ? 'production' : 'development', pushPublicKey:env.VAPID_PUBLIC_KEY||null, mode: env.CLERK_PUBLISHABLE_KEY ? 'authenticated' : 'preview', features: { notifications: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),notificationDiagnostics:true, memory:retrievalReady(env), resources:retrievalReady(env), medications:true, photos: true, transcription: !!env.AI, speech: false, caregivers: 'drafts', healthSystems:!!env.HEALTH_TOKEN_KEY, healthConnect: false }, notice: 'Personal care beta. Medication and allergy records are user-entered. Notifications are reminders, not guaranteed clinical alarms. Caregiver invitations remain drafts.' });
      if (!path.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(request.method)) return json({ error: 'Method not allowed.' },405);
        const asset = assets[({ '/':'/index.html', '/privacy':'/privacy.html', '/terms':'/terms.html', '/admin':'/admin.html', '/admin/':'/admin.html' })[path] || path];
        if (!asset) return new Response('Not found', { status: 404, headers: security });
        return new Response(request.method === 'HEAD' ? null : asset.base64?Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0)):asset.body, { headers: { ...security, 'Content-Type': asset.type, 'Content-Security-Policy': contentSecurityPolicy(env.CLERK_PUBLISHABLE_KEY) } });
      }
      if (request.method !== 'GET') {
        const origin = request.headers.get('origin');
        if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('Cross-site requests are not allowed.', 403);
      }
      if (path === '/api/session' && request.method === 'POST') {
        await limit(request, env, 'sessions', 30);
        // Keep an existing valid preview stable across a repeated welcome click.
        try { const id = await user(request, env); return json({ state: publicState((await load(env,id)).state) }); } catch (e) { if (e.status !== 401) throw e; }
        const id = `preview:${uid()}`, token = `${uid()}${uid()}`;
        await ensureAccount(env,id);
        await env.DB.prepare('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES (?,?,?)').bind(await hash(token),id,Date.now()+7*86400000).run();
        return json({ state: publicState((await load(env,id)).state) },200,{ 'Set-Cookie': `__Host-sciapp=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800` });
      }
      if(path.startsWith('/api/admin/'))return await adminRoute(request,env,ctx,{json,bodyJSON:r=>bodyJSON(r,600000),form,version:'0.11.9'});
      if(path==='/api/health-systems/callback'&&request.method==='GET'){
        if(!env.HEALTH_TOKEN_KEY)throw new AppError('Health connections are not configured.',503);
        const result=await completeConnection(env,request);return new Response(null,{status:303,headers:{...security,Location:env.APP_ORIGIN+'/?health='+(result.cancelled?'cancelled':'connected'),'Set-Cookie':result.cookie}});
      }
      const id = await user(request, env);
      if(path.startsWith('/api/health-systems/')){if(!env.HEALTH_TOKEN_KEY)throw new AppError('Health connections are not configured.',503);await limit(request,env,'health-systems',300);return await healthRoute(request,env,id,{json,bodyJSON,ctx});}
      if(path==='/api/help'&&request.method==='POST'){const data=await bodyJSON(request);return json(await mutate(env,id,()=>appHelp(data.topic)));}
      if(path==='/api/onboarding'&&request.method==='POST'){const data=await bodyJSON(request);if(data.action!=='complete')throw new AppError('Choose a supported onboarding action.');return json(await mutate(env,id,state=>completeOnboarding(state)));}
      if(path==='/api/medication-checkin'&&request.method==='POST'){const data=await bodyJSON(request);if(!['all','some','select','time','later','cancel','resume'].includes(data.action))throw new AppError('Choose a medication check-in action.');if(['select','time'].includes(data.action)&&(!data.checkInId||!Number.isInteger(data.revision)))throw new AppError('Use the current medication question.',409);if(data.time||data.timeRef||data.timing&& !['scheduled','now'].includes(data.timing))throw new AppError('Tell the companion a different actual time, or choose a suggested time.');return json(await mutate(env,id,state=>{const reply=medicationCheckInAction(state,data);state.messages.push(message('user',({all:'Took them all',some:'Took only some',select:'These are the medicines I took',time:data.timing==='scheduled'?'On time':'Just now',later:'Not yet, ask again later',cancel:'Cancel medication check-in',resume:'Continue my medication check-in'})[data.action]));return reply;}));}
      if(path==='/api/reminders/review'&&request.method==='POST'){const data=await bodyJSON(request);if(!['scheduled','now'].includes(data.timing))throw new AppError('Choose when you took the dose.');return json(await mutate(env,id,state=>{const task=reminderTasks(state).find(t=>t.id===data.occurrenceId&&t.kind==='medication'&&Date.parse(t.dueAt)<=Date.now());if(!task)throw new AppError('This dose is no longer awaiting a record. Refresh your tasks.',409);return proposal(state,'medication',{medicationId:task.medicationId,scheduledFor:task.dueAt,time:data.timing==='scheduled'?task.dueAt:now()});}));}
      if(path==='/api/reminders/dismiss'&&request.method==='POST'){const data=await bodyJSON(request);return json(await mutate(env,id,state=>dismissReminders(state,data)));}
      if(path==='/api/reminders/snooze-checkin'&&request.method==='POST'){const data=await bodyJSON(request);return json(await mutate(env,id,state=>snoozeCareCheckIn(state,data)));}
      if(path==='/api/reminders/snooze'&&request.method==='POST'){const data=await bodyJSON(request);return json(await mutate(env,id,state=>{const task=reminderTasks(state).find(t=>t.id===data.occurrenceId&&Date.parse(t.dueAt)<=Date.now());if(!task)throw new AppError('This reminder is no longer due.',409);state.reminderSnoozes=Object.fromEntries(Object.entries(state.reminderSnoozes||{}).filter(([,v])=>Date.parse(v)>Date.now()));state.reminderSnoozes[task.id]=new Date(Date.now()+1800000).toISOString();return message('assistant','I will show this check-in again in 30 minutes while the app is open, or when you next return. No dose was recorded.');}));}
      if(path==='/api/profile'&&request.method==='POST'){const data=await bodyJSON(request);for(let attempt=0;;attempt++){const {state,version}=await load(env,id);updateProfile(state,data);try{await store(env,id,state,version);return json({state:publicState(state)});}catch(e){if(e.status!==409||attempt===3)throw e;}}}
      if(path==='/api/journal'&&request.method==='POST')return json(journalQuery((await load(env,id)).state,await bodyJSON(request)));
      if (path === '/api/state' && request.method === 'GET') return json(publicState((await load(env,id)).state));
      if (path === '/api/session' && request.method === 'DELETE') { const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-sciapp=([^;]+)/)?.[1]; if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(token)).run(); return json({ok:true},200,{'Set-Cookie':'__Host-sciapp=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'}); }
      if (path.startsWith('/api/push/')) {
        if(!id.startsWith('clerk:'))throw new AppError('Sign in to enable personal notifications.',403);
        if(path==='/api/push/diagnostics'&&request.method==='POST'){await limit(request,env,'push-diagnostics',300);await savePushDiagnostic(env,id,await bodyJSON(request));return json({ok:true});}
        if(path==='/api/push/status'&&request.method==='GET')return json({...(await pushStatus(env,id)),enabled:(await load(env,id)).state.settings.notificationsEnabled===true});
        if(path==='/api/push/status'&&request.method==='POST'){const data=await bodyJSON(request);return json(await pushStatus(env,id,data.endpoint));}
        if(!env.VAPID_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY)throw new AppError('Notifications are not configured on the server.',503);
        if(path==='/api/push/subscriptions'&&request.method==='POST'){
          await limit(request,env,'push-register',30);const data=await bodyJSON(request);
          if(data.timezone){try{new Intl.DateTimeFormat('en-US',{timeZone:data.timezone}).format();}catch{throw new AppError('Please choose a valid timezone.');}}
          await subscribe(env,id,data.subscription);
          const result=await mutate(env,id,state=>{state.settings.notificationsEnabled=true;if(!state.settings.timezoneConfirmed&&data.timezone)state.settings.timezone=data.timezone;return message('assistant',`Notifications are enabled on this device. Reminder timezone: ${state.settings.timezone}. Add exact medication times or set catheter reminders to schedule alerts.`,{options:['Set medication reminders','Set catheter reminders','Send test notification']});});
          return json({ok:true,...result});
        }
        if(path==='/api/push/subscriptions'&&request.method==='DELETE'){const data=await bodyJSON(request);await unsubscribe(env,id,data.endpoint);return json({ok:true});}
        if(path==='/api/push/test'&&request.method==='POST'){await limit(request,env,'push-test',20);const data=await bodyJSON(request);return json(await testPush(env,id,data.endpoint));}
      }
      const resourceFile=path.match(/^\/api\/resources\/files\/(u-[a-f0-9-]+)$/);if(resourceFile&&request.method==='GET')return await resourceDownload(env,resourceFile[1]);
      if(path.startsWith('/api/memory') || path.startsWith('/api/resources')) {
        if(!retrievalReady(env))throw new AppError('Memory retrieval is not configured.',503);
        if(path==='/api/resources' && request.method==='GET')return json({admin:await resourceAdmin(env,id),resources:(await env.DB.prepare("SELECT id,title,url,created_at FROM retrieval_sources WHERE scope='shared' AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM resource_publication WHERE source_id=retrieval_sources.id AND status!='published') ORDER BY created_at DESC").all()).results});
        if(path==='/api/resources' && request.method==='POST'){await limit(request,env,'resource-publish',20);const result=await addResource(env,id,await bodyJSON(request));ctx.waitUntil(processIndexJobs(env,8));return json(result,201);}
        if(!id.startsWith('clerk:'))throw new AppError('Sign in to use personal memory.',403);
        if(path==='/api/memory' && request.method==='GET'){await backfillMemory(env,id,(await load(env,id)).state);ctx.waitUntil(processIndexJobs(env));return json(await listMemory(env,id));}
        if(path==='/api/memory/settings' && request.method==='POST'){throw new AppError('Personal memory is always on for signed-in users.',409);}
        if(path==='/api/memory' && request.method==='DELETE'){const data=await bodyJSON(request);if(data.confirm!==true)throw new AppError('Confirm clearing your memories.');await forgetMemory(env,id);ctx.waitUntil(processIndexJobs(env));return json({ok:true});}
        const target=path.match(/^\/api\/memory\/(m-[a-f0-9]+)$/);if(target&&request.method==='DELETE'){await forgetMemory(env,id,target[1]);ctx.waitUntil(processIndexJobs(env));return json({ok:true});}
        if(path==='/api/memory/search' && request.method==='POST'){await limit(request,env,'memory-search',50);const data=await bodyJSON(request);if(typeof data.query!=='string'||!data.query.trim()||data.query.length>2000)throw new AppError('Enter a search up to 2,000 characters.');return json(await retrieveContext(env,id,data.query));}
      }
      if(path==='/api/account/export'&&request.method==='GET')return json({...publicState((await load(env,id)).state),...(env.HEALTH_TOKEN_KEY&&id.startsWith('clerk:')?{healthConnections:await listConnections(env,id),importedHealthRecords:await listRecords(env,id)}:{}),...(retrievalReady(env)&&id.startsWith('clerk:')?{personalMemory:await listMemory(env,id,true)}:{})},200,{'Content-Disposition':'attachment; filename="sciapp-records.json"'});
      const action = path.match(/^\/api\/actions\/([a-f0-9-]+)$/);
      if (action && request.method === 'POST') { const data=await bodyJSON(request); return json(await mutate(env,id,s=>finishProposal(s,action[1],data.decision))); }
      const undo = path.match(/^\/api\/events\/([a-f0-9-]+)\/undo$/);
      if (undo && request.method === 'POST') return json(await mutate(env,id,s=>undoEvent(s,undo[1])));
      if (path === '/api/chat' && request.method === 'POST') {
        await limit(request,env,'chat',150);
        const data=await bodyJSON(request); const text=typeof data.message==='string'?data.message.trim():'';
        if ((!text && !data.photoId) || text.length>3000) throw new AppError('Enter a message up to 3,000 characters.');
        const {state,version}=await load(env,id);
        if(data.medicationSelection)applyMedicationSelectionDraft(state,data.medicationSelection);
        if(data.responseToQuestion){const latest=[...state.messages].reverse().find(m=>m.role==='assistant');if(typeof data.responseToQuestion!=='string'||questionChoices(latest||{}).reference!==data.responseToQuestion)throw new AppError('That question has changed. Use the latest answer buttons, or type or speak your answer.',409);}
        let photoData=null;
        if(data.photoId) { attachmentOwner(state,data.photoId); await limit(request,env,'ai',60); const file=await env.PHOTOS.get(`${id}/${data.photoId}`); if(!file)throw new AppError('Photo no longer available.',404); try{photoData=await analyzePhoto(env,file,text);}catch{console.warn(JSON.stringify({event:'photo_interpretation_failed',model:VISION_MODEL}));photoData={type:'other',notes:'The image-processing service did not complete. Your photo is saved; please retry or enter the reading.'};} }
        if(data.photoId){const metadata=state.photos.find(p=>p.id===data.photoId);if(!Object.hasOwn(metadata,'captureTime')){const original=await env.PHOTOS.get(`${id}/${data.photoId}`);if(original)metadata.captureTime=extractPhotoCaptureTime(new Uint8Array(await original.arrayBuffer()));}photoData={...photoData,captureTime:resolvePhotoCaptureTime(metadata.captureTime,state.settings.timezone||'UTC')};metadata.analysis=photoData;metadata.userText=text;metadata.analyzedAt=now();}
        if(photoData?.type==='bag'){const timing=bagPhotoTiming(state,photoData);if(timing)photoData={...photoData,scheduleMatch:{scheduledClock:timing.match.clock,scheduledFor:timing.match.dueAt,photoTime:timing.time,note:timing.assumption}};}
        const userMessage=message('user',text||'Photo attached',data.photoId?{photoId:data.photoId,photoUrl:`/api/photos/${data.photoId}`}:{ });
        state.messages.push(userMessage);
        let reply=data.photoId?scheduledBagPhotoReview(state,text,photoData,data.photoId):null;
        if(reply){}
        else if(env.AI||env.OPENAI_API_KEY){
          await limit(request,env,'ai',150);
          try{let context={sources:[]}; const health=await healthContext(env,id);try{context=await retrieveContext(env,id,text);}catch{console.warn(JSON.stringify({event:'retrieval_unavailable'}));}
            reply=await runCareAgent(env,id,state,text,{memories:context.memories||[],sources:(context.sources||[]).map(s=>({...s,text:s.body})),photoData,photoId:data.photoId,health});
          }catch(error){if(error instanceof AppError){reply=message('assistant',error.message,{options:['Set catheter reminders','Log catheterization']});}else{console.warn(JSON.stringify({event:'conversation_model_unavailable'}));reply=offlineCareReply(state,text,photoData,data.photoId);reply.content='I am using limited offline controls because the AI request did not complete. '+reply.content;}}
        }else reply=offlineCareReply(state,text,photoData,data.photoId);
        if(reply?.bagReading)reply=proposal(state,'bag',reply.bagReading);

        if(reply?.healthJob)ctx.waitUntil(processHealthJobs(env));
        reply.agenda=careAgenda(state);
        delete reply.toolError;state.messages.push(reply); await store(env,id,state,version);
        ctx.waitUntil((async()=>{try{await backfillMemory(env,id,state);await archiveMessages(env,id,[userMessage]);await processIndexJobs(env);}catch{console.warn(JSON.stringify({event:'memory_archive_retry_needed'}));}})());
        return json({reply,state:publicState(state)});
      }
      if (path === '/api/photos' && request.method === 'POST') {
        await limit(request,env,'photos',30);
        const data=await form(request,5*1024*1024+16384), file=data.get('photo');
        if(!file || typeof file==='string' || file.size===0 || file.size>5*1024*1024)throw new AppError('Choose a photo smaller than 5 MB.');
        if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new AppError('Choose a JPEG, PNG, or WebP image.');
        const bytes=new Uint8Array(await file.arrayBuffer());
        const valid=(file.type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216)||(file.type==='image/png'&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)||(file.type==='image/webp'&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP');
        if(!valid)throw new AppError('The file does not match its image type.');
        const captureTime=extractPhotoCaptureTime(bytes);const photoId=uid(); await env.PHOTOS.put(`${id}/${photoId}`,bytes,{httpMetadata:{contentType:file.type}});
        try { for(let attempt=0;attempt<4;attempt++){const {state,version}=await load(env,id);if(!id.startsWith('clerk:')&&state.photos.length>=100)throw new AppError('Preview photo storage is full. Sign in for your personal journal.',409);state.photos.push({id:photoId,type:file.type,byteSize:file.size,captureTime,createdAt:now()});try{await store(env,id,state,version);break;}catch(e){if(e.status!==409||attempt===3)throw e;}} } catch(e){await env.PHOTOS.delete(`${id}/${photoId}`);throw e;}
        return json({id:photoId,url:`/api/photos/${photoId}`,captureTime});
      }
      const photo=path.match(/^\/api\/photos\/([a-f0-9-]+)$/);
      if(photo) {
        const {state,version}=await load(env,id);attachmentOwner(state,photo[1]);
        if(request.method==='GET'){const object=await env.PHOTOS.get(`${id}/${photo[1]}`);if(!object)throw new AppError('Photo not found.',404);return new Response(object.body,{headers:{...security,'Content-Type':object.httpMetadata.contentType,'Content-Disposition':'inline'}});}
        if(request.method==='DELETE'){if(state.careObservation?.photoId===photo[1])delete state.careObservation;for(const review of state.proposals)if(review.status==='pending'&&review.params.photoId===photo[1]){review.status='cancelled';for(const m of state.messages)if(m.proposal?.id===review.id)m.proposal.status='cancelled';}state.photos=state.photos.filter(p=>p.id!==photo[1]);await store(env,id,state,version);await env.PHOTOS.delete(`${id}/${photo[1]}`);return json({ok:true});}
      }
      if(path==='/api/transcribe'&&request.method==='POST'){
        if(!env.AI)throw new AppError('Transcription is not connected. Please type your message.',503);
        await limit(request,env,'ai',60);
        const data=await form(request,10*1024*1024+16384), file=data.get('audio');
        if(!file||typeof file==='string'||!file.size||file.size>10*1024*1024)throw new AppError('Record a short voice message, up to 10 MB.');
        const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        const result=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{audio:btoa(binary)});
        return json({text:String(result.text||'').slice(0,3000)});
      }
      return json({error:'Not found.'},404);
    } catch(error) {
      const status=error instanceof AppError?error.status:500;
      if(status===500 && env.DEBUG==='true') console.error(error.stack);
      if(status===500)console.error(JSON.stringify({event:'request_failed',path:path.replace(/[a-f0-9-]{36}/g,':id'),code:error?.name||'Error'}));
      return json({error:status===500?'Something went wrong. Nothing is confirmed unless you see a saved entry. Please try again.':error.message},status);
    }
  },
};
