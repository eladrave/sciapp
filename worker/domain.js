import {reminderTasks,careAgenda,catheterScheduleMatch,ROUTINE_TITLES} from './reminders.js';
import {careLogProposal} from './care-logs.js';
import { medicationKey, findMedication, parseCareList } from './medications.js';
import {profileFields,normalizeProfile,updateProfile} from './profile.js';
export const now = () => new Date(Date.now()).toISOString();
export const uid = () => crypto.randomUUID();
export function message(role, content, extra = {}) { return { id: uid(), role, content, createdAt: now(), ...extra }; }
export function initialState({ real = false } = {}) {
  return {
    profile: { name: 'You' }, schedulingSchemaVersion:1, careSchemaVersion: real ? 2 : 1, mode: real ? 'personal' : 'preview', medications: [], allergies: [],
    inventory: real ? [{ id: 'catheter', name: 'Catheters', count: null, unit: 'catheters' }] : [{ id: 'catheter', name: 'Example catheters', count: 60, unit: 'catheters' }, { id: 'medication', name: 'Example medication', count: 30, unit: 'tablets' }],
    events: [], caregivers: [], settings: { muted: true, handsFree: false, voicePauseMs: 5000, textScale: 1, catheterIntervalHours: 4, timezone: 'America/New_York', notificationsEnabled: false, catheterRemindersEnabled: false },
    messages: [message('assistant', real ? 'Welcome to your care space. Add your medication list and allergies, configure your own reminder times, or record care. Nothing is saved until you approve it.' : 'Welcome. This is your private SCI care preview, with example supplies and medication. What would you like to try? Please use sample information while we test.', { options: ['Log catheterization', 'Add supplies', 'Record medication', 'Invite a caregiver'] })],
    draft: null, photos: [], proposals: [], reminders: [],
  };
}
export function migratePersonalState(state) {
 if (state.careSchemaVersion === 2) return false;
 state.careSchemaVersion = 2; state.mode = 'personal'; state.medications ||= []; state.allergies ||= [];
 // Synthetic historical entries remain visible as history. They never seed real stock.
 state.inventory = state.inventory.filter(i => i.id !== 'medication');
 const catheter = state.inventory.find(i => i.id === 'catheter');
 if (catheter) { if(/^Example /i.test(catheter.name))catheter.name = 'Catheters'; catheter.count = null; for(const event of state.events)if(event.delta?.itemId==='catheter'){event.originalDelta=event.delta;event.delta=null;event.syntheticStock=true;} }
 for(const event of state.events)if(event.delta?.itemId==='medication'){event.originalDelta=event.delta;event.delta=null;event.syntheticStock=true;}
 for (const p of state.proposals) if (p.status === 'pending') { p.status = 'cancelled'; syncProposal(state, p); }
 state.draft = null;
 state.messages.push(message('assistant', 'Your signed-in care space now supports your own medication and allergy list. Example stock has been cleared; please enter your actual counts. Existing history is retained. Add your medications to begin.', {options:['Add medication', 'Show my medications']}));
 const lastList=[...state.messages].reverse().find(m=>m.role==='user'&&/^(?:current |my )?medications?\s*:?\s*\n/i.test(m.content||''));
 if(lastList && !state.medications.length){const parsed=parseCareList(lastList.content);if(parsed.medications.length && parsed.medications.length<=50 && parsed.allergies.length<=50 && !parsed.invalid.length && parsed.medications.every(m=>m.name.length<=200&&m.dosage.length<=200&&m.frequency.length<=200))state.messages.push(proposal(state,'carePlan',parsed));}
 return true;
}
export class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const string = (v, name, max = 300) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new AppError(`Please provide a valid ${name}.`); return v.trim(); };
const number = (v, name, min, max) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new AppError(`Please provide ${name} between ${min} and ${max}.`); return n; };
export function proposal(state, kind, params) {
  let title, details;
  if(kind==='medicationBatch'){
    const batch=medicationBatchParameters(state,params);params=batch;title=`Record medications for ${new Intl.DateTimeFormat('en-US',{timeZone:batch.timezone,hour:'numeric',minute:'2-digit'}).format(new Date(batch.scheduledFor))}`;
    const local=t=>new Intl.DateTimeFormat('en-US',{timeZone:batch.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(t));
    details=[`Scheduled: ${local(batch.scheduledFor)} (${batch.timezone})`,`Taken at: ${local(batch.time)} (${batch.timezone})`,...batch.items.map(m=>`${m.taken?'Taken':'Not taken yet'}: ${m.name} ${m.dosage}${m.taken?m.quantity==null?' (stock unchanged, units per dose not configured)':`; ${m.quantity} ${m.unit}${m.stockTracked?' deducted after approval':' used, stock not tracked'}`:''}`),'One approval records this group. Not-taken-yet medicines stay unconfirmed; their chat check-in returns in 30 minutes.'];
  } else if (kind === 'routineSchedule') {
    if(!Object.hasOwn(ROUTINE_TITLES,params.type))throw new AppError('Choose the bowel program, skin check or pressure relief.');
    if(!Array.isArray(params.times)||params.times.length>24||params.times.some(t=>typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw new AppError('Provide daily times with AM/PM or 24-hour HH:mm.');
    const everyDays=params.everyDays===2?2:1;if(params.everyDays!=null&&![1,2].includes(params.everyDays))throw new AppError('Reminders can repeat every day or every other day.');
    params={type:params.type,times:[...new Set(params.times)].sort(),everyDays,timezone:state.settings.timezone||'UTC'};
    title=`${params.times.length?'Set':'Stop'} ${ROUTINE_TITLES[params.type].toLowerCase()} reminders`;
    details=params.times.length?[`${everyDays===2?'Every other day, starting today,':'Every day'} at ${params.times.join(', ')} (${params.timezone})`,'This schedules reminders only. Nothing is recorded as done.']:['No more reminders for this routine. Your records are unchanged.'];
  } else if (kind === 'careLog') {
    ({params,title,details}=careLogProposal(state,params));
  } else if (kind === 'journalNote') {
    if(!['catheter','vitals','medication','supplies','note','other'].includes(params.category))throw new AppError('Choose a journal category.');
    params={note:string(params.note,'journal note',3000),category:params.category,time:params.time||now(),photoId:params.photoId||null};
    if(!Number.isFinite(Date.parse(params.time))||params.photoId&&!state.photos.some(p=>p.id===params.photoId))throw new AppError('Choose a valid time and an account-owned photo.');
    title='Save journal observation';details=[params.note,`Observed: ${new Intl.DateTimeFormat('en-US',{timeZone:state.settings.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(params.time))} (${state.settings.timezone})`,'User observation, not a diagnosis.'];
  } else if (kind === 'catheterization') {
    params = { volume: params.volume == null ? null : number(params.volume, 'volume in mL', 0, 3000), photoId: params.photoId || null, time: params.time || now() };
    if (!Number.isFinite(Date.parse(params.time))) throw new AppError('Please provide a valid time.');
    const slot=catheterScheduleMatch(state,params.time);
    title = 'Record catheterization'; details = [`Time: ${new Intl.DateTimeFormat('en-US',{timeZone:state.settings.timezone||'UTC',dateStyle:'medium',timeStyle:'short'}).format(new Date(params.time))} (${state.settings.timezone||'UTC'})`, ...(slot?[`Counts for your ${slot.clock} scheduled catheterization, so that check-in stops asking`]:[]), ...(params.photoId?['Estimated from the attached bag photo; check the scale before approval']:[]), params.volume == null ? 'Volume not recorded' : `${params.volume} mL`, 'Use one new catheter', state.inventory.find(i=>i.id==='catheter')?.count==null?'Stock count not configured; record use without deducting a balance':'Deduct 1 catheter from your supplies'];
  } else if (kind === 'careCorrection') {
    const event=state.events.find(e=>e.id===params.eventId&&!e.voided);if(!event||!['catheterization','supplies','medication','vitals','bag','journalNote','medicationStatus','careLog'].includes(event.kind))throw new AppError('Choose an existing care event that can be undone.');params={eventId:event.id};title='Undo incorrect care entry';details=[event.title,event.detail,...(event.stockUntracked?['The original entry did not change a tracked stock balance.']:[]),'Keep the original and a correction in history. Reverse any recorded stock changes after approval.'];
  } else if (kind === 'supplies') {
    params = { name: string(params.name || 'Catheters', 'product name'), boxes: number(params.boxes, 'number of boxes', 1, 1000), perBox: number(params.perBox, 'units per box', 1, 1000), photoId: params.photoId || null };
    if (!Number.isInteger(params.boxes) || !Number.isInteger(params.perBox)) throw new AppError('Box and unit counts must be whole numbers.');
    title = 'Add supply delivery'; details = [params.name, `${params.boxes} boxes × ${params.perBox} each`, `Add ${params.boxes * params.perBox} catheters`];
  } else if (kind === 'catheterSchedule') {
    if(!Array.isArray(params.times)||!params.times.length||params.times.length>24||params.times.some(t=>typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw new AppError('Provide valid daily times with AM/PM or 24-hour HH:mm.');
    params={times:[...new Set(params.times)].sort(),timezone:state.settings.timezone||'UTC'};
    title='Set daily catheterization reminders';details=[`Every day at ${params.times.join(', ')} (${params.timezone})`,'Enable catheterization reminders and scheduled account notifications','Device notification permission is required; existing registered devices will use these times','This schedules reminders only. No catheter use or volume is recorded, and stock stays unchanged.'];
  } else if (kind === 'catheterStock') {
    params={count:number(params.count,'current catheter count',0,100000)};if(!Number.isInteger(params.count))throw new AppError('Catheter counts must be whole numbers.');
    title='Set current catheter stock';details=[`Current total: ${params.count} catheters`,'Replace the previous balance with your counted total. This is not a delivery.'];
  } else if (kind === 'carePlan') {
    const medications = params.medications || [], allergies = params.allergies || [];
    if (!Array.isArray(medications) || medications.length > 50 || !Array.isArray(allergies) || allergies.length > 50 || !(medications.length + allergies.length)) throw new AppError('Provide a medication or allergy list.');
    params = { medications: medications.map(m => ({name:string(m.name,'medication name',200),dosage:string(m.dosage,'dose label',200),frequency:string(m.frequency,'frequency',200),asNeeded: m.asNeeded===true||/as needed|\bprn\b/i.test(m.frequency),...(m.times===undefined?{}:{times:m.times})})), allergies:allergies.map(a => string(a,'allergy',200)) };
    for(const med of params.medications)if(med.times!==undefined){if(!Array.isArray(med.times)||med.times.length>12||med.times.some(t=>typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw new AppError('Provide valid daily medication times.');med.times=med.asNeeded?[]:[...new Set(med.times)].sort();}
    if(new Set(params.medications.map(m=>medicationKey(m.name))).size !== params.medications.length)throw new AppError('The list includes the same medication more than once. Please resolve the duplicate first.');
    title = 'Save medication and allergy list'; details = [...params.medications.map(m=>`${m.name}: ${m.dosage}, ${m.frequency}${m.times===undefined?'':m.asNeeded?' (as needed, no routine reminders)':` at ${m.times.join(', ')} (${state.settings.timezone})`}`), ...params.allergies.map(a=>`Allergy: ${a}`),'Save to your profile. Explicit daily times schedule reminders; device permission is required for notifications. Stock counts are not changed. Medications absent from this list remain unchanged.'];
  } else if (kind === 'medicationSchedule') {
    const med = findMedication(state, params.medicationId || params.name);
    if(!med)throw new AppError('Choose a medication from your list.');
    if(med.asNeeded)throw new AppError('This medication is listed as needed. It will not generate routine dose reminders. You can log it when taken.');
    if(!Array.isArray(params.times) || params.times.length > 12 || params.times.some(t=>typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw new AppError('Please provide reminder times, such as 08:00 and 20:00.');
    params={medicationId:med.id,times:[...new Set(params.times)].sort()}; title='Set medication reminder times';details=[med.name,params.times.length ? `Daily at ${params.times.join(', ')} (${state.settings.timezone})` : 'Remove scheduled reminders','Reminder times are your choices, not a change to the prescribed regimen.'];
  } else if (kind === 'medStock') {
    const med = findMedication(state, params.medicationId || params.name);if(!med)throw new AppError('Choose a medication from your list.');
    const stock = params.stock==null ? null : number(params.stock,'stock count',0,100000);const unit=string(params.unit || med.unit || 'units','stock unit',30);
    if(!['tablets','capsules','suppositories','units','mL','puffs'].includes(unit))throw new AppError('Use tablets, capsules, suppositories, units, mL, or puffs for stock.');
    params={medicationId:med.id,stock,unit,unitsPerDose:params.unitsPerDose == null ? null : number(params.unitsPerDose,'units used per dose',0.01,1000)};
    title='Set medication stock';details=[med.name,stock==null?'Stock count not configured':`Current stock: ${stock} ${unit}`,params.unitsPerDose==null?'Units used per dose not set. I will ask when recording a dose.':`Deduct ${params.unitsPerDose} ${unit} per confirmed dose`];
  } else if (kind === 'medicationRemove') {
    const med = findMedication(state,params.medicationId||params.name);if(!med)throw new AppError('Choose a medication from your list.');
    params={medicationId:med.id};title='Archive medication';details=[med.name,'Remove from the active list and stop its reminders. Preserve dose history.','This changes your tracking list, not a medical instruction to stop treatment.'];
  } else if (kind === 'medication' && (state.mode === 'personal' || params.medicationId)) {
    const med = findMedication(state,params.medicationId||params.name);if(!med)throw new AppError('Choose a medication from your list.');
    const quantity=params.quantity==null?(med.unitsConfigured?med.unitsPerDose:null):number(params.quantity,'units used',0.01,1000);
    if(params.unit!=null && params.unit!==med.unit)throw new AppError(`Your stock unit is ${med.unit}. Please confirm the quantity in that unit.`);

    if(params.scheduledFor!=null&&!Number.isFinite(Date.parse(params.scheduledFor)))throw new AppError('Provide a valid scheduled dose time.');
    params={medicationId:med.id,name:med.name,dosage:med.dosage,quantity,unit:med.unit,time:params.time||now(),...(params.scheduledFor?{scheduledFor:params.scheduledFor}:{})};
    if(!Number.isFinite(Date.parse(params.time)))throw new AppError('Provide a valid time taken.');
    title=`Record ${med.name}`;details=[med.dosage,`Time taken: ${new Intl.DateTimeFormat('en-US',{timeZone:state.settings.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(params.time))} (${state.settings.timezone})`,...(params.scheduledFor?[`Scheduled dose: ${new Intl.DateTimeFormat('en-US',{timeZone:state.settings.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(params.scheduledFor))}`]:[]),quantity==null?'Units per dose not configured; no stock deduction. Your reported dose is recorded separately.':`${quantity} ${med.unit} used${med.stock==null?'; stock not configured':'; deduct after approval'}`];
  } else if (kind === 'medication') {
    params = { quantity: number(params.quantity ?? 1, 'tablets taken', 0.25, 20), name: 'Example medication' };
    title = 'Record example medication'; details = [`${params.quantity} tablet(s) of Example medication`, 'Record as taken now', `Deduct ${params.quantity} tablet(s) from supplies`, 'Preview medication only; this is not a prescribed regimen'];
  } else if (kind === 'bag') {
    params = { volume: number(params.volume, 'volume in mL', 0, 3000), photoId: params.photoId || null,time:params.time||now() };if(!Number.isFinite(Date.parse(params.time)))throw new AppError('Please provide a valid time.');
    title = 'Save bag reading'; details = [`${params.volume} mL currently in bag`, `Time: ${new Intl.DateTimeFormat('en-US',{timeZone:state.settings.timezone||'UTC',dateStyle:'medium',timeStyle:'short'}).format(new Date(params.time))} (${state.settings.timezone||'UTC'})`, 'Visual estimate checked by you', 'No catheter deducted; this is not cumulative urine output'];
  } else if (kind === 'vitals') {
    params = { time:params.time||now(), systolic: params.systolic == null ? null : number(params.systolic, 'systolic pressure', 30, 300), diastolic: params.diastolic == null ? null : number(params.diastolic, 'diastolic pressure', 20, 250), heartRate: params.heartRate == null ? null : number(params.heartRate, 'heart rate', 20, 250), ...(params.photoId ? {photoId:String(params.photoId)} : {}) };
    if(!Number.isFinite(Date.parse(params.time)))throw new AppError('Provide a valid reading time.');
    if ((params.systolic == null) !== (params.diastolic == null)) throw new AppError('Please provide both blood pressure numbers.');
    if (params.systolic == null && params.heartRate == null) throw new AppError('Please provide a blood pressure or heart-rate reading.');
    title = 'Save your reading'; details = [`Reading time: ${new Intl.DateTimeFormat('en-US',{timeZone:state.settings.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(params.time))} (${state.settings.timezone})`,params.systolic == null ? null : `Blood pressure: ${params.systolic}/${params.diastolic} mmHg`, params.heartRate == null ? null : `Heart rate: ${params.heartRate} bpm`, params.photoId ? 'Source: photo, check the displayed numbers before approving' : 'Source: entered by you'].filter(Boolean);
  } else if (kind === 'settings') {
    const allowed = ['muted', 'handsFree', 'voicePauseMs', 'textScale', 'quietUntil', 'catheterIntervalHours', 'name', 'fullName', 'gender', 'dateOfBirth', 'injuryLevel', 'address', 'emergencyNumber', 'timezone', 'catheterRemindersEnabled', 'catheterStartAt', 'notificationsEnabled', 'catheterScheduleMode'];
    params = Object.fromEntries(Object.entries(params).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(params).length) throw new AppError('Which setting would you like to change?');
    if ('muted' in params && typeof params.muted !== 'boolean') throw new AppError('Mute must be on or off.');
    for (const key of ['catheterRemindersEnabled','notificationsEnabled']) if(key in params && typeof params[key]!=='boolean')throw new AppError('Reminder settings must be on or off.');
    if('catheterScheduleMode' in params&&!['daily','interval'].includes(params.catheterScheduleMode))throw new AppError('Choose daily times or an interval.');
    if('catheterStartAt' in params && !Number.isFinite(Date.parse(params.catheterStartAt)))throw new AppError('Provide a valid reminder start time.');
    if('timezone' in params){try{new Intl.DateTimeFormat('en',{timeZone:params.timezone}).format();}catch{throw new AppError('Provide an IANA timezone, such as America/New_York.');}}
    if ('handsFree' in params && typeof params.handsFree !== 'boolean') throw new AppError('Hands-free must be on or off.');
    if ('voicePauseMs' in params) params.voicePauseMs = number(params.voicePauseMs, 'pause in milliseconds', 2000, 15000);
    if ('textScale' in params) params.textScale = number(params.textScale, 'text size', 1, 1.5);
    if ('catheterIntervalHours' in params) params.catheterIntervalHours = number(params.catheterIntervalHours, 'hours between reminders', 1, 24);
    if ('quietUntil' in params && params.quietUntil !== null && (!Number.isFinite(Date.parse(params.quietUntil)) || Date.parse(params.quietUntil) <= Date.now())) throw new AppError('Quiet time must end in the future.');
    if ('name' in params) params.name = string(params.name, 'name', 60);
    const personal=Object.fromEntries(Object.entries(params).filter(([k])=>profileFields.includes(k)));if(Object.keys(personal).length)Object.assign(params,normalizeProfile(personal));
    title = 'Update your preferences'; details = Object.entries(params).map(([k, v]) => ({ muted: `Spoken replies ${v ? 'off' : 'on'}`, handsFree: `Hands-free browser voice ${v ? 'on' : 'off'} while this page is open`, voicePauseMs: `Wait ${Number(v)/1000} seconds after speech`, textScale: `Text size ${Math.round(Number(v) * 100)}%`, catheterScheduleMode: `Catheter reminder mode: ${v}`, catheterIntervalHours: `Catheterization interval: ${v} hours`, quietUntil: v ? `Quiet until ${v}` : 'End timed quiet mode', name: `Call you ${v}`, timezone: `Timezone: ${v}`, catheterRemindersEnabled: `Catheter reminders ${v?'on':'off'}`, notificationsEnabled: `Notifications ${v?'on':'off'}`, catheterStartAt: `Start catheter reminder clock: ${v}`, fullName: v?`Full name: ${v}`:'Remove full name', gender: v?`Gender: ${v}`:'Remove gender', dateOfBirth: v?`Date of birth: ${v}`:'Remove date of birth', injuryLevel: v?`Spinal cord injury level: ${v}`:'Remove injury level', address: v?`Home address: ${v}`:'Remove home address', emergencyNumber: v?`Other emergency number (shown with 911): ${v}`:'Remove the other emergency number' })[k]);
  } else if (kind === 'caregiver') {
    params = { email: string(params.email, 'email address', 254), role: ['follow', 'record'].includes(params.role) ? params.role : 'follow' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.email)) throw new AppError('Please check the email address.');
    title = 'Save caregiver invitation draft'; details = [params.email, params.role === 'follow' ? 'Proposed access: tasks and history, view only' : 'Proposed access: tasks, history, and care logging', 'No photos, medical documents, or private chat access', 'Draft only. No invitation will be sent or access granted in this preview.'];
  } else throw new AppError('That action is not supported yet.');
  // An approval must always name a specific, current action.
  for (const p of state.proposals) if (p.status === 'pending') { p.status = 'cancelled'; for (const m of state.messages) if (m.proposal?.id === p.id) m.proposal.status = 'cancelled'; }
  const p = { id: uid(), kind, title, details, params, status: 'pending', createdAt: now(), expiresAt: new Date(Date.now() + 30 * 60000).toISOString() };
  state.proposals.push(p); state.draft = null;if(kind==='medicationBatch')delete state.medicationCheckIn;
  return message('assistant', 'Please review this before I save it.', { proposal: publicProposal(p), options: [] });
}
export function publicProposal(p) { const { params, ...publicFields } = p; return { ...publicFields, ...(['bag','catheterization'].includes(p.kind)&&p.params.photoId?{editablePhotoCare:true}:{}), ...(p.kind === 'settings' ? { changedSettings: Object.keys(params) } : {}) }; }
export function finishProposal(state, id, decision) {
  const p = state.proposals.find(p => p.id === id);
  if (!p) throw new AppError('This action was not found.', 404);
  if (p.status !== 'pending') return message('assistant', p.status === 'approved' ? 'This action was already saved. Nothing was counted twice.' : 'This action was cancelled. Nothing was changed.');
  if (Date.parse(p.expiresAt) <= Date.now()) throw new AppError('This approval has expired. Please ask again.', 409);
  if (!['approve', 'cancel'].includes(decision)) throw new AppError('Choose approve or cancel.');
  if (decision === 'cancel') { if(p.kind==='medicationBatch')delete state.medicationCheckIn;p.status = 'cancelled'; syncProposal(state, p); return message('assistant', 'Cancelled. Your care records and supplies are unchanged.'); }
  const data = p.params;
  if(p.kind==='medicationBatch')return finishMedicationBatch(state,p);
  if(p.kind==='careCorrection'){const reply=undoEvent(state,data.eventId);p.status='approved';syncProposal(state,p);return reply;}
  const event = { id: uid(), kind: p.kind, title: p.title, detail: p.details.join(' · '), createdAt: now(), occurredAt: data.time || now(), actor: state.profile.name, proposalId: p.id, delta: null, data: { ...data } };
  if(p.kind==='catheterSchedule'){if(data.timezone!==state.settings.timezone)throw new AppError('Your timezone changed. Please review the schedule again.',409);Object.assign(state.settings,{catheterTimes:data.times,catheterScheduleMode:'daily',catheterScheduleUpdatedAt:now(),catheterScheduleId:uid(),catheterRemindersEnabled:true,notificationsEnabled:true});}
  if (p.kind === 'routineSchedule') { state.routines ||= {}; if(data.times.length){ state.routines[data.type]={times:data.times,everyDays:data.everyDays,startDate:new Intl.DateTimeFormat('en-CA',{timeZone:data.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),updatedAt:now()}; state.settings.notificationsEnabled=true; } else delete state.routines[data.type]; }
  if (p.kind === 'catheterStock')state.inventory.find(i=>i.id==='catheter').count=data.count;
  if (p.kind === 'carePlan') {
    state.medications ||= [];state.allergies ||= [];
    for (const med of data.medications) {
      const old = state.medications.find(m=>medicationKey(m.name)===medicationKey(med.name)) || findMedication(state,med.name) || findMedication(state,med.name.replace(/\([^)]*\)/g, "").trim());
      if(old){const changed=old.frequency!==med.frequency||old.dosage!==med.dosage;Object.assign(old,med,{active:true,updatedAt:now()});if(changed||med.asNeeded)old.times=[];if(med.times!==undefined){old.times=med.times;old.scheduleUpdatedAt=now();}if(changed){old.unitsConfigured=false;old.unitsPerDose=null;}}
      else state.medications.push({id:uid(),...med,times:med.times||[],stock:null,unitsPerDose:null,unitsConfigured:false,unit:'units',active:true,createdAt:now(),updatedAt:now()});
    }
    if(data.medications.some(m=>m.times?.length))state.settings.notificationsEnabled=true;
    for(const allergy of data.allergies)if(!state.allergies.some(a=>medicationKey(a)===medicationKey(allergy)))state.allergies.push(allergy);
  }
  if (p.kind === 'medicationSchedule') { const med=state.medications.find(m=>m.id===data.medicationId&&m.active!==false);if(!med)throw new AppError('This medication is no longer active.',409);med.times=data.times;med.updatedAt=now();med.scheduleUpdatedAt=now(); }
  if (p.kind === 'medStock') { const med=state.medications.find(m=>m.id===data.medicationId&&m.active!==false);if(!med)throw new AppError('This medication is no longer active.',409);Object.assign(med,{stock:data.stock,unit:data.unit,unitsPerDose:data.unitsPerDose,unitsConfigured:data.unitsPerDose!=null,updatedAt:now()}); }
  if (p.kind === 'medicationRemove') { const med=state.medications.find(m=>m.id===data.medicationId);med.active=false;med.times=[]; }
  if (p.kind === 'medication' && data.medicationId) {
    const med=state.medications.find(m=>m.id===data.medicationId&&m.active!==false);if(!med)throw new AppError('This medication is no longer active.',409);
    if(med.stock!=null && data.quantity!=null){if(med.stock<data.quantity)throw new AppError('There is not enough medication stock. Correct your stock first.',409);med.stock-=data.quantity;event.delta={medicationId:med.id,quantity:-data.quantity};}
  }
  if (p.kind === 'catheterization' || p.kind === 'supplies' || (p.kind === 'medication' && !data.medicationId)) {
    const item = state.inventory.find(i => i.id === (p.kind === 'medication' ? 'medication' : 'catheter'));
    const delta = p.kind === 'supplies' ? data.boxes * data.perBox : p.kind === 'medication' ? -data.quantity : -1;
    if (item.count != null && item.count + delta < 0) throw new AppError(`There are not enough ${item.unit} in your inventory. Correct your stock first.`, 409);
    if(item.count != null) {item.count += delta;event.delta = { itemId: item.id, quantity: delta };} else event.stockUntracked = true; if (p.kind === 'supplies') item.name = data.name;
  }
  if (p.kind === 'settings') for (const [key, value] of Object.entries(data)) { if (profileFields.includes(key)) updateProfile(state,{[key]:value}); else state.settings[key] = value; if(key==='timezone')state.settings.timezoneConfirmed=true; }
  if (p.kind === 'caregiver') state.caregivers.push({ id: uid(), ...data, status: 'draft', createdAt: now() });
  state.events.unshift(event); p.status = 'approved'; syncProposal(state, p);
  const stockItem=event.delta?.medicationId ? state.medications.find(m=>m.id===event.delta.medicationId) : state.inventory.find(i=>i.id===event.delta?.itemId);
  const suffix = stockItem ? ` You have ${event.delta.medicationId?stockItem.stock:stockItem.count} ${stockItem.unit} remaining.` : '';
  if(p.kind==='catheterSchedule')return message('assistant',`Daily catheterization reminders saved: ${data.times.join(', ')} (${data.timezone}). Scheduled notifications are on for registered devices. If this device is not enabled yet, select Enable notifications on this device. Your care-use records and stock are unchanged.`,{options:['Enable notifications on this device','Show my tasks']});
  if(p.kind==='carePlan')return message('assistant','Medication and allergy list saved to your profile. Any explicit daily times were saved for reminders. As-needed medicines have no routine reminders. Device notifications require permission. Other medications and stock counts remain unchanged.',{options:['Show my medications','Set medication reminders']});
  return message('assistant', (p.kind === 'caregiver' ? 'Invitation draft saved. It has not been sent, and no access has been granted.' : 'Saved.') + suffix, { options: ['What is next?', 'Show my supplies'] });
}
function syncProposal(state, p) { for (const m of state.messages) if (m.proposal?.id === p.id) m.proposal.status = p.status; }
export function undoEvent(state, id) {
  const event = state.events.find(e => e.id === id);
  if (!event) throw new AppError('Record not found.', 404);
  if (event.voided) return message('assistant', 'This record has already been undone.');
  if (!['catheterization', 'supplies', 'medication', 'vitals', 'bag', 'journalNote', 'medicationStatus', 'careLog'].includes(event.kind)) throw new AppError('Change this setting or invitation through the conversation instead.');
  if (event.delta) {
    const item = event.delta.medicationId ? state.medications.find(m=>m.id===event.delta.medicationId) : state.inventory.find(i => i.id === event.delta.itemId);
    const countKey=event.delta.medicationId?'stock':'count';
    if (!item || item[countKey]==null) throw new AppError('The original stock balance is no longer available. Correct this record through a new entry.',409);
    if (item[countKey] - event.delta.quantity < 0) throw new AppError('This delivery cannot be undone because some of its stock has been used. Correct the inventory through a new entry.', 409);
    item[countKey] -= event.delta.quantity;
  }
  if(event.kind==='supplies'){const item=state.inventory.find(i=>i.id==='catheter');if(item&&item.name===event.data?.name){const other=state.events.filter(e=>e.id!==event.id&&!e.voided&&e.kind==='supplies'&&e.data?.name).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];item.name=other?.data.name||'Catheters';}}
  event.voided = true; event.voidedAt = now();
  state.events.unshift({ id: uid(), kind: 'correction', title: 'Record undone', detail: `Reversed: ${event.title}`, createdAt: now(), actor: state.profile.name, targetId: id });
  return message('assistant', 'Undone. I kept the original entry and correction in your history, and restored any supplies used.');
}
export function view(state) {
  const { draft, proposals, careObservation, medicationCheckIn, ...visible } = state;
  return visible;
}

function medicationBatchParameters(state,input){
 const taken=input.takenMedicationIds,notTaken=input.notTakenMedicationIds||[];
 if(!Array.isArray(taken)||!taken.length||!Array.isArray(notTaken)||taken.length+notTaken.length>50||[...taken,...notTaken].some(id=>typeof id!=='string')||new Set([...taken,...notTaken]).size!==taken.length+notTaken.length)throw new AppError('Select the medicines taken and keep the two lists separate.');
 if(typeof input.scheduledFor!=='string'||!Number.isFinite(Date.parse(input.scheduledFor))||!Number.isFinite(Date.parse(input.time))||Date.parse(input.time)>Date.now()+60000)throw new AppError('Choose a valid actual time in the past or now.');
 const group=careAgenda(state).medicationGroups.find(g=>g.scheduledFor===input.scheduledFor);
 const ids=[...taken,...notTaken];
 if(!group||group.medications.length!==ids.length||group.medications.some(m=>!ids.includes(m.medicationId)))throw new AppError('This medication group changed. Refresh it before reviewing.',409);
 const items=group.medications.map(task=>{const med=state.medications.find(m=>m.id===task.medicationId&&m.active!==false);if(!med||med.asNeeded)throw new AppError('The medication list changed. Review the group again.',409);const quantity=taken.includes(med.id)&&med.unitsConfigured?med.unitsPerDose:null;if(quantity!=null&&(!Number.isFinite(quantity)||quantity<=0))throw new AppError('Correct the configured units per dose before recording this group.');return {medicationId:med.id,occurrenceId:task.occurrenceId,name:med.name,dosage:med.dosage,unit:med.unit,taken:taken.includes(med.id),quantity,stockTracked:med.stock!=null};});
 return {scheduledFor:input.scheduledFor,time:input.time,timezone:state.settings.timezone||'UTC',takenMedicationIds:[...taken],notTakenMedicationIds:[...notTaken],items};
}
function finishMedicationBatch(state,p){
 const data=p.params,current=medicationBatchParameters(state,data);
 if(current.timezone!==data.timezone||JSON.stringify(current.items)!==JSON.stringify(data.items))throw new AppError('A medication, stock setting, or schedule changed. Please review this group again.',409);
 // Validate every row before changing stock or creating a care entry.
 for(const item of data.items){const med=state.medications.find(m=>m.id===item.medicationId);if(item.taken&&item.quantity!=null&&med.stock!=null&&med.stock<item.quantity)throw new AppError(`There is not enough stock for ${med.name}. Correct its stock or dose units, then review the group again.`,409);}
 const savedAt=now(),events=[];state.reminderSnoozes=Object.fromEntries(Object.entries(state.reminderSnoozes||{}).filter(([,value])=>Date.parse(value)>Date.now()));
 for(const item of data.items){
  const med=state.medications.find(m=>m.id===item.medicationId);let delta=null;
  if(item.taken&&item.quantity!=null&&med.stock!=null){med.stock-=item.quantity;delta={medicationId:med.id,quantity:-item.quantity};}
  const time=item.taken?data.time:savedAt;
  events.push({id:uid(),kind:item.taken?'medication':'medicationStatus',title:item.taken?`Record ${item.name}`:`Not taken yet: ${item.name}`,detail:`${item.name} ${item.dosage} · ${item.taken?'Reported taken':'Reported not taken yet'} · Scheduled for ${new Intl.DateTimeFormat('en-US',{timeZone:data.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(data.scheduledFor))} (${data.timezone})`,createdAt:savedAt,occurredAt:time,actor:state.profile.name,proposalId:p.id,batchId:p.id,delta,data:{medicationId:item.medicationId,name:item.name,dosage:item.dosage,quantity:item.taken?item.quantity:null,unit:item.unit,time,scheduledFor:data.scheduledFor,status:item.taken?'taken':'not_taken_yet'}});
  if(item.taken)delete state.reminderSnoozes[item.occurrenceId];else state.reminderSnoozes[item.occurrenceId]=new Date(Date.now()+1800000).toISOString();
 }
 state.events.unshift(...events);p.status='approved';syncProposal(state,p);delete state.medicationCheckIn;
 return message('assistant',`Saved: ${data.takenMedicationIds.length} medication${data.takenMedicationIds.length===1?'':'s'} recorded as taken${data.notTakenMedicationIds.length?`, ${data.notTakenMedicationIds.length} not taken yet. I will ask about those again in 30 minutes while the app is open, or when you next return`:''}.`,{options:['What is next?','Show my medications']});
}
