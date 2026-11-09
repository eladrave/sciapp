import {AppError} from './domain.js';
import {zonedTime} from './reminders.js';
const categories=['all','catheter','vitals','medication','supplies','note','other'];
export function localDay(at,timezone){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
function dateValue(date){if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new AppError('Choose a valid journal date.');return date;}
const category=kind=>({catheterization:'catheter',bag:'catheter',monitor:'vitals',vitals:'vitals',medStock:'medication',medication:'medication',medicationStatus:'medication',supplies:'supplies',journalNote:'note',medicationBatch:'medication'}[kind]||'other');
export function journalQuery(state,options={},at=Date.now()){
 const timezone=state.settings.timezone||'UTC',today=localDay(at,timezone);
 let {startDate,endDate,relativeDate,category:filter='all',photosOnly=false,includeVoided=false,cursor,limit=20}=options;
 if(!categories.includes(filter)||typeof photosOnly!=='boolean'||typeof includeVoided!=='boolean'||!Number.isInteger(limit)||limit<1||limit>50)throw new AppError('Invalid journal filters.');
 if(relativeDate){if(startDate||endDate||!['today','yesterday'].includes(relativeDate))throw new AppError('Choose a date range or a relative day.');startDate=endDate=relativeDate==='today'?today:new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);}
 const start=startDate?zonedTime(dateValue(startDate),'00:00',timezone):-Infinity;
 const end=endDate?zonedTime(new Date(Date.parse(dateValue(endDate)+'T00:00:00Z')+86400000).toISOString().slice(0,10),'00:00',timezone):Infinity;
 if(start>=end)throw new AppError('The start date must precede the end date.');
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
 return {timezone,filters:{category:filter,photosOnly,includeVoided,startDate:startDate||null,endDate:endDate||null},total:rows.length,entries:page,nextCursor};
}
