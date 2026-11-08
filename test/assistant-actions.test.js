import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, proposal } from '../worker/domain.js';
import { assistantAction } from '../worker/assistant-actions.js';
import { handleKnown, interpret } from '../worker/conversation.js';
const correction='No,\nThis was just my schedule, so you can keep track of it, and remind me';
function state(){const s=initialState({real:true});s.medications=[{id:'alpha',name:'Sample Alpha',dosage:'2 mg',frequency:'twice daily',times:[],stock:40,unit:'tablets',unitsPerDose:1,unitsConfigured:true,active:true}];return s;}
test('AI settings omit unset optional fields, normalize explicit booleans and ignore unrelated changes',()=>{
 const s=state();const r=assistantAction(s,'Make the font larger',{kind:'settings',params:{textScale:1.25,muted:null,handsFree:false}});
 assert.deepEqual(r.proposal.changedSettings,['textScale']);assert.equal(s.settings.muted,true);
 const sound=assistantAction(s,'Turn mute off',{kind:'settings',params:{muted:'false'}});assert.ok(sound.proposal);assert.equal(s.proposals.at(-1).params.muted,false);
 for(const value of [null,'maybe',{},0]){const r=assistantAction(s,'Turn mute off',{kind:'settings',params:{muted:value}});assert.equal(r.proposal,undefined);}
 assert.equal(assistantAction(s,correction,{kind:'settings',params:{muted:'false'}}).proposal,undefined);
 assert.throws(()=>proposal(s,'settings',{muted:null}),/Mute must be on or off/);
});
test('malformed actions ask for clarification without throwing or recording care',()=>{
 for(const action of [null,{kind:4,params:{}},{kind:'__proto__',params:{}},{kind:'settings',params:[]},{kind:'vitals',params:{systolic:1000}}]){const s=state();assert.equal(assistantAction(s,'Help',action).proposal,undefined);assert.equal(s.events.length,0);assert.equal(s.proposals.length,0);}
});
test('recurring medication descriptions cannot become doses or invented reminder times',()=>{
 const s=state();for(const text of ['I take Sample Alpha twice daily',correction,"I did not take Sample Alpha"]){assert.equal(assistantAction(s,text,{kind:'medication',params:{medicationId:'alpha'}}).proposal,undefined);}
 assert.equal(assistantAction(s,'Remind me twice daily',{kind:'medicationSchedule',params:{medicationId:'alpha',times:['08:00','20:00']}}).proposal,undefined);
 assert.equal(assistantAction(s,'Remind me at 8am and 8pm',{kind:'medicationSchedule',params:{medicationId:'alpha',times:['08:00','20:00']}}).proposal.kind,'medicationSchedule');
 assert.equal(s.medications[0].stock,40);assert.deepEqual(s.medications[0].times,[]);
});
test('schedule clarification cancels pending dose and asks times without stock deduction',()=>{
 const s=state();const dose=proposal(s,'medication',{medicationId:'alpha'});s.messages.push(dose);
 const reply=handleKnown(s,correction);assert.match(reply.content,/What times/);assert.equal(s.proposals[0].status,'cancelled');assert.equal(s.medications[0].stock,40);assert.equal(s.events.length,0);
 const times=handleKnown(s,'08:00 and 20:00');assert.equal(times.proposal.kind,'medicationSchedule');assert.deepEqual(s.medications[0].times,[]);
});
test('AI history contains reviewed context and does not duplicate the current utterance',async()=>{
 const s=state();s.messages.push(proposal(s,'medication',{medicationId:'alpha'}));s.messages.push({role:'user',content:'A clarification'});let payload;
 await interpret({AI:{run:async(_,body)=>{payload=body;return {response:{kind:'reply',content:'Hello'}};}}},s,'A clarification');
 assert.equal(payload.messages.filter(m=>m.role==='user'&&m.content==='A clarification').length,1);
 assert.ok(payload.messages.some(m=>m.content.includes('Sample Alpha')&&m.content.includes('Review (pending)')));
});
