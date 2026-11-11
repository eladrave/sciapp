import {finishProposal,undoEvent,proposal,message,AppError} from './domain.js';
import {photoTime} from './photo-review.js';
import {explicitVolume,hasClock} from './catheter-schedule.js';
// Everyday records the user states, selects or photographs are saved at once and can be undone,
// so recording care does not need a second tap. The account setting askBeforeSaving restores a
// review for everything. Changes that are bulk, destructive or about sharing always keep a review.
export const AUTO_SAVE_KINDS=new Set(['catheterization','bag','vitals','medication','medicationBatch','journalNote','supplies','catheterStock','medStock','settings','catheterSchedule','medicationSchedule','careCorrection']);
const UNDOABLE=new Set(['catheterization','supplies','medication','vitals','bag','journalNote','medicationStatus']);
export const autoSaveEnabled=state=>state.settings?.askBeforeSaving!==true;
const replace=(state,next)=>{for(const key of Object.keys(state))delete state[key];Object.assign(state,next);};
export function autoSave(state,reply){
 const shown=reply?.proposal;
 if(!shown||shown.status!=='pending'||!autoSaveEnabled(state)||!AUTO_SAVE_KINDS.has(shown.kind))return reply;
 // Work on a copy so a refused save (for example not enough stock) leaves the review exactly as prepared.
 const copy=JSON.parse(JSON.stringify(state));let done;
 try{done=finishProposal(copy,shown.id,'approve');}catch(error){if(error instanceof AppError){reply.content=`${error.message} Nothing was saved.`;return reply;}throw error;}
 replace(state,copy);
 const saved=state.proposals.find(p=>p.id===shown.id),events=state.events.filter(e=>e.proposalId===shown.id&&!e.voided&&UNDOABLE.has(e.kind));
 const fromPhoto=saved.params?.photoId&&saved.params.volume!=null&&['bag','catheterization'].includes(saved.kind);
 const lead=shown.kind==='careCorrection'?'':fromPhoto?`I read about ${saved.params.volume} mL from the photo and saved it. `:'';
 const rest=fromPhoto?done.content.replace(/^Saved\.\s*/,''):done.content;
 const hint=events.length?(fromPhoto?' If the amount or time is wrong, say the right one, or choose Undo.':' Choose Undo if this is wrong.'):'';
 return {...reply,content:(lead+rest).trim()+hint,options:done.options||[],proposal:{...shown,status:'approved',autoSaved:true,undoable:events.length>0}};
}
// One call undoes everything a saved review recorded (a medication group is several records).
export function undoSaved(state,proposalId){
 const events=state.events.filter(e=>e.proposalId===proposalId&&UNDOABLE.has(e.kind));
 if(!events.length)throw new AppError('This saved change cannot be undone here. Tell me what to change instead.',404);
 const open=events.filter(e=>!e.voided);
 if(!open.length)return message('assistant','This was already undone.');
 const copy=JSON.parse(JSON.stringify(state));for(const event of open)undoEvent(copy,event.id);
 replace(state,copy);for(const m of state.messages)if(m.proposal?.id===proposalId){m.proposal.undone=true;m.proposal.undoable=false;}
 return message('assistant',open.length>1?`Undone. ${open.length} records were reversed and any stock restored.`:'Undone. The record was reversed and any stock restored.');
}
// "Actually 350" or "it was at 7 am" straight after a saved catheter or bag record replaces that
// record with the corrected one instead of adding a second entry.
export function correctSaved(state,text,at=Date.now()){
 if(!autoSaveEnabled(state)||typeof text!=='string'||text.length>80)return null;
 const last=[...state.messages].reverse().find(m=>m.role==='assistant');
 if(!last?.proposal?.autoSaved||last.proposal.undone||!['bag','catheterization'].includes(last.proposal.kind)||at-Date.parse(last.createdAt)>30*60000)return null;
 const saved=state.proposals.find(p=>p.id===last.proposal.id);if(!saved)return null;
 const bare=/^\s*(?:(?:it|that) (?:was|is)\s+|it's\s+)?(?:about\s+)?\d+(?:\.\d+)?\s*(?:ml|millilit(?:er|re)s?)?\s*\.?\s*$/i.test(text);
 if(!bare&&!/\b(?:actually|change|instead|correction|correct|wrong|make it|should be|not \d|it was|that was)\b/i.test(text))return null;
 const numbers=text.match(/\d+(?:\.\d+)?/g)||[];
 const volume=explicitVolume(text)??(!hasClock(text)&&numbers.length===1?Number(numbers[0]):null);
 const timing=hasClock(text)?photoTime(state,text,at):null;
 if(volume==null&&!timing)return null;
 const copy=JSON.parse(JSON.stringify(state));
 for(const event of copy.events.filter(e=>e.proposalId===saved.id&&!e.voided&&UNDOABLE.has(e.kind)))undoEvent(copy,event.id);
 for(const m of copy.messages)if(m.proposal?.id===saved.id){m.proposal.undone=true;m.proposal.undoable=false;}
 const {evidence,...params}=saved.params;
 const reply=autoSave(copy,proposal(copy,saved.kind,{...params,...(volume==null?{}:{volume}),...(timing?{time:timing.time}:{})}));
 if(!reply.proposal?.autoSaved)return null;
 replace(state,copy);reply.content='Corrected. '+reply.content.replace(/^I read about \d+(?:\.\d+)? mL from the photo and saved it\.\s*/,'').replace(/ If the amount or time is wrong.*$/,' Choose Undo if this is wrong.');
 return reply;
}
