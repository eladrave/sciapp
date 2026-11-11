import {AppError,uid,now} from './domain.js';
import {careAgenda} from './reminders.js';
import {careInsights} from './insights.js';
// A person can let a caregiver follow their day. The owner creates a one-time link and passes it
// on themselves; the caregiver accepts it while signed in to their own account. Access is view
// only: today's due care, today's records, totals and supply warnings. Photos, the conversation,
// personal notes, medical imports and settings are never shared. Either side can end it.
const INVITE_DAYS=7,MAX_OPEN_INVITES=5,MAX_CAREGIVERS=10;
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const signedIn=id=>{if(typeof id!=='string'||!id.startsWith('clerk:'))throw new AppError('Sign in to share care with a caregiver.',403);};
const displayName=state=>state.profile?.fullName||(state.profile?.name&&state.profile.name!=='You'?state.profile.name:'')||'';
export async function createInvite(env,ownerId,at=Date.now()){
 signedIn(ownerId);
 await env.DB.prepare('DELETE FROM care_invites WHERE expires_at<=?').bind(at).run();
 const open=await env.DB.prepare('SELECT count(*) AS n FROM care_invites WHERE owner_account_id=?').bind(ownerId).first();
 if(open.n>=MAX_OPEN_INVITES)throw new AppError('You already have several unused invitation links. Cancel one before making another.',409);
 const people=await env.DB.prepare('SELECT count(*) AS n FROM care_access WHERE owner_account_id=?').bind(ownerId).first();
 if(people.n>=MAX_CAREGIVERS)throw new AppError('You have reached the number of caregivers that can follow your care.',409);
 const code=(uid()+uid()).replace(/-/g,''),expiresAt=at+INVITE_DAYS*86400000;
 await env.DB.prepare('INSERT INTO care_invites VALUES(?,?,?,?,?)').bind(await hash(code),ownerId,'follow',now(),expiresAt).run();
 return {code,expiresAt:new Date(expiresAt).toISOString()};
}
export async function acceptInvite(env,caregiverId,caregiverState,code,loadOwner,at=Date.now()){
 signedIn(caregiverId);
 if(typeof code!=='string'||!/^[a-f0-9]{64}$/.test(code))throw new AppError('This invitation link is not valid.',404);
 const invite=await env.DB.prepare('SELECT code_hash,owner_account_id,role,expires_at FROM care_invites WHERE code_hash=?').bind(await hash(code)).first();
 if(!invite||invite.expires_at<=at)throw new AppError('This invitation link has expired or was already used. Ask for a new one.',404);
 if(invite.owner_account_id===caregiverId)throw new AppError('This is your own invitation link. Send it to the person who will follow your care.',409);
 const id='ca-'+uid();
 // The link works once: it is removed in the same step that grants access.
 const [removed]=await env.DB.batch([env.DB.prepare('DELETE FROM care_invites WHERE code_hash=? AND expires_at>?').bind(invite.code_hash,at),env.DB.prepare('INSERT INTO care_access VALUES(?,?,?,?,?,?) ON CONFLICT(owner_account_id,caregiver_account_id) DO NOTHING').bind(id,invite.owner_account_id,caregiverId,invite.role,displayName(caregiverState)||'A caregiver',now())]);
 if(!removed.meta.changes)throw new AppError('This invitation link has expired or was already used. Ask for a new one.',404);
 const access=await env.DB.prepare('SELECT id FROM care_access WHERE owner_account_id=? AND caregiver_account_id=?').bind(invite.owner_account_id,caregiverId).first();
 return {accessId:access.id,name:displayName((await loadOwner(invite.owner_account_id)).state)||'this person'};
}
export async function listSharing(env,id,loadOwner,at=Date.now()){
 if(typeof id!=='string'||!id.startsWith('clerk:'))return {available:false,caregivers:[],caringFor:[],openInvites:0};
 const caregivers=(await env.DB.prepare('SELECT id,caregiver_name AS name,created_at AS since FROM care_access WHERE owner_account_id=? ORDER BY created_at').bind(id).all()).results;
 const rows=(await env.DB.prepare('SELECT id,owner_account_id,created_at AS since FROM care_access WHERE caregiver_account_id=? ORDER BY created_at').bind(id).all()).results;
 const caringFor=[];for(const row of rows)caringFor.push({id:row.id,since:row.since,name:displayName((await loadOwner(row.owner_account_id)).state)||'Someone you care for'});
 const open=await env.DB.prepare('SELECT count(*) AS n FROM care_invites WHERE owner_account_id=? AND expires_at>?').bind(id,at).first();
 return {available:true,caregivers,caringFor,openInvites:open.n};
}
export async function endSharing(env,id,accessId){
 const result=await env.DB.prepare('DELETE FROM care_access WHERE id=? AND (owner_account_id=? OR caregiver_account_id=?)').bind(accessId,id,id).run();
 if(!result.meta.changes)throw new AppError('This sharing was not found.',404);
 return {ok:true};
}
export async function cancelInvites(env,ownerId){await env.DB.prepare('DELETE FROM care_invites WHERE owner_account_id=?').bind(ownerId).run();return {ok:true};}
export async function removeAccountSharing(env,id){await env.DB.batch([env.DB.prepare('DELETE FROM care_invites WHERE owner_account_id=?').bind(id),env.DB.prepare('DELETE FROM care_access WHERE owner_account_id=? OR caregiver_account_id=?').bind(id,id)]);}
// What a caregiver sees. Built field by field so nothing new in the account is shared by accident.
export function sharedDay(state,at=Date.now()){
 const zone=state.settings?.timezone||'UTC',agenda=careAgenda(state,at),insights=careInsights(state,at);
 const day=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
 const clock=value=>new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(value));
 const task=t=>({title:t.title,time:clock(t.dueAt),status:t.status});
 const records=(state.events||[]).filter(e=>!e.voided&&['catheterization','bag','medication','medicationStatus','vitals','careLog','supplies'].includes(e.kind)&&day(Date.parse(e.occurredAt||e.createdAt))===agenda.localDate).map(e=>({title:e.title,detail:e.kind==='careLog'&&e.data?.note?String(e.detail||'').replace(e.data.note,'').replace(/( · )+/g,' · ').replace(/^ · | · $/g,''):e.detail,time:clock(e.occurredAt||e.createdAt)}));
 return {name:displayName(state)||'This person',timezone:zone,localNow:agenda.localNow,unconfirmed:agenda.overdue.map(task),upcoming:agenda.tasks.filter(t=>t.status==='upcoming'&&day(Date.parse(t.dueAt))===agenda.localDate).map(task),records,today:insights.today,supplyWarnings:insights.warnings};
}
export async function sharedDayFor(env,caregiverId,accessId,loadOwner){
 const access=await env.DB.prepare('SELECT owner_account_id FROM care_access WHERE id=? AND caregiver_account_id=?').bind(accessId,caregiverId).first();
 if(!access)throw new AppError('You no longer have access to this person\'s day.',404);
 return sharedDay((await loadOwner(access.owner_account_id)).state);
}
