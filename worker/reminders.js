// Reminders are prompts to review care, never evidence that a dose was taken.
const minute = 60000;
const iso = ms => new Date(ms).toISOString();
function localParts(ms, timezone) {
 const values = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));
 return Object.fromEntries(values.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
}
const partsNumber = p => Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
export function zonedTime(date, time, timezone) {
 const target=Date.parse(`${date}T${time}:00Z`),offsets=new Set();
 for(const hours of [-36,0,36]){const sample=target+hours*3600000;offsets.add(partsNumber(localParts(sample,timezone))-sample);}
 const candidates=[...offsets].map(offset=>target-offset).sort((a,b)=>a-b);
 const exact=candidates.find(candidate=>partsNumber(localParts(candidate,timezone))===target);
 // Fall-back occurs once (first instance); spring-gap times shift forward by the gap.
 return exact ?? candidates.filter(candidate=>partsNumber(localParts(candidate,timezone))>target).sort((a,b)=>a-b)[0];
}
export function reminderTasks(state, at=Date.now()) {
 const tasks=[],timezone=state.settings.timezone||'UTC';
 const local=localParts(at,timezone), day=Date.UTC(+local.year,+local.month-1,+local.day);
 for(const med of state.medications||[]){
  if(med.active===false||med.asNeeded||!med.times?.length)continue;
  const candidates=[];
  for(let offset=-1;offset<=2;offset++)for(const time of med.times){
   const date=new Date(day+offset*86400000).toISOString().slice(0,10),due=zonedTime(date,time,timezone);
   if(!Number.isFinite(due)||due<Date.parse(med.scheduleUpdatedAt||med.createdAt||'1970-01-01'))continue;
   candidates.push({id:`med:${med.id}:${date}:${time}:${med.scheduleUpdatedAt||''}`,kind:'medication',title:`${med.name} ${med.dosage}`,dueAt:iso(due),medicationId:med.id});
  }
  const completed=new Set();
  for(const event of state.events.filter(e=>e.kind==='medication'&&!e.voided&&e.data.medicationId===med.id)){
   const timestamp=Date.parse(event.occurredAt||event.createdAt);
   let match=event.data.scheduledFor ? candidates.find(t=>t.dueAt===event.data.scheduledFor) : candidates.filter(t=>!completed.has(t.id)&&Math.abs(Date.parse(t.dueAt)-timestamp)<=90*minute).sort((a,b)=>Math.abs(Date.parse(a.dueAt)-timestamp)-Math.abs(Date.parse(b.dueAt)-timestamp))[0];
   if(match)completed.add(match.id);
  }
  tasks.push(...candidates.filter(t=>!completed.has(t.id)));
 }
 if(state.settings.catheterRemindersEnabled){
  const last=state.events.find(e=>e.kind==='catheterization'&&!e.voided);
  const baseline=Math.max(Date.parse(last?.occurredAt||0)||0,Date.parse(state.settings.catheterStartAt||0)||0);
  if(baseline){const due=baseline+Number(state.settings.catheterIntervalHours)*3600000;tasks.push({id:`catheter:${baseline}:${state.settings.catheterIntervalHours}`,kind:'catheterization',title:'Catheterization',dueAt:iso(due)});}
 }
 return tasks.filter(t=>Date.parse(t.dueAt)>=at-24*3600000&&Date.parse(t.dueAt)<=at+48*3600000).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt));
}
export function dueTasks(state,at=Date.now()) {
 if(!state.settings.notificationsEnabled)return [];
 return reminderTasks(state,at).filter(task=>Date.parse(task.dueAt)<=at&&Date.parse(task.dueAt)>at-10*minute);
}
