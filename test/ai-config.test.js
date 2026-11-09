import test from 'node:test';
import assert from 'node:assert/strict';
import { aiDefaults, validateAI, openAIResponse, chatResponse, photoResponse } from '../worker/ai-config.js';

test('OpenAI transport disables storage, converts functions, and uses independently configured models',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,request)=>{calls.push({url,request,body:JSON.parse(request.body)});return Response.json({status:'completed',output:[{type:'function_call',name:'manage_care_plan',arguments:'{}'}]});};
 try{
  const env={OPENAI_API_KEY:'synthetic-key'};
  const result=await chatResponse(env,{messages:[{role:'user',content:'Current medication schedule'}],tools:[{name:'manage_care_plan',description:'Prepare review',parameters:{type:'object',properties:{}}}]});
  assert.equal(result.tool_calls[0].name,'manage_care_plan');assert.equal(calls[0].url,'https://api.openai.com/v1/responses');assert.equal(calls[0].body.store,false);assert.equal(calls[0].body.model,'gpt-6-luna');assert.equal(calls[0].body.parallel_tool_calls,false);assert.equal(calls[0].body.tools[0].strict,false);
  await photoResponse(env,{messages:[{role:'user',content:[{type:'text',text:'Return JSON'},{type:'image_url',image_url:{url:'data:image/png;base64,synthetic'}}]}]});
  assert.equal(calls[1].body.model,'gpt-6.1-terra');assert.equal(calls[1].body.input[0].content[1].type,'input_image');assert.equal(calls[1].body.text.format.type,'json_object');
 }finally{globalThis.fetch=original;}
});
test('OpenAI errors, incomplete responses and unknown settings fail without exposing upstream secret material',async()=>{
 const env={OPENAI_API_KEY:'synthetic-key'};
 await assert.rejects(openAIResponse(env,aiDefaults,{model:'gpt-6-luna'},async()=>new Response('PRIVATE ERROR',{status:401})),e=>!e.message.includes('PRIVATE')&&e.status===503);
 await assert.rejects(openAIResponse(env,aiDefaults,{},async()=>Response.json({status:'incomplete',output:[{type:'function_call',name:'record_medication',arguments:'{}'}]})),/incomplete/);
 await assert.rejects(openAIResponse(env,aiDefaults,{},async()=>Response.json({status:'completed',output:[]})),/no usable/);
 assert.throws(()=>validateAI({...aiDefaults,chatModel:'https://evil.test'}));assert.throws(()=>validateAI({...aiDefaults,apiKey:'secret'}));assert.throws(()=>validateAI({...aiDefaults,maxOutputTokens:100000}));
 assert.deepEqual(validateAI(aiDefaults),aiDefaults);
});

test('compatible provider credentials are encrypted, scoped to a base URL and never returned by configuration',async()=>{
 const {prepareAISettings,aiConfiguration,discoverModels}=await import('../worker/ai-config.js');
 let saved={};const env={HEALTH_TOKEN_KEY:Buffer.alloc(32,7).toString('base64url'),DB:{prepare:()=>({first:async()=>({value_json:JSON.stringify(saved),version:1})})}};
 saved=await prepareAISettings(env,{...aiDefaults,baseUrl:'https://provider.example/v1',chatModel:'vendor/model:latest'},'synthetic-provider-key');
 assert.ok(saved.credentialCipher);assert.ok(!JSON.stringify(saved).includes('synthetic-provider-key'));
 const publicData=await aiConfiguration(env);assert.equal(publicData.keyConfigured,true);assert.ok(!JSON.stringify(publicData).includes('credentialCipher'));
 await assert.rejects(prepareAISettings(env,{...aiDefaults,baseUrl:'https://other.example/v1'},''),/different provider/);
 for(const url of ['http://localhost/v1','https://127.0.0.1/v1','https://user:password@provider.example/v1','https://provider.example/v1?key=secret'])assert.throws(()=>validateAI({...aiDefaults,baseUrl:url}));
 const original=globalThis.fetch;let requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,options});return Response.json({data:[{id:'vendor/model:latest'},{id:'manual-model'},{id:'manual-model'}]});};
 try{const result=await discoverModels(env,{...aiDefaults,baseUrl:'https://provider.example/v1'},'');assert.deepEqual(result.models,['manual-model','vendor/model:latest']);assert.equal(requests[0].url,'https://provider.example/v1/models');assert.equal(requests[0].options.redirect,'manual');await assert.rejects(discoverModels(env,{...aiDefaults,baseUrl:'https://other.example/v1'},''));assert.equal(requests.length,1);}finally{globalThis.fetch=original;}
});
test('Chat Completions preserves tool calls, image messages, and omits unsupported reasoning when selected',async()=>{
 const original=globalThis.fetch;const settings={...aiDefaults,baseUrl:'https://provider.example/v1',apiFormat:'chat_completions',chatModel:'vendor/model',chatReasoning:'omit'};
 const {seal}=await import('../worker/health-systems.js');const env={HEALTH_TOKEN_KEY:Buffer.alloc(32,5).toString('base64url')};settings.credentialCipher=await seal(env,'synthetic-key','ai-provider:'+settings.baseUrl);env.DB={prepare:()=>({first:async()=>({value_json:JSON.stringify(settings),version:1})})};
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://provider.example/v1/chat/completions');const body=JSON.parse(options.body);assert.equal(body.reasoning_effort,undefined);assert.equal(body.tools[0].function.name,'manage_care_plan');return Response.json({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'manage_care_plan',arguments:'{}'}}]}}]});};
 try{const result=await chatResponse(env,{messages:[{role:'user',content:'Set my schedule'}],tools:[{name:'manage_care_plan',parameters:{type:'object'}}]});assert.equal(result.tool_calls[0].function.name,'manage_care_plan');}finally{globalThis.fetch=original;}
});
