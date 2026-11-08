import { createClerkClient } from '@clerk/backend';
import { initialState, AppError, message, proposal, finishProposal, undoEvent, view, now, uid } from './domain.js';
import { handleKnown, interpret, analyzePhoto } from './conversation.js';
import { assets } from '../generated/assets.js';

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
async function bodyJSON(request) { if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new AppError('Expected JSON.', 415); try { return JSON.parse(new TextDecoder().decode(await boundedBody(request, 16000))); } catch (e) { if (e instanceof AppError) throw e; throw new AppError('Could not read the request.'); } }
async function form(request, max) { if(!(request.headers.get('content-type')||'').startsWith('multipart/form-data;')) throw new AppError('Expected a multipart upload.',415); const bytes = await boundedBody(request, max); return new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData(); }
async function load(env, id) { const row = await env.DB.prepare('SELECT state,version FROM accounts WHERE id=?').bind(id).first(); if (!row) throw new AppError('Your preview session has expired. Start a new preview.', 401); return { state: JSON.parse(row.state), version: row.version }; }
async function ensureAccount(env, id) { await env.DB.prepare('INSERT OR IGNORE INTO accounts (id,state,version,updated_at) VALUES (?,?,0,?)').bind(id, JSON.stringify(initialState()), now()).run(); }
async function store(env, id, state, version) {
  // Keep POC memory bounded without discarding the confirmed event ledger.
  state.messages = state.messages.slice(-100); state.proposals = state.proposals.slice(-100);
  const r = await env.DB.prepare('UPDATE accounts SET state=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(JSON.stringify(state), now(), id, version).run();
  if (r.meta.changes !== 1) throw new AppError('Another action updated your records. Refresh and try again; this action was not saved.', 409);
}
async function mutate(env, id, fn) { for (let attempt = 0; attempt < 4; attempt++) { const { state, version } = await load(env, id); const reply = fn(state); state.messages.push(reply); try { await store(env, id, state, version); return { reply, state: view(state) }; } catch (e) { if (e.status !== 409 || attempt === 3) throw e; } } }
async function user(request, env) {
  const pk = env.CLERK_PUBLISHABLE_KEY;
  if (pk && (request.headers.has('authorization') || /(?:^|;\s*)__session=/.test(request.headers.get('cookie') || ''))) {
    const client = createClerkClient({ publishableKey: pk, secretKey: env.CLERK_SECRET_KEY || undefined, jwtKey: env.CLERK_JWT_KEY || undefined });
    const auth = await client.authenticateRequest(request, { authorizedParties: [new URL(request.url).origin], acceptsToken: 'session_token' });
    const data = auth.toAuth(); if (!data?.userId) throw new AppError('Please sign in again.', 401);
    const id = `clerk:${data.userId}`; await ensureAccount(env, id); return id;
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
  if (row.count > max) throw new AppError('The daily preview limit has been reached. Please return tomorrow.', 429);
}
function attachmentOwner(state, photoId) { if (typeof photoId !== 'string' || !state.photos.some(p => p.id === photoId)) throw new AppError('Photo not found.', 404); }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url); const path = url.pathname;
    try {
      if (path === '/api/health') return json({ status: 'ok', version: '0.1.0', mode: 'synthetic-preview' });
      if (path === '/api/config' && request.method === 'GET') return json({ clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY || null, mode: env.CLERK_PUBLISHABLE_KEY ? 'authenticated' : 'preview', features: { photos: true, transcription: !!env.AI, speech: false, caregivers: 'drafts', healthConnect: false }, notice: 'Synthetic-data preview. No real medical records, clinical alarms, or delivered caregiver invitations.' });
      if (!path.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(request.method)) return json({ error: 'Method not allowed.' },405);
        const asset = assets[path === '/' ? '/index.html' : path];
        if (!asset) return new Response('Not found', { status: 404, headers: security });
        return new Response(request.method === 'HEAD' ? null : asset.body, { headers: { ...security, 'Content-Type': asset.type, 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com; connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com; img-src 'self' blob: data: https://img.clerk.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; frame-src https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" } });
      }
      if (request.method !== 'GET') {
        const origin = request.headers.get('origin');
        if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('Cross-site requests are not allowed.', 403);
      }
      if (path === '/api/session' && request.method === 'POST') {
        await limit(request, env, 'sessions', 30);
        // Keep an existing valid preview stable across a repeated welcome click.
        try { const id = await user(request, env); return json({ state: view((await load(env,id)).state) }); } catch (e) { if (e.status !== 401) throw e; }
        const id = `preview:${uid()}`, token = `${uid()}${uid()}`;
        await ensureAccount(env,id);
        await env.DB.prepare('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES (?,?,?)').bind(await hash(token),id,Date.now()+7*86400000).run();
        return json({ state: view((await load(env,id)).state) },200,{ 'Set-Cookie': `__Host-sciapp=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800` });
      }
      const id = await user(request, env);
      if (path === '/api/state' && request.method === 'GET') return json(view((await load(env,id)).state));
      if (path === '/api/session' && request.method === 'DELETE') { const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-sciapp=([^;]+)/)?.[1]; if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(token)).run(); return json({ok:true},200,{'Set-Cookie':'__Host-sciapp=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'}); }
      const action = path.match(/^\/api\/actions\/([a-f0-9-]+)$/);
      if (action && request.method === 'POST') { const data=await bodyJSON(request); return json(await mutate(env,id,s=>finishProposal(s,action[1],data.decision))); }
      const undo = path.match(/^\/api\/events\/([a-f0-9-]+)\/undo$/);
      if (undo && request.method === 'POST') return json(await mutate(env,id,s=>undoEvent(s,undo[1])));
      if (path === '/api/chat' && request.method === 'POST') {
        await limit(request,env,'chat',150);
        const data=await bodyJSON(request); const text=typeof data.message==='string'?data.message.trim():'';
        if ((!text && !data.photoId) || text.length>3000) throw new AppError('Enter a message up to 3,000 characters.');
        const {state,version}=await load(env,id);
        let photoData=null;
        if(data.photoId) { attachmentOwner(state,data.photoId); await limit(request,env,'ai',60); const file=await env.PHOTOS.get(`${id}/${data.photoId}`); if(!file)throw new AppError('Photo no longer available.',404); try{photoData=await analyzePhoto(env,file,text);}catch{photoData={type:'other',notes:'AI could not read it reliably. You can enter the details.'};} }
        const userMessage=message('user',text||'Photo attached',data.photoId?{photoId:data.photoId,photoUrl:`/api/photos/${data.photoId}`}:{ });
        state.messages.push(userMessage);
        let reply=handleKnown(state,text,photoData,data.photoId);
        if(reply?.approveId)reply=finishProposal(state,reply.approveId,'approve');
        else if(reply?.cancelId)reply=finishProposal(state,reply.cancelId,'cancel');
        else if(reply?.bagReading)reply=proposal(state,'bag',reply.bagReading);
        if(!reply) {
          await limit(request,env,'ai',60);
          try { const interpreted=await interpret(env,state,text);
            if(interpreted.kind==='action' && interpreted.action) reply=proposal(state,interpreted.action.kind,interpreted.action.params||{});
            else reply=message('assistant',String(interpreted.content||'What would you like to record?').slice(0,4000),{sources:interpreted.sources||[],options:['Log catheterization','Add supplies','Settings']});
          } catch(e) { if(e instanceof AppError)throw e; reply=message('assistant','The AI service is unavailable right now. You can still use the care logging buttons, record a reading, or enter supply counts.',{options:['Log catheterization','Add supplies','Record blood pressure']}); }
        }
        state.messages.push(reply); await store(env,id,state,version); return json({reply,state:view(state)});
      }
      if (path === '/api/photos' && request.method === 'POST') {
        await limit(request,env,'photos',30);
        const data=await form(request,5*1024*1024+16384), file=data.get('photo');
        if(!file || typeof file==='string' || file.size===0 || file.size>5*1024*1024)throw new AppError('Choose a photo smaller than 5 MB.');
        if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new AppError('Choose a JPEG, PNG, or WebP image.');
        const bytes=new Uint8Array(await file.arrayBuffer());
        const valid=(file.type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216)||(file.type==='image/png'&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)||(file.type==='image/webp'&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP');
        if(!valid)throw new AppError('The file does not match its image type.');
        const photoId=uid(); await env.PHOTOS.put(`${id}/${photoId}`,bytes,{httpMetadata:{contentType:file.type}});
        try { for(let attempt=0;attempt<4;attempt++){const {state,version}=await load(env,id);if(state.photos.length>=100)throw new AppError('Preview photo storage is full. Delete a photo first.',409);state.photos.push({id:photoId,type:file.type,createdAt:now()});try{await store(env,id,state,version);break;}catch(e){if(e.status!==409||attempt===3)throw e;}} } catch(e){await env.PHOTOS.delete(`${id}/${photoId}`);throw e;}
        return json({id:photoId,url:`/api/photos/${photoId}`});
      }
      const photo=path.match(/^\/api\/photos\/([a-f0-9-]+)$/);
      if(photo) {
        const {state,version}=await load(env,id);attachmentOwner(state,photo[1]);
        if(request.method==='GET'){const object=await env.PHOTOS.get(`${id}/${photo[1]}`);if(!object)throw new AppError('Photo not found.',404);return new Response(object.body,{headers:{...security,'Content-Type':object.httpMetadata.contentType,'Content-Disposition':'inline'}});}
        if(request.method==='DELETE'){state.photos=state.photos.filter(p=>p.id!==photo[1]);await store(env,id,state,version);await env.PHOTOS.delete(`${id}/${photo[1]}`);return json({ok:true});}
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
