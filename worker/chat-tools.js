import { message, finishProposal } from './domain.js';
import { assistantAction } from './assistant-actions.js';
import { handleKnown } from './conversation.js';
import { reminderChat } from './reminder-chat.js';
import { memoryChat } from './retrieval.js';
import { conversationControl } from '../web/conversation-controls.js';
const names=new Map([['set_catheter_schedule','catheterSchedule'],['record_catheterization','catheterization'],['set_medication_reminders','medicationSchedule'],['record_medication','medication'],['record_vitals','vitals'],['change_preferences','settings']]);
const clarify=()=>message('assistant','I have not changed your care records. Is this a daily reminder schedule, or are you reporting care you completed?',{toolError:'The selected tool does not match a supported explicit operation in the latest message.',options:['Set catheter reminders','Log catheterization']});
export async function executeCareTool(env,id,state,text,tool,photoData=null,photoId=null){
 if(!tool||typeof tool.name!=='string'||!tool.arguments||typeof tool.arguments!=='object'||Array.isArray(tool.arguments))return clarify();
 // A second model must not rewrite visual measurements or drop their source.
 if(tool.name==='record_vitals'&&photoData&&photoId)return handleKnown(state,text,photoData,photoId);
 if(names.has(tool.name))return assistantAction(state,text,{kind:names.get(tool.name),params:tool.arguments});
 if(tool.name==='confirm_pending_action'){
  const control=conversationControl(text);if(!['approve','cancel'].includes(control)||tool.arguments.decision!==control)return clarify();
  const pending=state.proposals.filter(p=>p.status==='pending').at(-1);if(pending)return finishProposal(state,pending.id,control);
  return handleKnown(state,text)||clarify();
 }
 if(tool.name==='get_care_overview'){
  const query={tasks:'Show my tasks',medications:'Show my medications',supplies:'Show my supplies',history:'Show my history',settings:'Settings'}[tool.arguments.section];
  return query?(reminderChat(state,query)||handleKnown(state,query)||clarify()):clarify();
 }
 if(tool.name==='memory_or_resources')return await memoryChat(env,id,text,state)||clarify();
 if(tool.name==='manage_care_plan'||tool.name==='use_photo'){
  const copy=structuredClone(state);let reply=tool.name==='use_photo'&&photoData?handleKnown(copy,text,photoData,photoId):reminderChat(copy,text)||handleKnown(copy,text,null,photoId);
  if(!reply)return message('assistant','Tell me the medication, allergy, supply count or reminder setup you want to change. I will ask for any missing details.');
  const allowed=['carePlan','medStock','medicationRemove','catheterStock','supplies','caregiver','settings','medicationSchedule','catheterSchedule'];
  if(reply.proposal&&!allowed.includes(reply.proposal.kind)&&!state.draft&&!photoData)return clarify();
  if(reply.approveId||reply.cancelId)return clarify();
  Object.assign(state,copy);return reply;
 }
 return clarify();
}
export function offlineCareReply(state,text,photoData=null,photoId=null){
 let reply=reminderChat(state,text)||handleKnown(state,text,photoData,photoId);
 if(reply?.approveId)reply=finishProposal(state,reply.approveId,'approve');else if(reply?.cancelId)reply=finishProposal(state,reply.cancelId,'cancel');
 return reply||message('assistant','The AI service is unavailable. Your records were not changed. You can still review existing actions or try again shortly.');
}
