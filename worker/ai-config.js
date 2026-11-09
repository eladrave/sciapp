import { AppError } from './domain.js';
export const aiDefaults={provider:'openai',chatModel:'gpt-6-luna',visionModel:'gpt-6.1-terra',chatReasoning:'low',visionReasoning:'medium',maxOutputTokens:2000};
export function validateAI(config){
 if(!config||Object.keys(config).some(k=>!Object.hasOwn(aiDefaults,k))||!['openai','cloudflare'].includes(config.provider))throw new AppError('Choose an AI provider.');
 for(const key of ['chatModel','visionModel'])if(typeof config[key]!=='string'||!/^gpt-[a-z0-9.-]{1,80}$/.test(config[key]))throw new AppError('Enter an OpenAI model ID, such as gpt-6-luna.');
 for(const key of ['chatReasoning','visionReasoning'])if(!['none','low','medium','high','xhigh','max'].includes(config[key]))throw new AppError('Choose a supported reasoning effort.');
 if(!Number.isInteger(config.maxOutputTokens)||config.maxOutputTokens<1000||config.maxOutputTokens>8000)throw new AppError('Output limit must be between 1,000 and 8,000 tokens.');
 return {...config};
}
export async function aiConfiguration(env){
 const row=env.DB?await env.DB.prepare("SELECT value_json,version FROM ai_configuration WHERE id='main'").first():null;
 return {settings:{...aiDefaults,provider:env.OPENAI_API_KEY?'openai':'cloudflare',...(row?JSON.parse(row.value_json):{})},version:row?.version||0,keyConfigured:!!env.OPENAI_API_KEY};
}
// Provider errors never include upstream bodies, request content, or credentials.
export async function openAIResponse(env,config,payload,fetcher=fetch){
 if(!env.OPENAI_API_KEY)throw new AppError('OpenAI is not configured. Contact the administrator.',503);
 let response;try{response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({store:false,...payload}),signal:AbortSignal.timeout(45000),redirect:'error'});}catch{throw new AppError('The AI service did not respond. Your care records were not changed. Please retry.',503);}
 if(!response.ok){console.warn(JSON.stringify({event:'openai_request_failed',status:response.status,model:payload.model}));throw new AppError(response.status===429?'The AI service is temporarily at its usage limit. Please retry shortly.':'The configured AI model could not complete this request. Contact the administrator or retry.',503);}
 const result=await response.json();
 if(result.status!=='completed')throw new AppError('The AI response was incomplete. No action was taken. Please retry.',503);
 const calls=(result.output||[]).filter(item=>item.type==='function_call');
 const text=(result.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text).join('\n');
 if(!calls.length&&!text)throw new AppError('The AI returned no usable response. Please retry.',503);
 return {response:text,tool_calls:calls.map(c=>({name:c.name,arguments:c.arguments}))};
}
export async function chatResponse(env,payload){
 const {settings}=await aiConfiguration(env);
 if(settings.provider==='cloudflare')return env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast',payload);
 return openAIResponse(env,settings,{model:settings.chatModel,input:payload.messages,tools:payload.tools.map(t=>({type:'function',...t,strict:false})),parallel_tool_calls:false,reasoning:{effort:settings.chatReasoning},max_output_tokens:settings.maxOutputTokens});
}
export async function photoResponse(env,payload){
 const {settings}=await aiConfiguration(env);
 if(settings.provider==='cloudflare')return env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct',payload);
 const content=payload.messages[0].content.map(c=>c.type==='text'?{type:'input_text',text:c.text}:{type:'input_image',image_url:c.image_url.url,detail:'high'});
 return openAIResponse(env,settings,{model:settings.visionModel,input:[{role:'user',content}],reasoning:{effort:settings.visionReasoning},max_output_tokens:settings.maxOutputTokens,text:{format:{type:'json_object'}}});
}
