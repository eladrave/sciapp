import {AppError} from './domain.js';
import {zonedTime} from './reminders.js';
const categories=['all','catheter','vitals','medication','supplies','note','other'];
export function localDay(at,timezone){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
function dateValue(date){if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new AppError('Choose a valid journal date.');return date;}
const category=kind=>({catheterization:'catheter',bag:'catheter',monitor:'vitals',vitals:'vitals',medStock:'medication',medication:'medication',medicationStatus:'medication',supplies:'supplies',journalNote:'note',medicationBatch:'medication'}[kind]||'other');
// A clock narrows a local day: "since 7am" is today from 07:00. A clock without a date means today.
const clockValue=clock=>{if(typeof clock!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock))throw new AppError('Use a 24-hour local clock such as 07:00.');return clock;};
function clockDates({startDate,endDate,startClock,endClock},today){
 if(startClock&&!startDate)startDate=today;
 if(endClock&&!endDate){endDate=startDate||today;startDate=startDate||endDate;}
 return {startDate,endDate};
}
function journalRange({startDate,endDate,startClock,endClock},timezone){
 const start=startDate?zonedTime(dateValue(startDate),startClock?clockValue(startClock):'00:00',timezone):-Infinity;
 // An end clock is inclusive of that minute; an end date without a clock covers the whole local day.
 const end=!endDate?Infinity:endClock?zonedTime(dateValue(endDate),clockValue(endClock),timezone)+60000:zonedTime(new Date(Date.parse(dateValue(endDate)+'T00:00:00Z')+86400000).toISOString().slice(0,10),'00:00',timezone);
 if(start>=end)throw new AppError('The start date must precede the end date.');
 return {start,end};
}
// Adds up approved urine amounts so a question gets a number instead of a list of journal cards.
// Only approved, uncorrected records count; unapproved bag photos are reported, never added.
export function urineOutputSummary(state,options={},at=Date.now()){
 const timezone=state.settings.timezone||'UTC',today=localDay(at,timezone);
 let {startDate,endDate,relativeDate,startClock,endClock}=options;
 if(relativeDate){if(startDate||endDate||!['today','yesterday'].includes(relativeDate))throw new AppError('Choose a date range or a relative day.');startDate=endDate=relativeDate==='today'?today:new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);}
 ({startDate,endDate}=clockDates({startDate,endDate,startClock,endClock},today));
 if(!startDate&&!endDate)startDate=endDate=today;
 const {start,end}=journalRange({startDate,endDate,startClock,endClock},timezone);
 const inRange=value=>{const t=Date.parse(value);return t>=start&&t<end;};
 const sameDay=startDate&&startDate===(endDate||today)&&(endDate||localDay(at,timezone)===startDate);
 const label=value=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,...(sameDay?{}:{month:'short',day:'numeric'}),hour:'numeric',minute:'2-digit'}).format(new Date(value));
 const records=(state.events||[]).filter(e=>['catheterization','bag'].includes(e.kind)&&!e.voided&&inRange(e.occurredAt||e.createdAt)).map(e=>({occurredAt:e.occurredAt||e.createdAt,kind:e.kind,volumeMl:Number.isFinite(Number(e.data?.volume))&&e.data?.volume!=null?Number(e.data.volume):null,fromPhoto:!!e.data?.photoId})).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt));
 for(const r of records)r.localTime=label(r.occurredAt);
 const used=new Set((state.events||[]).filter(e=>!e.voided&&e.data?.photoId).map(e=>e.data.photoId));
 const unapprovedPhotos=(state.photos||[]).filter(p=>p.analysis?.type==='bag'&&!used.has(p.id)&&inRange(p.createdAt)).length;
 const measured=records.filter(r=>r.volumeMl!=null);
 const dayName=date=>date===today?'today':new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(date+'T12:00:00Z'));
 const clockName=clock=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',hour:'numeric',minute:'2-digit'}).format(new Date('2000-01-01T'+clock+':00Z'));
 const from=startDate?`${startClock?clockName(startClock)+' ':''}${dayName(startDate)}`:null,to=endDate?`${endClock?clockName(endClock)+' ':''}${dayName(endDate)}`:null;
 const period=!from?`up to ${to}`:!to?`from ${from} onwards`:startDate!==endDate?`from ${from} to ${to}`:startClock?`since ${from}${endClock?' until '+clockName(endClock):''}`:endClock?`${dayName(startDate)==='today'?'today':'on '+dayName(startDate)} until ${clockName(endClock)}`:dayName(startDate)==='today'?'today':'on '+dayName(startDate);
 return {timezone,period,startDate:startDate||null,endDate:endDate||null,totalMl:measured.reduce((sum,r)=>sum+r.volumeMl,0),measuredCount:measured.length,withoutAmount:records.length-measured.length,photoEstimates:measured.filter(r=>r.fromPhoto).length,unapprovedPhotos,records};
}
export function urineOutputReply(summary){
 const {records,measuredCount,totalMl,period,withoutAmount,unapprovedPhotos,photoEstimates}=summary;
 if(!records.length)return `I have no approved urine records ${period}${unapprovedPhotos?`. ${unapprovedPhotos} bag photo${unapprovedPhotos===1?' is':'s are'} not approved yet, so ${unapprovedPhotos===1?'it is':'they are'} not counted`:''}. Unrecorded care cannot be reconstructed.`;
 const shown=records.filter(r=>r.volumeMl!=null),lines=shown.slice(-12).map(r=>`${r.localTime}: ${r.volumeMl} mL`);
 const notes=[];
 if(photoEstimates)notes.push(photoEstimates===measuredCount?(measuredCount===1?'This amount is an estimate read from your bag photo.':'These amounts are estimates read from your bag photos.'):`${photoEstimates} of these amounts are estimates read from bag photos.`);
 if(withoutAmount)notes.push(`${withoutAmount} record${withoutAmount===1?' has':'s have'} no amount and ${withoutAmount===1?'is':'are'} not in the total.`);
 if(unapprovedPhotos)notes.push(`${unapprovedPhotos} bag photo${unapprovedPhotos===1?' is':'s are'} not approved yet and ${unapprovedPhotos===1?'is':'are'} not counted.`);
 if(!measuredCount)return `I have ${records.length} urine record${records.length===1?'':'s'} ${period}, but none has an amount. ${notes.slice(1).join(' ')}`.trim();
 return `${totalMl} mL recorded ${period}, from ${measuredCount} ${measuredCount===1?'entry':'entries'}.\n\n${shown.length>12?`Latest 12 of ${shown.length}:\n`:''}${lines.join('\n')}${notes.length?'\n\n'+notes.join(' '):''}`;
}
export function journalQuery(state,options={},at=Date.now()){
 const timezone=state.settings.timezone||'UTC',today=localDay(at,timezone);
 let {startDate,endDate,relativeDate,startClock,endClock,category:filter='all',photosOnly=false,includeVoided=false,cursor,limit=20}=options;
 if(!categories.includes(filter)||typeof photosOnly!=='boolean'||typeof includeVoided!=='boolean'||!Number.isInteger(limit)||limit<1||limit>50)throw new AppError('Invalid journal filters.');
 if(relativeDate){if(startDate||endDate||!['today','yesterday'].includes(relativeDate))throw new AppError('Choose a date range or a relative day.');startDate=endDate=relativeDate==='today'?today:new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);}
 ({startDate,endDate}=clockDates({startDate,endDate,startClock,endClock},today));
 const {start,end}=journalRange({startDate,endDate,startClock,endClock},timezone);
 if(cursor!=null&&(typeof cursor!=='string'||cursor.length>250))throw new AppError('Invalid journal cursor.');
 const photos=new Map((state.photos||[]).map(p=>[p.id,p]));
 const entries=(state.events||[]).map(e=>({id:e.id,category:e.kind==='journalNote'?e.data.category:category(e.kind),kind:e.kind,title:e.title,detail:e.detail,occurredAt:e.occurredAt||e.createdAt,recordedAt:e.createdAt,status:e.voided?'corrected':'approved',data:e.data,photoId:e.data?.photoId||null,photoAvailable:photos.has(e.data?.photoId),userObservation:e.kind==='journalNote'?e.data.note:null,aiObservation:photos.get(e.data?.photoId)?.analysis||null}));
 const linked=new Set(entries.filter(e=>e.status==='approved'&&e.photoId).map(e=>e.photoId));
 for(const p of photos.values())if(!linked.has(p.id))entries.push({id:'photo:'+p.id,category:category(p.analysis?.type),kind:'photo',title:'Original uploaded photo',detail:p.userText||'Photo not linked to an approved care record.',occurredAt:p.createdAt,recordedAt:p.createdAt,status:'unreviewed',data:null,photoId:p.id,photoAvailable:true,userObservation:null,aiObservation:p.analysis||null});
 const matching=entries.filter(e=>(includeVoided||e.status!=='corrected')&&(filter==='all'||e.category===filter)&&(!photosOnly||e.photoAvailable)&&Date.parse(e.occurredAt)>=start&&Date.parse(e.occurredAt)<end).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.id.localeCompare(a.id));
 // For image requests count original images, not multiple notes about the same image.
 const seen=new Set(),rows=photosOnly?matching.filter(e=>{if(seen.has(e.photoId))return false;seen.add(e.photoId);return true;}):matching;
 const localLabel=value=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 const page=rows.filter(e=>!cursor||`${e.occurredAt}|${e.id}`<cursor).slice(0,limit),last=page.at(-1);
 const nextCursor=last&&rows.some(e=>`${e.occurredAt}|${e.id}`<`${last.occurredAt}|${last.id}`)?`${last.occurredAt}|${last.id}`:null;
 for(const e of page){e.localOccurredAt=localLabel(e.occurredAt);e.localRecordedAt=localLabel(e.recordedAt);}
 return {timezone,filters:{category:filter,photosOnly,includeVoided,startDate:startDate||null,endDate:endDate||null,...(startClock?{startClock}:{}),...(endClock?{endClock}:{})},total:rows.length,entries:page,nextCursor};
}
