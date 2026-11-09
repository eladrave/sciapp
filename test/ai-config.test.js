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
