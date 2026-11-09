import {careAgenda} from './reminders.js';
import {AppError,message,proposal,publicProposal} from './domain.js';

export function currentMedicationCheckIn(state){
 const c=state.medicationCheckIn;
 return c&&Date.parse(c.expiresAt)>Date.now()?c:null;
}
function question(state){
 const c=state.medicationCheckIn;
 c.revision++;
 const content=c.stage==='selection'
  ?`Which ${c.clock} medicines did you take? Select them below, or say their names or numbers. You can also say “all except” a medicine. Unchecked medicines will be reviewed as not taken yet.`
  :`When did you take ${c.takenMedicationIds.length===c.medications.length?'all the': 'these'} ${c.clock} medicines? Say “on time”, “just now”, or tell me another time. You can also say if different medicines were taken at different times.`;
 return message('assistant',content,{questionId:crypto.randomUUID(),medicationCheckIn:{id:c.id,revision:c.revision,stage:c.stage,clock:c.clock,expiresAt:c.expiresAt,scheduledFor:c.scheduledFor,medications:c.medications,takenMedicationIds:c.takenMedicationIds},answerHint:'You can use the buttons or speak your answer. Say Cancel to stop.'});
}
export function medicationCheckInAction(state,data){
 const action=data.action,c=currentMedicationCheckIn(state);
 if(!['all','some','select','time','later','cancel','resume'].includes(action))throw new AppError('Choose a supported medication check-in action.');
 if(action==='resume')return resumeMedicationCheckIn(state,data.checkInId);
 if(data.checkInId&&(data.checkInId!==c?.id||data.revision!=null&&data.revision!==c.revision))throw new AppError('That question changed. Use the latest medication check-in.',409);
 if(action==='cancel'){delete state.medicationCheckIn;return message('assistant','Medication check-in cancelled. No doses were recorded.');}
 if(['all','some','later'].includes(action)){
  const groups=careAgenda(state).medicationGroups;
  const group=data.groupId?groups.find(g=>g.id===data.groupId):c?groups.find(g=>g.id===c.groupId):groups.length===1?groups[0]:null;
  if(!group)throw new AppError(groups.length>1?'More than one medication time is awaiting a record. Ask which scheduled time the user means.':'This medication group is no longer awaiting a record. Refresh your care check-in.',409);
  if(action==='later'){
   state.reminderSnoozes=Object.fromEntries(Object.entries(state.reminderSnoozes||{}).filter(([,v])=>Date.parse(v)>Date.now()));
   for(const m of group.medications)state.reminderSnoozes[m.occurrenceId]=new Date(Date.now()+1800000).toISOString();delete state.medicationCheckIn;
   return message('assistant',`I will ask about the ${group.clock} medicines again in 30 minutes while the app is open, or when you return. No doses were recorded.`);
  }
  if(state.proposals.some(p=>p.status==='pending'&&Date.parse(p.expiresAt)>Date.now()))throw new AppError('Finish or cancel the current care review before starting this medication check-in.',409);
  state.medicationCheckIn={id:crypto.randomUUID(),revision:0,groupId:group.id,scheduledFor:group.scheduledFor,clock:group.clock,medications:group.medications.map((m,index)=>({...m,number:index+1})),takenMedicationIds:action==='all'?group.medications.map(m=>m.medicationId):[],stage:action==='all'?'time':'selection',expiresAt:new Date(Date.now()+1800000).toISOString()};
  if(action==='some'&&data.takenMedicationIds)return medicationCheckInAction(state,{action:'select',takenMedicationIds:data.takenMedicationIds,time:data.time});
  if(action==='all'&&data.time)return prepare(state,data.time);
  return question(state);
 }
 if(!c)throw new AppError('Start a new medication check-in. The previous one expired.',409);
 if(action==='select'){
  const ids=data.takenMedicationIds;
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!c.medications.some(m=>m.medicationId===id)))throw new AppError('Select at least one medicine from this check-in, or say Not yet.');
  c.takenMedicationIds=[...ids];c.stage='time';
  if(data.time)return prepare(state,data.time);
  return question(state);
 }
 if(c.stage!=='time'||!c.takenMedicationIds.length)throw new AppError('Choose the medicines taken before choosing their time.');
 const time=data.timing==='scheduled'?c.scheduledFor:data.timing==='now'?new Date(Date.now()).toISOString():data.time;
 if(!time)throw new AppError('Resolve the actual time, or choose scheduled or now.');
 return prepare(state,time);
}
function prepare(state,time){
 const c=currentMedicationCheckIn(state);
 const reply=proposal(state,'medicationBatch',{scheduledFor:c.scheduledFor,time,takenMedicationIds:c.takenMedicationIds,notTakenMedicationIds:c.medications.filter(m=>!c.takenMedicationIds.includes(m.medicationId)).map(m=>m.medicationId)});
 delete state.medicationCheckIn;return reply;
}

// An unsaved checkbox draft is conversation context, never a dose record.
export function applyMedicationSelectionDraft(state,draft){
 const c=currentMedicationCheckIn(state);
 if(!c||c.stage!=='selection'||draft?.checkInId!==c.id||draft.revision!==c.revision)throw new AppError('That medication selection changed. Use the latest check-in.',409);
 const ids=draft.takenMedicationIds;
 if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!c.medications.some(m=>m.medicationId===id)))throw new AppError('Choose medicines from the current check-in.');
 c.takenMedicationIds=[...ids];
}

function recoverableGroup(state){
 const draft=state.medicationCheckIn;if(!draft)return null;
 const group=careAgenda(state).medicationGroups.find(g=>g.id===draft.groupId);
 if(!group||group.medications.some(m=>!draft.medications.some(old=>old.occurrenceId===m.occurrenceId)))return null;
 return {draft,group};
}
export function medicationCheckInResume(state){
 const latest=[...state.messages].reverse().find(m=>m.role==='assistant');
 const review=state.proposals.filter(p=>p.kind==='medicationBatch'&&p.status==='pending'&&Date.parse(p.expiresAt)>Date.now()).at(-1);
 if(review&&latest?.proposal?.id!==review.id)return {id:review.id,type:'review',clock:new Intl.DateTimeFormat('en-US',{timeZone:state.settings.timezone||'UTC',hour:'numeric',minute:'2-digit'}).format(new Date(review.params.scheduledFor)),reportedTakenCount:review.params.takenMedicationIds.length};
 const recovery=recoverableGroup(state);if(!recovery)return null;
 const {draft,group}=recovery;
 if(latest?.medicationCheckIn?.id===draft.id&&Date.parse(draft.expiresAt)>Date.now())return null;
 return {id:draft.id,groupId:draft.groupId,type:'setup',stage:draft.stage,clock:draft.clock,reportedTakenCount:group.medications.filter(m=>draft.takenMedicationIds.includes(m.medicationId)).length,total:group.medications.length};
}
function resumeMedicationCheckIn(state,id){
 const review=state.proposals.filter(p=>p.kind==='medicationBatch'&&p.status==='pending'&&Date.parse(p.expiresAt)>Date.now()).at(-1);
 if(review&&(!id||id===review.id))return message('assistant','Your medication report is already prepared. Review it here; you do not need to select the medicines again.',{proposal:publicProposal(review)});
 const recovered=recoverableGroup(state);if(!recovered||id&&id!==recovered.draft.id)throw new AppError('That medication group changed or was already recorded. Check Today before starting another record.',409);
 if(state.proposals.some(p=>p.status==='pending'&&Date.parse(p.expiresAt)>Date.now()))throw new AppError('Finish or cancel the current care review before resuming the medication check-in.',409);
 const {draft,group}=recovered;
 draft.medications=group.medications.map((m,index)=>({...m,number:index+1}));draft.takenMedicationIds=draft.takenMedicationIds.filter(id=>group.medications.some(m=>m.medicationId===id));draft.stage=draft.takenMedicationIds.length?'time':'selection';draft.expiresAt=new Date(Date.now()+1800000).toISOString();
 return question(state);
}
