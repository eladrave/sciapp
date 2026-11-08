import { hasClock, explicitVolume, scheduleIntent, scheduleTimes } from './catheter-schedule.js';
import { AppError, message, proposal } from './domain.js';
import { parseReminderTimes } from './medications.js';

export function scheduleOnlyCorrection(text) {
 return /\b(schedule|remind(?:ers?)?)\b/i.test(text) && (/^\s*no\b/i.test(text)||/\b(?:just|only)\s+(?:(?:my|the|a)\s+)?(?:medication\s+)?schedule\b/i.test(text)||/\b(?:did not|didn't|not)\s+(?:take|taken|taking)\b/i.test(text));
}
const fields={
 catheterSchedule:['times'],catheterization:['volume','time'],supplies:['name','boxes','perBox'],vitals:['systolic','diastolic','heartRate'],
 medication:['medicationId','quantity'],medicationSchedule:['medicationId','times'],
 settings:['muted','handsFree','voicePauseMs','textScale','quietUntil','catheterIntervalHours','name','timezone','notificationsEnabled'],
};
const intents={
 muted:/\b(mute|unmute|sound|spoken|speak|silent|quiet|hear)\b|read aloud/i,
 quietUntil:/\b(mute|unmute|sound|spoken|silent|quiet)\b/i,
 handsFree:/hands[ -]?free|\b(listening|microphone)\b/i,
 voicePauseMs:/\b(pause|wait|seconds?)\b/i,
 textScale:/\b(text|font)\b/i,
 catheterIntervalHours:/\bcatheter(?:ization)?\b/i,
 name:/\b(call me|my name)\b/i,
 timezone:/\b(timezone|time zone)\b/i,
 notificationsEnabled:/\bnotifications?\b/i,
};
const booleanFields=new Set(['muted','handsFree','notificationsEnabled']);
function question(kind,text='') {
 if(kind==='catheterization'&&!scheduleIntent(text))return 'What volume should I record in mL? You can say record without volume. No care entry has been saved.';
 if(kind==='catheterSchedule'||/\bcatheter/i.test(text))return 'What daily catheterization times should I use? Include AM or PM. No catheter use was recorded.';
 if(/\b(schedule|remind(?:ers?)?)\b/i.test(text)||kind==='medicationSchedule')return 'Which medication should I set reminders for, and at what times? I have not recorded a dose or changed your settings.';
 if(kind==='settings')return 'Which setting would you like to change? I have not changed your preferences.';
 if(kind==='medication')return 'Do you want to record a dose you took, or set up medication reminders?';
 return 'I could not reliably interpret that action. Nothing from this message was recorded as care. Please tell me the details you want to save.';
}
export function assistantAction(state,text,action) {
 const kind=action?.kind,raw=action?.params;
 const clarify=()=>message('assistant',question(kind,text),{toolError:'Arguments are missing, invalid, or not grounded in the latest user message. If this is a read-only question, use get_care_overview rather than repeating a previous write.',options:/schedule|remind|medication/i.test(text)||(typeof kind==='string'&&kind.startsWith('medication'))?['Set medication reminders','Record medication']:['Settings','Log catheterization']});
 if(!Object.hasOwn(fields,kind)||!raw||typeof raw!=='object'||Array.isArray(raw))return clarify();
 const params={};
 for(const key of fields[kind]){
  const value=raw[key];
  // Optional unset fields must not turn into actions, especially null mute/text values.
  if(value===undefined || value===null && !(kind==='settings'&&key==='quietUntil'&&intents.quietUntil.test(text)))continue;
  if(kind==='settings'&&!intents[key]?.test(text))continue;
  if(kind==='settings'&&booleanFields.has(key)){
   if(typeof value==='boolean')params[key]=value;
   else if(typeof value==='string'&&/^(true|false|on|off)$/i.test(value.trim()))params[key]=/^(true|on)$/i.test(value.trim());
   else return clarify();
  } else params[key]=value;
 }
 if(!Object.keys(params).length)return clarify();
 if(kind==='catheterization'&&(scheduleIntent(text)||hasClock(text)&&explicitVolume(text)==null||(!/\b(?:catheterized|catheterised|did|finished|completed|log|record)\b/i.test(text))))return clarify();
 if(kind==='catheterization'){const stated=explicitVolume(text),draftNumber=state.draft?.kind==='catheterization'&&/^\d+(?:\.\d+)?$/.test(text.trim())?Number(text):null;if(params.volume!=null&&params.volume!==(stated??draftNumber)||stated!=null&&params.volume!==stated)return clarify();}
 if(kind==='catheterSchedule'){const grounded=scheduleTimes(text);if(!grounded||!Array.isArray(params.times)||JSON.stringify([...new Set(params.times)].sort())!==JSON.stringify(grounded))return clarify();}
 // Describing a recurring regimen is different from reporting that a dose was taken.
 if(kind==='medication'&&(scheduleOnlyCorrection(text)||!/\b(?:i (?:have |just |already )?(?:took|taken)|record (?:taking|a dose)|log (?:taking|a dose))\b/i.test(text)||/\b(?:did not|didn't|have not|haven't|not yet)\b/i.test(text)))return clarify();
 if(kind==='medicationSchedule'){
  const tokens=text.match(/\b\d{1,2}:\d{2}(?:\s*[ap]m)?\b|\b\d{1,2}\s*[ap]m\b/gi)||[];
  const explicit=parseReminderTimes(tokens.join(' and '));
  if(!Array.isArray(params.times)||!params.times.length||!explicit||params.times.some(time=>!explicit.includes(time)))return clarify();
 }
 try{return proposal(state,kind,params);}catch(error){if(error instanceof AppError)return clarify();throw error;}
}
