import {careAgenda,reminderTasks} from './reminders.js';
import {AppError,message} from './domain.js';

export function snoozeCareCheckIn(state,{occurrenceIds,minutes=30}={}){
 if(!Number.isInteger(minutes)||minutes<5||minutes>180)throw new AppError('Choose a check-in pause between 5 and 180 minutes.');
 const due=careAgenda(state).overdue;
 const ids=occurrenceIds??due.map(t=>t.id);
 if(!Array.isArray(ids)||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!due.some(t=>t.id===id)))throw new AppError('These care reminders changed. Refresh and try again.',409);
 const until=new Date(Date.now()+minutes*60000).toISOString();
 state.reminderSnoozes=Object.fromEntries(Object.entries(state.reminderSnoozes||{}).filter(([,value])=>Date.parse(value)>Date.now()));
 for(const id of ids)state.reminderSnoozes[id]=until;
 state.checkInHiddenUntil=until;
 return message('assistant',`Care check-in hidden for ${minutes} minutes. No care was recorded as completed. New due items can still appear, and your full schedule remains in Today.`);
}

// Dismissal is prompt state only, never a clinical adherence record.
export function dismissReminders(state,{occurrenceIds}={}){
 const tasks=reminderTasks(state);
 if(!Array.isArray(occurrenceIds)||!occurrenceIds.length||occurrenceIds.length>100||new Set(occurrenceIds).size!==occurrenceIds.length||occurrenceIds.some(id=>typeof id!=='string'||!tasks.some(t=>t.id===id)))throw new AppError('Those reminders changed. Refresh and choose the reminder to dismiss.',409);
 state.reminderDismissals=Object.fromEntries(Object.entries(state.reminderDismissals||{}).filter(([,expiry])=>Date.parse(expiry)>Date.now()));
 const until=new Date(Date.now()+72*3600000).toISOString();
 for(const id of occurrenceIds)state.reminderDismissals[id]=until;
 if(state.medicationCheckIn?.medications.some(m=>occurrenceIds.includes(m.occurrenceId)))delete state.medicationCheckIn;
 return message('assistant',`${occurrenceIds.length===1?'Reminder dismissed':'Reminders dismissed'} for this occurrence only. No care was recorded. Your schedule and future reminders stay the same.`);
}
