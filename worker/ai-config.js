import { seal, unseal } from './health-systems.js';
import { publicURL, readJSON } from './health-providers.js';
import { AppError } from './domain.js';
export const aiDefaults={provider:'openai',baseUrl:'https://api.openai.com/v1',apiFormat:'responses',chatModel:'gpt-6-luna',visionModel:'gpt-6.1-terra',chatReasoning:'low',visionReasoning:'medium',maxOutputTokens:2000};
export function validateAI(config){
 if(!config||Object.keys(config).some(k=>!Object.hasOwn(aiDefaults,k))||!['openai','cloudflare'].includes(config.provider))throw new AppError('Choose an AI provider.');
 if(!['responses','chat_completions'].includes(config.apiFormat||'responses'))throw new AppError('Choose Responses or Chat Completions.');
 for(const key of ['chatModel','visionModel'])if(typeof config[key]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(config[key])||config[key].includes('://'))throw new AppError('Enter a valid provider model ID.');
 for(const key of ['chatReasoning','visionReasoning'])if(!['omit','none','low','medium','high','xhigh','max'].includes(config[key]))throw new AppError('Choose a supported reasoning effort.');
 if(!Number.isInteger(config.maxOutputTokens)||config.maxOutputTokens<1000||config.maxOutputTokens>8000)throw new AppError('Output limit must be between 1,000 and 8,000 tokens.');
 return {...config,baseUrl:providerURL(config.baseUrl||aiDefaults.baseUrl)};
}
export function providerURL(value){const u=publicURL(value);if(u.search)throw new AppError('The base URL must not include query parameters.');return u.href.replace(/\/$/,'');}
async function savedAI(env){const row=env.DB?await env.DB.prepare("SELECT value_json,version FROM ai_configuration WHERE id='main'").first():null;return {row,data:row?JSON.parse(row.value_json):{}};}
export async function aiConfiguration(env){
 const {row,data}=await savedAI(env);const {credentialCipher,...publicData}=data;
 const settings={...aiDefaults,provider:env.OPENAI_API_KEY?'openai':'cloudflare',...publicData};
 return {settings,version:row?.version||0,keyConfigured:!!credentialCipher||(settings.baseUrl===aiDefaults.baseUrl&&!!env.OPENAI_API_KEY)};
}
async function providerKey(env,config){const {data}=await savedAI(env);if(data.credentialCipher&&providerURL(data.baseUrl||aiDefaults.baseUrl)===config.baseUrl)return unseal(env,data.credentialCipher,'ai-provider:'+config.baseUrl);return config.baseUrl===aiDefaults.baseUrl?env.OPENAI_API_KEY:null;}
export async function prepareAISettings(env,input,key){
 const settings=validateAI({...aiDefaults,...input});const {data}=await savedAI(env);
 if(key!==undefined&&(typeof key!=='string'||key.length>4096||/[\r\n]/.test(key)))throw new AppError('Enter a valid API key.');
 let credentialCipher;
 if(key)credentialCipher=await seal(env,key,'ai-provider:'+settings.baseUrl);
 else if(data.credentialCipher&&providerURL(data.baseUrl||aiDefaults.baseUrl)===settings.baseUrl)credentialCipher=data.credentialCipher;
 if(settings.provider==='openai'&&!credentialCipher&&!(settings.baseUrl===aiDefaults.baseUrl&&env.OPENAI_API_KEY))throw new AppError('Provide a key for this base URL. Existing keys are never forwarded to a different provider.',400);
 return {...settings,...(credentialCipher?{credentialCipher}:{})};
}
async function providerRequest(env,config,path,body,fetcher=fetch,keyOverride){
 const key=keyOverride||await providerKey(env,config);if(!key)throw new AppError('Set an API key for this provider.',503);
 let response;try{response=await fetcher(providerURL(config.baseUrl||aiDefaults.baseUrl)+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000),redirect:'error'});}catch{throw new AppError('The AI provider did not respond. Please retry.',503);}
 if(!response.ok){await response.body?.cancel();throw new AppError(`AI provider request failed (HTTP ${response.status}). Check the URL, key and model configuration.`,503);}
 return readJSON(response,2000000);
}
export async function discoverModels(env,input,key){const config=validateAI({...aiDefaults,...input});if(key!==undefined&&(typeof key!=='string'||key.length>4096||/[\r\n]/.test(key)))throw new AppError('Invalid API key.');const result=await providerRequest(env,config,'/models',null,fetch,key);if(!Array.isArray(result.data))throw new AppError('This provider did not return an OpenAI-compatible model list.',502);return {models:[...new Set(result.data.map(m=>m.id).filter(id=>typeof id==='string'&&id.length<=200))].sort().slice(0,1000)};}
// Provider errors never include upstream bodies, request content, or credentials.
export async function openAIResponse(env,config,payload,fetcher=fetch){
 const result=await providerRequest(env,config,'/responses',{store:false,...payload},fetcher);
 if(result.status!=='completed')throw new AppError('The AI response was incomplete. No action was taken. Please retry.',503);
 const calls=(result.output||[]).filter(item=>item.type==='function_call');
 const text=(result.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text).join('\n');
 if(!calls.length&&!text)throw new AppError('The AI returned no usable response. Please retry.',503);
 return {response:text,tool_calls:calls.map(c=>({name:c.name,arguments:c.arguments}))};
}
export async function chatResponse(env,payload){
 const {settings}=await aiConfiguration(env);
 if(settings.provider==='cloudflare')return env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast',payload);
 if(settings.apiFormat==='chat_completions')return completionResponse(env,settings,payload,settings.chatModel,settings.chatReasoning);
 return openAIResponse(env,settings,{model:settings.chatModel,input:payload.messages,tools:payload.tools.map(t=>({type:'function',...t,strict:false})),parallel_tool_calls:false,...(settings.chatReasoning==='omit'?{}:{reasoning:{effort:settings.chatReasoning}}),max_output_tokens:settings.maxOutputTokens});
}
export async function photoResponse(env,payload){
 const {settings}=await aiConfiguration(env);
 if(settings.provider==='cloudflare')return env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct',payload);
 if(settings.apiFormat==='chat_completions')return completionResponse(env,settings,payload,settings.visionModel,settings.visionReasoning);
 const content=payload.messages[0].content.map(c=>c.type==='text'?{type:'input_text',text:c.text}:{type:'input_image',image_url:c.image_url.url,detail:'high'});
 return openAIResponse(env,settings,{model:settings.visionModel,input:[{role:'user',content}],...(settings.visionReasoning==='omit'?{}:{reasoning:{effort:settings.visionReasoning}}),max_output_tokens:settings.maxOutputTokens,text:{format:{type:'json_object'}}});
}

async function completionResponse(env,config,payload,model,effort){
 const data=await providerRequest(env,config,'/chat/completions',{model,messages:payload.messages,max_tokens:config.maxOutputTokens,...(effort==='omit'?{}:{reasoning_effort:effort}),...(payload.tools?{tools:payload.tools.map(t=>({type:'function',function:t})),parallel_tool_calls:false}:{})});
 const choice=data.choices?.[0];if(!choice||!['stop','tool_calls'].includes(choice.finish_reason))throw new AppError('The AI response was incomplete. No action was taken.',503);
 return {response:choice.message?.content||'',tool_calls:choice.message?.tool_calls||[]};
}
