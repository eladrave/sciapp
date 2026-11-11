import {AppError} from './domain.js';
// Everyday self-care records beyond catheterization and medication: drinks, the bowel program,
// skin checks and pressure relief. One record kind (careLog) with a type keeps them consistent
// in the journal, Undo and the doctor report.
export const CARE_LOG_TYPES={fluid:'Fluid intake',bowel:'Bowel program',skinCheck:'Skin check',pressureRelief:'Pressure relief'};
export const careLogCategory=type=>({fluid:'fluid',bowel:'bowel',skinCheck:'skin',pressureRelief:'skin'}[type]||'other');
const BOWEL={complete:'Completed with a result',partial:'Completed with a small result',none:'Completed with no result',accident:'Unplanned bowel movement'};
const SKIN={clear:'No problems seen',concern:'Something to keep an eye on'};
const note=value=>{if(value==null||value==='')return null;if(typeof value!=='string'||value.trim().length>300)throw new AppError('Keep the note under 300 characters.');return value.trim()||null;};
export function careLogProposal(state,input){
 if(!input||!Object.hasOwn(CARE_LOG_TYPES,input.type))throw new AppError('Choose fluid intake, bowel program, skin check or pressure relief.');
 const time=input.time||new Date().toISOString();
 if(!Number.isFinite(Date.parse(time))||Date.parse(time)>Date.now()+5*60000)throw new AppError('Provide a valid time that is not in the future.');
 const zone=state.settings.timezone||'UTC',when=`Time: ${new Intl.DateTimeFormat('en-US',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(time))} (${zone})`;
 const params={type:input.type,time},details=[];
 if(input.type==='fluid'){
  if(typeof input.volume!=='number'||!Number.isFinite(input.volume)||input.volume<1||input.volume>5000)throw new AppError('Provide the amount you drank in mL, between 1 and 5000.');
  params.volume=Math.round(input.volume);const drink=note(input.drink);if(drink)params.drink=drink.slice(0,60);
  details.push(`${params.volume} mL${params.drink?' of '+params.drink:''}`);
 }else if(input.type==='bowel'){
  params.outcome=input.outcome||'complete';if(!Object.hasOwn(BOWEL,params.outcome))throw new AppError('Choose complete, partial, none or accident for the bowel record.');
  details.push(BOWEL[params.outcome]);
 }else if(input.type==='skinCheck'){
  params.finding=input.finding||'clear';if(!Object.hasOwn(SKIN,params.finding))throw new AppError('Choose clear or concern for the skin check.');
  if(input.photoId){if(!state.photos.some(p=>p.id===input.photoId))throw new AppError('Choose an account-owned photo.');params.photoId=input.photoId;}
  details.push(SKIN[params.finding]);if(params.finding==='concern')details.push('Your own observation, not a diagnosis. Contact your care team about skin changes that do not fade.');
 }else details.push('Weight shift or pressure relief done');
 if(input.type!=='fluid'){const text=note(input.note);if(text){params.note=text;details.push(text);}}
 details.push(when);
 return {params,title:CARE_LOG_TYPES[input.type],details};
}
