import {questionChoices} from './question-choices.js';

// A chat reminder is actionable context, not a permanent footer on every reply.
export function careCheckInState(state,{at=Date.now(),page='Conversation',signedIn=false,notificationPermission='unknown',notificationsConnected=false,notificationsConfigured=true}={}){
 const agenda=state?.agenda;
 if(!agenda)return {show:false,due:[],showNotificationSetup:false};
 const latest=[...(state.messages||[])].reverse().find(m=>m.role==='assistant');
 const pendingReview=(state.messages||[]).some(m=>m.proposal?.status==='pending'&&Date.parse(m.proposal.expiresAt)>at);
 const answering=!!latest&&(!!latest.medicationCheckIn||!!latest.questionId||!!questionChoices(latest).reference);
 if(page==='Conversation'&&(pendingReview||answering||latest?.appHelp||state.medicationCheckInResume))return {show:false,due:[],showNotificationSetup:false};
 const due=(agenda.overdue||[]).filter(t=>!(Date.parse(state.reminderSnoozes?.[t.id])>at));
 const showNotificationSetup=signedIn&&notificationsConfigured&&!notificationsConnected&&!['unknown','unavailable'].includes(notificationPermission)&&!(Date.parse(state.checkInHiddenUntil)>at);
 return {show:due.length>0||showNotificationSetup,due,showNotificationSetup};
}

// The Today page lists only reminders whose local calendar day, in the account timezone, is today.
export function todaysReminders(tasks,timezone,at=Date.now()){
 const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone||undefined,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
 const today=day(at);return (tasks||[]).filter(t=>day(t.dueAt)===today);
}

// Medicines scheduled for the same instant form one row, so the list stays short. Dismissed and
// still-open medicines stay in separate rows; a dismissal never spreads to another occurrence.
export function groupReminders(tasks,dismissals={},at=Date.now()){
 const rows=[],byKey=new Map();
 for(const task of tasks||[]){
  const dismissed=Date.parse(dismissals?.[task.id])>at,key=task.kind==='medication'?`med|${task.dueAt}|${dismissed}`:task.id;
  let row=byKey.get(key);if(!row){row={kind:task.kind,dueAt:task.dueAt,dismissed,titles:[],ids:[]};byKey.set(key,row);rows.push(row);}
  row.titles.push(task.title);row.ids.push(task.id);
 }
 return rows;
}
