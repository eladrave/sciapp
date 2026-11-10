import {AppError} from './domain.js';
// Personal details the user chooses to share. They are identity facts, not care records:
// saving them never records care, and every field except the preferred name can be left empty.
export const GENDERS=['Female','Male','Non-binary','Other','Prefer not to say'];
const limits={name:60,fullName:120,gender:40,injuryLevel:80};
export const profileFields=['name','fullName','gender','dateOfBirth','injuryLevel'];
export function normalizeProfile(input,at=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('Provide your details to save.');
 const out={};
 for(const key of profileFields){
  if(!(key in input))continue;
  const raw=input[key];if(raw!=null&&typeof raw!=='string')throw new AppError('Personal details must be text.');
  const value=(raw||'').replace(/\s+/g,' ').trim();
  if(key==='dateOfBirth'){
   if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value||value<'1900-01-01'||Date.parse(value+'T00:00:00Z')>at))throw new AppError('Enter a valid date of birth.');
  }else if(value.length>limits[key])throw new AppError(`Keep ${key==='name'?'your preferred name':key==='fullName'?'your full name':key==='gender'?'gender':'injury level'} under ${limits[key]} characters.`);
  out[key]=value;
 }
 if(!Object.keys(out).length)throw new AppError('Provide your details to save.');
 return out;
}
export function updateProfile(state,input,at=Date.now()){
 const changes=normalizeProfile(input,at);state.profile=state.profile||{name:'You'};
 for(const [key,value] of Object.entries(changes)){if(value)state.profile[key]=value;else if(key==='name')state.profile.name='You';else delete state.profile[key];}
 return state.profile;
}
export function profileSummary(profile={}){
 const born=profile.dateOfBirth?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',dateStyle:'long'}).format(new Date(profile.dateOfBirth+'T00:00:00Z')):null;
 return [['Preferred name',profile.name&&profile.name!=='You'?profile.name:null],['Full name',profile.fullName],['Gender',profile.gender],['Date of birth',born],['Spinal cord injury level',profile.injuryLevel]].map(([label,value])=>({label,value:value||null}));
}
