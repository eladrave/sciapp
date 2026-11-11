// Numbers the app works out from saved records: today's intake and output, a two-week urine
// trend with the user's own usual amount, and how long supplies should last at the current rate.
// These describe records, not health: a missing record lowers a total without meaning anything happened.
const DAY=86400000;
const dayKey=(ms,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const median=values=>{const s=[...values].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:Math.round((s[m-1]+s[m])/2);};
export function careInsights(state,at=Date.now(),days=14){
 const zone=state.settings?.timezone||'UTC',live=(state.events||[]).filter(e=>!e.voided);
 const byDay=new Map();
 for(let i=days-1;i>=0;i--){const date=dayKey(at-i*DAY,zone);byDay.set(date,{date,label:new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(date+'T12:00:00Z')),urineMl:0,urineRecords:0,fluidMl:0,fluidRecords:0});}
 for(const e of live){
  const day=byDay.get(dayKey(Date.parse(e.occurredAt||e.createdAt),zone));if(!day)continue;
  if(['catheterization','bag'].includes(e.kind)&&typeof e.data?.volume==='number'){day.urineMl+=e.data.volume;day.urineRecords++;}
  if(e.kind==='careLog'&&e.data?.type==='fluid'){day.fluidMl+=e.data.volume;day.fluidRecords++;}
 }
 const trend=[...byDay.values()],today=trend.at(-1),yesterday=trend.at(-2),earlier=trend.slice(0,-1).filter(d=>d.urineRecords>0);
 const usualUrineMl=earlier.length>=5?median(earlier.map(d=>d.urineMl)):null;
 let outputNote=null;
 if(usualUrineMl&&yesterday?.urineRecords){
  const ratio=yesterday.urineMl/usualUrineMl;
  if(ratio<0.6)outputNote=`Yesterday's recorded urine (${yesterday.urineMl} mL) was lower than your usual of about ${usualUrineMl} mL. A missed record can cause this. If it was really low, mention it to your care team.`;
  else if(ratio>1.5)outputNote=`Yesterday's recorded urine (${yesterday.urineMl} mL) was higher than your usual of about ${usualUrineMl} mL.`;
 }
 const supplies=[];
 const catheter=(state.inventory||[]).find(i=>i.id==='catheter');
 if(catheter?.count!=null){
  const uses=live.filter(e=>e.kind==='catheterization').map(e=>Date.parse(e.occurredAt||e.createdAt)).filter(t=>t>at-days*DAY&&t<=at);
  const span=uses.length?Math.max(1,Math.ceil((at-Math.min(...uses))/DAY)):0;
  const scheduled=state.settings?.catheterScheduleMode==='daily'?(state.settings.catheterTimes||[]).length:0;
  const perDay=uses.length>=3&&span>=3?uses.length/span:scheduled||null;
  if(perDay)supplies.push({id:'catheter',name:catheter.name||'Catheters',count:catheter.count,unit:catheter.unit||'catheters',perDay:Math.round(perDay*10)/10,daysLeft:Math.floor(catheter.count/perDay)});
 }
 for(const med of state.medications||[]){
  if(med.active===false||med.asNeeded||med.stock==null||!med.unitsConfigured||!med.times?.length||!(med.unitsPerDose>0))continue;
  const perDay=med.unitsPerDose*med.times.length;
  supplies.push({id:med.id,name:med.name,count:med.stock,unit:med.unit,perDay,daysLeft:Math.floor(med.stock/perDay)});
 }
 for(const s of supplies)s.low=s.daysLeft<=7;
 const warnings=supplies.filter(s=>s.low).map(s=>s.daysLeft<1?`${s.name}: less than a day left (${s.count} ${s.unit}).`:`${s.name}: about ${s.daysLeft} day${s.daysLeft===1?'':'s'} left (${s.count} ${s.unit}).`);
 return {today:{date:today.date,urineMl:today.urineMl,urineRecords:today.urineRecords,fluidMl:today.fluidMl,fluidRecords:today.fluidRecords},trend,usualUrineMl,outputNote,supplies,warnings};
}
