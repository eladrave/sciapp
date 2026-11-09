import {questionChoices} from './question-choices.js';

// A chat reminder is actionable context, not a permanent footer on every reply.
export function careCheckInState(state,{at=Date.now(),page='Conversation',signedIn=false,notificationPermission='unknown',notificationsConnected=false,notificationsConfigured=true}={}){
 const agenda=state?.agenda;
 if(!agenda)return {show:false,due:[],showNotificationSetup:false};
 const latest=[...(state.messages||[])].reverse().find(m=>m.role==='assistant');
 const pendingReview=(state.messages||[]).some(m=>m.proposal?.status==='pending'&&Date.parse(m.proposal.expiresAt)>at);
 const answering=!!latest&&(!!latest.medicationCheckIn||!!latest.questionId||!!questionChoices(latest).reference);
 if(page==='Conversation'&&(pendingReview||answering||state.medicationCheckInResume))return {show:false,due:[],showNotificationSetup:false};
 const due=(agenda.overdue||[]).filter(t=>!(Date.parse(state.reminderSnoozes?.[t.id])>at));
 const showNotificationSetup=signedIn&&notificationsConfigured&&!notificationsConnected&&!['unknown','unavailable'].includes(notificationPermission)&&!(Date.parse(state.checkInHiddenUntil)>at);
 return {show:due.length>0||showNotificationSetup,due,showNotificationSetup};
}
