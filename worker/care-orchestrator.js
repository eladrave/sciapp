import {interpret} from './conversation.js';
import {healthTool} from './health-systems.js';
import {executeCareTool} from './chat-tools.js';
import {agentCareTools,pendingCare,structuredCareTool} from './care-agent.js';
import {message,AppError} from './domain.js';
const structured=new Set(agentCareTools.map(t=>t.name));
const readHealth=new Set(['search_health_systems','list_health_connections','list_imported_health_records','review_imported_health_record']);
export async function runCareAgent(env,id,state,text,initialContext={},model=interpret){
 if(initialContext.photoId&&initialContext.photoData)state.careObservation={photoId:initialContext.photoId,photoData:initialContext.photoData,originalUserText:text,createdAt:Date.now(),awaitingReview:true};
 const observation=state.careObservation;
 if(!initialContext.photoId&&observation&&Date.now()-observation.createdAt<30*60000&&(observation.awaitingReview||pendingCare(state)?.params.photoId===observation.photoId))initialContext={...initialContext,photoId:observation.photoId,photoData:observation.photoData};
 const turnId=crypto.randomUUID();
 const context={...initialContext,agentMode:true,toolTrace:[],resolvedTimes:{},reviewTimeRefs:{},originalPendingIds:new Set(state.proposals.filter(p=>p.status==='pending').map(p=>p.id))};
 for(let step=0;step<6;step++){
  const result=await model(env,state,text,context);
  if(result.kind!=='tool'){const content=String(result.content||'What would you like to record?').slice(0,4000);const question=content.includes('?')||/reply.*yes|type.*yes/i.test(content);return message('assistant',content,{sources:result.sources||[],...(question?{options:/\b(?:yes|no)\b/i.test(content)||/\b(?:do you|would you|should i|shall i|is this|are these)\b/i.test(content)?['Yes','No','Cancel']:['I need help','Cancel'],questionId:crypto.randomUUID(),answerHint:'Choose a button, or type or say any other answer.'}:{})});}
  const tool=result.tool,callId=tool.callId||crypto.randomUUID();let observation;console.info(JSON.stringify({event:'care_agent_tool',turnId,step:step+1,tool:structured.has(tool.name)||readHealth.has(tool.name)||/^(?:memory_or_resources|connect_health_system|sync_health_records|prepare_imported_medication|set_health_auto_sync|disconnect_health_system|delete_imported_health_records|confirm_health_connection_action)$/.test(tool.name)?tool.name:'unsupported_tool'}));
  try{
   if(tool.name==='search_resources'){
    const query=String(tool.arguments?.query||'').trim().slice(0,300);if(!query)throw new AppError('Provide a topic to search for.');
    const found=await (context.search?context.search(query):Promise.resolve({sources:[],memories:[]}));
    // Passages found here join the turn's sources so the reply can cite them and show their figures.
    context.sources||=[];
    for(const source of found.sources||[])if(!context.sources.some(s=>s.url===source.url&&s.text===source.text))context.sources.unshift(source);
    observation={passages:(found.sources||[]).map(s=>({resource:s.title,text:s.text})),memories:(found.memories||[]).map(m=>m.body),note:(found.sources||[]).length?'Answer from these passages and name the resource.':'Nothing in the resources matches this query. Try one different wording once; otherwise say the resources do not cover it yet.'};
   }else if(structured.has(tool.name)){
    const executed=await structuredCareTool(state,text,tool,context);if(executed.reply)return executed.reply;observation=executed.observation;
   }else if(readHealth.has(tool.name)){const read=await healthTool(env,id,state,text,tool);observation=read;}
   else if(/health|imported/.test(tool.name))return await healthTool(env,id,state,text,tool);
   else if(tool.name==='memory_or_resources')return await executeCareTool(env,id,state,text,tool);
   else throw new AppError('This action must use the typed prepare_care_change or revise_care_change tool.');
  }catch(error){if(!(error instanceof AppError))throw error;observation={error:error.message,noChangesMade:true};}
  context.toolTrace.push({role:'assistant',content:null,tool_calls:[{id:callId,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]},{role:'tool',tool_call_id:callId,content:JSON.stringify(observation).slice(0,24000)});
 }
 return message('assistant','I could not resolve this reliably within this turn. No care change was saved. Please clarify the detail you want to record.');
}
