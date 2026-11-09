import {message,proposal} from './domain.js';
import {zonedTime} from './reminders.js';
import {scheduleTimes,explicitVolume,hasClock} from './catheter-schedule.js';
export function photoTime(state,text,at=Date.now()){
 const zone=state.settings.timezone||'UTC';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
 let day=Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);if(/\byesterday\b/i.test(text))day-=86400000;
 const clocks=[...text.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b/gi)];
 if(clocks.length>1)return null;
 if(clocks.length){const time=scheduleTimes(clocks[0][0])?.[0];if(!time)return null;const date=new Date(day).toISOString().slice(0,10);return {time:new Date(zonedTime(date,time,zone)).toISOString(),assumed:false};}
 if(hasClock(text))return null;
 const candidates=[];for(const offset of [-1,0])for(const clock of state.settings.catheterTimes||[]){const date=new Date(day+offset*86400000).toISOString().slice(0,10);const due=zonedTime(date,clock,zone);if(due<=at&&at-due<=3*3600000)candidates.push(due);}
 const due=candidates.sort((a,b)=>b-a)[0];return due===undefined?null:{time:new Date(due).toISOString(),assumed:true};
}
export function bagPhotoReview(state,text,data,photoId){
 const timing=photoTime(state,text);const volume=explicitVolume(text)??data.volumeMl;
 const kind=timing?'catheterization':'bag';
 const params={volume,photoId,...(timing?{time:timing.time}:{})};
 if(volume==null){state.draft={kind:'photoCare',careKind:kind,params};return message('assistant','I recognize a urine collection bag, but cannot reliably read the scale. What amount in mL should I use?',{photoId,photoUrl:`/api/photos/${photoId}`});}
 const reply=proposal(state,kind,params);reply.content=`This appears to be a urine collection bag, approximately ${volume} mL. ${timing?.assumed?'I matched it to your most recent scheduled catheterization; please check the time. ':''}Review the time and amount, then approve or change them. Nothing has been recorded yet.`;return reply;
}
export function editPhotoReview(state,text){
 const current=state.proposals.filter(p=>p.status==='pending'&&p.params.photoId&&['bag','catheterization'].includes(p.kind)&&Date.parse(p.expiresAt)>Date.now()).at(-1);
 const draft=state.draft?.kind==='photoCare'?state.draft:null;
 if(!current&&!draft)return null;
 if(/^(?:change|edit) (?:the )?(?:time|amount)$/i.test(text)){const field=/time/i.test(text)?'time':'volume';state.draft={kind:'photoCare',careKind:current?.kind||draft.careKind,params:{...(current?.params||draft.params)},field};return message('assistant',field==='time'?'What time should I use? Include AM or PM.':'What amount in mL should I use?');}
 const correction=draft||/\b(?:actually|change|instead|correction|make|at)\b/i.test(text);if(!correction)return null;
 const base=current?{careKind:current.kind,params:current.params}:draft;
 if(draft?.field==='time'&&!hasClock(text))return message('assistant','Please include AM or PM, for example 7 am.');
 const volume=explicitVolume(text)??(!hasClock(text)&&/^\d+(?:\.\d+)?$/.test(text.trim())?Number(text):null);
 const timing=hasClock(text)?photoTime(state,text):null;
 if(volume==null&&!timing)return null;
 if(base.params.volume==null&&volume==null)return message('assistant','What amount in mL should I use?');
 return proposal(state,base.careKind,{...base.params,...(volume==null?{}:{volume}),...(timing?{time:timing.time}:{})});
}
