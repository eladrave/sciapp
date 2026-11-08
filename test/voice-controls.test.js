import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual frontend lifecycle with a simulated browser microphone.
function setup() {
 const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
 const element = () => ({ textContent:'', value:'', setAttribute(name,value) { this[name] = value; } });
 const ui = Object.fromEntries(['voice','voice-label','recording-status','composer-hint','message','app'].map(key => [key,element()]));
 const timers = new Map(); let timerId = 0;
 const context = vm.createContext({ui, state:{settings:{handsFree:true,voicePauseMs:5000},messages:[]},handsFreePaused:false,handsFreeRunning:false,handsFreeRecognition:null,assistantSpeaking:false,busy:false,uploadBusy:false,recording:false,manualVoiceActive:false,accountGeneration:0,activePage:'Conversation',silenceTimer:null,navigator:{language:'en-US'},document:{visibilityState:'visible'},window:{},setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},error(){},renderPanel(){},confirmationDelay:()=>5000,sends:0,send(){context.sends++;}});
 context.window.SpeechRecognition = class {start(){this.started=true;}abort(){this.aborted=true;}};
 vm.runInContext(source.slice(source.indexOf('function syncVoiceControl()'),source.indexOf("document.addEventListener('visibilitychange'")),context);
 return {context,ui,timers,run:code=>vm.runInContext(code,context)};
}
test('Pause aborts microphone, cancels auto-send and ignores late speech',()=>{
 const {context:c,ui,timers,run}=setup();run('resumeHandsFree()');
 const microphone=c.handsFreeRecognition,lateResult=microphone.onresult;
 microphone.onresult({results:[Object.assign([{transcript:'Draft words'}],{isFinal:true})]});
 assert.equal(timers.size,1);run('toggleHandsFreePause()');
 assert.equal(microphone.aborted,true);assert.equal(timers.size,0);
 assert.equal(c.state.settings.handsFree,true);assert.equal(ui['voice-label'].textContent,'Listen');
 assert.equal(ui.voice['aria-label'],'Resume listening');assert.equal(ui['recording-status'].textContent,'Listening paused');
 lateResult({results:[[{transcript:'TV dialogue'}]]});assert.equal(ui.message.value,'Draft words');
 run('resumeHandsFree()');assert.equal(c.handsFreeRecognition,null);assert.equal(c.sends,0);
 run('toggleHandsFreePause()');assert.equal(c.handsFreeRecognition.started,true);assert.equal(ui['voice-label'].textContent,'Pause');
 assert.equal(ui.message.value,'Draft words');
});
test('Pause works while a reply is busy, resumes only after Listen',()=>{
 const {context:c,ui,run}=setup();c.busy=true;c.assistantSpeaking=true;
 run('toggleHandsFreePause()');assert.equal(ui['voice-label'].textContent,'Listen');
 c.busy=false;c.assistantSpeaking=false;run('resumeHandsFree()');assert.equal(c.handsFreeRecognition,null);
 run('toggleHandsFreePause()');assert.equal(c.handsFreeRecognition.started,true);
 run('stopHandsFree()');c.document.visibilityState='hidden';run('resumeHandsFree()');assert.equal(c.handsFreeRecognition,null);
 c.document.visibilityState='visible';run('resumeHandsFree()');assert.equal(c.handsFreeRecognition.started,true);
 c.state.settings.handsFree=false;run('stopHandsFree()');assert.equal(ui['voice-label'].textContent,'Talk');
});
test('Microphone failure offers Listen to retry',()=>{
 const {context:c,ui,run}=setup();run('resumeHandsFree()');c.handsFreeRecognition.onerror({error:'not-allowed'});
 assert.equal(c.handsFreePaused,true);assert.equal(ui['voice-label'].textContent,'Listen');
 run('toggleHandsFreePause()');assert.equal(c.handsFreeRecognition.started,true);
});
