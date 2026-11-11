import { aiDefaults, aiConfiguration, prepareAISettings, discoverModels } from './ai-config.js';
import { configureClient, clientStatus } from './health-systems.js';
import { refreshDirectory } from './health-providers.js';
import { processTranscriptions } from './resource-transcription.js';
import { uploadResource, materialInput, resourceDownload, reextractUpload, MAX_FILE_BYTES } from './resource-files.js';
import { saveFigure, listFigures, deleteFigures, figureDownload, MAX_FIGURE_BYTES } from './resource-figures.js';
import { AppError, now, uid } from './domain.js';
import { processIndexJobs, chunkInsertStatements } from './retrieval.js';
export const ADMIN_COOKIE='__Host-sciapp-admin';
export const defaults={retrievalThreshold:0.65,resourceReviewDays:180};
const bytes=text=>new TextEncoder().encode(text);
const hex=data=>[...new Uint8Array(data)].map(v=>v.toString(16).padStart(2,'0')).join('');
const unhex=text=>Uint8Array.from(text.match(/../g)||[],v=>parseInt(v,16));
export const hash=async text=>hex(await crypto.subtle.digest('SHA-256',bytes(text)));
const equal=async(a,b)=>crypto.subtle.timingSafeEqual(await crypto.subtle.digest('SHA-256',bytes(a)),await crypto.subtle.digest('SHA-256',bytes(b)));
export async function verifyPassword(password,encoded){
 const spec=JSON.parse(encoded);if(spec.iterations!==100000||!/^([a-f0-9]{2}){16,32}$/.test(spec.salt)||!/^[a-f0-9]{64}$/.test(spec.hash))throw Error('Invalid administrator configuration');
 const key=await crypto.subtle.importKey('raw',bytes(password),'PBKDF2',false,['deriveBits']);
 const result=await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(spec.salt),iterations:spec.iterations,hash:'SHA-256'},key,256);
 return equal(hex(result),spec.hash);
}
const cookie=token=>`${ADMIN_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${token?14400:0}`;
async function session(request,env){
 const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-sciapp-admin=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(!token||!env.ADMIN_PASSWORD_HASH)return null;
 return env.DB.prepare('SELECT token_hash,csrf_token FROM admin_sessions WHERE token_hash=? AND expires_at>? AND auth_version=?').bind(await hash(token),Date.now(),await hash(env.ADMIN_PASSWORD_HASH)).first();
}
export async function systemSettings(env){const row=await env.DB.prepare("SELECT value_json,version FROM system_settings WHERE id='general'").first();return {settings:{...defaults,...(row?JSON.parse(row.value_json):{})},version:row?.version||0};}
const audit=(env,action,target=null)=>env.DB.prepare('INSERT INTO admin_audit VALUES(?,?,?,?,?)').bind(uid(),'admin',action,target,now());
async function throttle(request,env){
 const ip=await hash(request.headers.get('CF-Connecting-IP')||'local');
 for(const [key,max] of [[`admin-login:${ip}:${Math.floor(Date.now()/900000)}`,10],[`admin-login:global:${Math.floor(Date.now()/3600000)}`,100]]){
  const row=await env.DB.prepare('INSERT INTO rate_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(key,Date.now()+86400000).first();
  if(row.count>max)throw new AppError('Too many sign-in attempts. Please try again later.',429);
 }
}
export async function adminRoute(request,env,ctx,{json,bodyJSON,form,version}){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/admin/'))return null;
 const mutation=!['GET','HEAD'].includes(request.method);
 if(mutation&&request.headers.get('origin')!==url.origin)throw new AppError('Same-origin request required.',403);
 if(path==='/api/admin/login'&&request.method==='POST'){
  if(!env.ADMIN_PASSWORD_HASH)throw new AppError('Administrator sign-in is not configured.',503);
  await throttle(request,env);const data=await bodyJSON(request);
  if(!data||typeof data.username!=='string'||typeof data.password!=='string'||data.password.length>256||data.username.length>100)throw new AppError('Invalid username or password.',401);
  const passwordValid=await verifyPassword(data.password,env.ADMIN_PASSWORD_HASH);const nameValid=await equal(data.username,'admin');
  if(!passwordValid||!nameValid){await audit(env,'login_failed').run();throw new AppError('Invalid username or password.',401);}
  const token=hex(crypto.getRandomValues(new Uint8Array(32))),csrf=hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.batch([env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<?').bind(Date.now()),env.DB.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?)').bind(await hash(token),csrf,await hash(env.ADMIN_PASSWORD_HASH),Date.now()+14400000),audit(env,'login')]);
  return json({username:'admin',csrfToken:csrf},200,{'Set-Cookie':cookie(token)});
 }
 const admin=await session(request,env);if(!admin)throw new AppError('Administrator sign-in required.',401);
 if(mutation&&!await equal(request.headers.get('X-Admin-CSRF')||'',admin.csrf_token))throw new AppError('Refresh the admin page before trying again.',403);
 if(path==='/api/admin/health-clients'&&request.method==='GET')return json(await clientStatus(env));
 if(path==='/api/admin/health-directory'&&request.method==='POST'){const count=await refreshDirectory(env,fetch,true);await audit(env,'health_directory_refresh').run();return json({count});}
 const healthClient=path.match(/^\/api\/admin\/health-clients\/(epic|epic-sandbox|oracle)$/);
 if(healthClient&&request.method==='PUT'){const result=await configureClient(env,healthClient[1],await bodyJSON(request));await audit(env,'health_client_configuration',healthClient[1]).run();return json(result);}
 if(path==='/api/admin/ai'&&request.method==='GET')return json(await aiConfiguration(env));
 if(path==='/api/admin/ai/models'&&request.method==='POST'){const d=await bodyJSON(request);return json(await discoverModels(env,d.settings,d.apiKey));}
 if(path==='/api/admin/ai'&&request.method==='PUT'){
  const d=await bodyJSON(request);if(!Number.isInteger(d?.version))throw new AppError('Refresh AI settings before saving.');const settings=await prepareAISettings(env,d.settings,d.apiKey);
  await env.DB.prepare("INSERT OR IGNORE INTO ai_configuration VALUES('main',?,0)").bind(JSON.stringify(aiDefaults)).run();
  const result=await env.DB.batch([env.DB.prepare("UPDATE ai_configuration SET value_json=?,version=version+1 WHERE id='main' AND version=?").bind(JSON.stringify(settings),d.version),audit(env,'ai_settings_update_attempt')]);
  if(result[0].meta.changes!==1)throw new AppError('AI settings changed in another session. Refresh before saving.',409);
  return json(await aiConfiguration(env));
 }
 if(path==='/api/admin/session'&&request.method==='GET')return json({username:'admin',csrfToken:admin.csrf_token});
 if(path==='/api/admin/logout'&&request.method==='POST'){await env.DB.batch([env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(admin.token_hash),audit(env,'logout')]);return json({ok:true},200,{'Set-Cookie':cookie('')});}
 if(path==='/api/admin/uploads'&&request.method==='POST'){
  const data=await form(request,MAX_FILE_BYTES+16384);const result=await uploadResource(env,data.get('file'));await audit(env,'resource_upload',result.id).run();if(result.extractionStatus==='processing')ctx.waitUntil(processTranscriptions(env,result.id));return json(result,201);
 }
 if(path==='/api/admin/uploads'&&request.method==='GET')return json({uploads:(await env.DB.prepare('SELECT id,file_name,mime_type,extraction_status,extraction_note,created_at FROM resource_uploads WHERE NOT EXISTS(SELECT 1 FROM resource_materials WHERE upload_id=resource_uploads.id) ORDER BY created_at DESC LIMIT 50').all()).results});
 const uploadStatus=path.match(/^\/api\/admin\/uploads\/(u-[a-f0-9-]+)\/status$/);
 if(uploadStatus&&request.method==='GET'){const row=await env.DB.prepare('SELECT id,file_name,mime_type,extraction_status,extracted_text,extraction_note FROM resource_uploads WHERE id=?').bind(uploadStatus[1]).first();if(!row)throw new AppError('Upload not found.',404);return json(row);}
 const reextract=path.match(/^\/api\/admin\/uploads\/(u-[a-f0-9-]+)\/extract$/);
 if(reextract&&request.method==='POST'){const row=await reextractUpload(env,reextract[1]);await audit(env,'resource_upload_reextract',reextract[1]).run();return json(row);}
 const figures=path.match(/^\/api\/admin\/uploads\/(u-[a-f0-9-]+)\/figures$/);
 if(figures&&request.method==='GET')return json({figures:await listFigures(env,figures[1])});
 if(figures&&request.method==='POST'){const result=await saveFigure(env,figures[1],await form(request,MAX_FIGURE_BYTES+16384));return json(result,201);}
 if(figures&&request.method==='DELETE'){const removed=await deleteFigures(env,figures[1]);await audit(env,'resource_figures_delete',figures[1]).run();return json({removed});}
 const figureImage=path.match(/^\/api\/admin\/figures\/(f-[a-f0-9-]+)$/);if(figureImage&&request.method==='GET')return figureDownload(env,figureImage[1],{admin:true});
 const upload=path.match(/^\/api\/admin\/uploads\/(u-[a-f0-9-]+)$/);
 if(upload&&request.method==='GET')return resourceDownload(env,upload[1],{admin:true});
 if(upload&&request.method==='DELETE'){
  if(await env.DB.prepare('SELECT source_id FROM resource_materials WHERE upload_id=? LIMIT 1').bind(upload[1]).first())throw new AppError('This file belongs to a saved resource and cannot be discarded.',409);
  const row=await env.DB.prepare('SELECT r2_key FROM resource_uploads WHERE id=?').bind(upload[1]).first();if(row){await deleteFigures(env,upload[1]);await env.DB.batch([env.DB.prepare('DELETE FROM resource_transcription_jobs WHERE upload_id=?').bind(upload[1]),env.DB.prepare('DELETE FROM resource_uploads WHERE id=?').bind(upload[1])]);await env.RESOURCES.delete(row.r2_key);await audit(env,'unused_upload_delete',upload[1]).run();}return json({ok:true});
 }
 if(path==='/api/admin/overview'&&request.method==='GET'){
  const queue=await env.DB.prepare("SELECT scope,COUNT(*) AS chunks,SUM(CASE WHEN indexed_at IS NULL AND deleted_at IS NULL THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN attempts>0 THEN 1 ELSE 0 END) AS retrying FROM retrieval_chunks GROUP BY scope").all();
  const config=await systemSettings(env);return json({appVersion:version,memoryPolicy:'Always on for every signed-in user',queue:queue.results,settings:config.settings,settingsVersion:config.version});
 }
 if(path==='/api/admin/settings'&&request.method==='PUT'){
  const d=await bodyJSON(request),s=d?.settings;
  if(!Number.isInteger(d?.version)||!s||Object.keys(s).some(k=>!Object.hasOwn(defaults,k))||typeof s.retrievalThreshold!=='number'||s.retrievalThreshold<0.6||s.retrievalThreshold>0.9||!Number.isInteger(s.resourceReviewDays)||s.resourceReviewDays<30||s.resourceReviewDays>730)throw new AppError('Use a retrieval threshold from 0.60 to 0.90 and a review interval from 30 to 730 days.');
  await env.DB.prepare("INSERT OR IGNORE INTO system_settings VALUES('general',?,0)").bind(JSON.stringify(defaults)).run();
  const result=await env.DB.batch([env.DB.prepare("UPDATE system_settings SET value_json=?,version=version+1 WHERE id='general' AND version=?").bind(JSON.stringify(s),d.version),audit(env,'settings_update_attempt')]);
  if(result[0].meta.changes!==1)throw new AppError('Settings changed in another session. Refresh before saving.',409);
  return json(await systemSettings(env));
 }
 if(path==='/api/admin/audit'&&request.method==='GET')return json({entries:(await env.DB.prepare('SELECT actor,action,target,created_at FROM admin_audit ORDER BY created_at DESC LIMIT 100').all()).results});
 if(path==='/api/admin/resources'&&request.method==='GET')return json({resources:(await env.DB.prepare("SELECT s.id,s.title,s.url,s.body,s.created_at,COALESCE(m.kind,'link') AS kind,COALESCE(m.text_kind,'summary') AS text_kind,m.upload_id,u.file_name,u.extraction_status,u.extraction_note,COALESCE(p.status,'published') AS status,p.reviewed_at,p.reviewed_by,COALESCE(p.version,0) AS version FROM retrieval_sources s LEFT JOIN resource_publication p ON p.source_id=s.id LEFT JOIN resource_materials m ON m.source_id=s.id LEFT JOIN resource_uploads u ON u.id=m.upload_id WHERE s.scope='shared' AND s.deleted_at IS NULL ORDER BY s.created_at DESC").all()).results});
 if(path==='/api/admin/resources'&&request.method==='POST'){
  const d=await materialInput(env,await bodyJSON(request)),id='r-'+uid();
  await env.DB.batch([env.DB.prepare("INSERT INTO retrieval_sources(id,scope,title,url,body,created_at) VALUES(?,'shared',?,?,?,?)").bind(id,d.title,d.url,d.text,now()),env.DB.prepare("INSERT INTO resource_publication(source_id,status,updated_at) VALUES(?,'draft',?)").bind(id,now()),env.DB.prepare('INSERT INTO resource_materials VALUES(?,?,?,?)').bind(id,d.kind,d.textKind,d.uploadId),audit(env,'resource_create_draft',id)]);
  return json({id},201);
 }
 const target=path.match(/^\/api\/admin\/resources\/((?:seed-[a-z0-9-]+|r-[a-f0-9-]+))(?:\/(publish|archive|review))?$/);
 if(target&&['PUT','POST'].includes(request.method)){
  const [,id,action]=target;const row=await env.DB.prepare("SELECT s.id,s.title,s.url,s.body,COALESCE(p.status,'published') AS status,COALESCE(p.version,0) AS version FROM retrieval_sources s LEFT JOIN resource_publication p ON p.source_id=s.id WHERE s.id=? AND s.scope='shared' AND s.deleted_at IS NULL").bind(id).first();
  if(!row)throw new AppError('Resource not found.',404);
  const data=await bodyJSON(request);if(data?.version!==row.version)throw new AppError('This resource changed. Reload before saving.',409);
  if(!action&&request.method==='PUT'){
   if(row.status!=='draft')throw new AppError('Published resources are immutable. Create a revised draft, then archive the previous resource.',409);
   const d=await materialInput(env,data),revision=uid();
   const changes=await env.DB.batch([env.DB.prepare("UPDATE resource_publication SET version=version+1,revision_id=?,updated_at=? WHERE source_id=? AND status='draft' AND version=?").bind(revision,now(),id,data.version),env.DB.prepare("UPDATE retrieval_sources SET title=?,url=?,body=? WHERE id=? AND EXISTS(SELECT 1 FROM resource_publication WHERE source_id=? AND revision_id=?)").bind(d.title,d.url,d.text,id,id,revision),env.DB.prepare('INSERT INTO resource_materials(source_id,kind,text_kind,upload_id) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM resource_publication WHERE source_id=? AND revision_id=?) ON CONFLICT(source_id) DO UPDATE SET kind=excluded.kind,text_kind=excluded.text_kind,upload_id=excluded.upload_id').bind(id,d.kind,d.textKind,d.uploadId,id,revision),audit(env,'resource_edit_draft_attempt',id)]);
   if(changes[0].meta.changes!==1)throw new AppError('This resource changed. Reload before saving.',409);
   return json({ok:true});
  }
  if(action&&request.method==='POST'){
   if(['publish','review'].includes(action)&&data.reviewed!==true)throw new AppError('Confirm that you reviewed this resource before publication.',400);
   if(action==='publish'&&row.status!=='draft')throw new AppError('Only drafts can be published.',409);
   if(action==='review'&&row.status!=='published')throw new AppError('Only published resources can be marked reviewed.',409);
   const status=action==='archive'?'archived':'published',stamp=now(),revision=uid();
   await env.DB.prepare('INSERT OR IGNORE INTO resource_publication(source_id,status,updated_at) VALUES(?,?,?)').bind(id,row.status,stamp).run();
   const statements=[env.DB.prepare('UPDATE resource_publication SET status=?,reviewed_at=CASE WHEN ?=\'published\' THEN ? ELSE reviewed_at END,reviewed_by=CASE WHEN ?=\'published\' THEN \'admin\' ELSE reviewed_by END,updated_at=?,version=version+1,revision_id=? WHERE source_id=? AND version=?').bind(status,status,stamp,status,stamp,revision,id,data.version)];
   if(action==='publish')statements.push(...chunkInsertStatements(env,id,row.body,'EXISTS(SELECT 1 FROM resource_publication WHERE source_id=? AND revision_id=?)',[id,revision]));
   statements.push(audit(env,`resource_${action}_attempt`,id));const changes=await env.DB.batch(statements);
   if(changes[0].meta.changes!==1)throw new AppError('This resource changed. Reload before saving.',409);
   ctx.waitUntil(processIndexJobs(env,8));return json({ok:true});
  }
 }
 throw new AppError('Administrator endpoint not found.',404);
}
