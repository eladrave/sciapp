import test from 'node:test';
import assert from 'node:assert/strict';
import {spokenText,speechChunks} from '../web/speech-text.js';
import {speechRequest,synthesize,VOICES,DEFAULT_VOICE,SPEECH_MODEL,MAX_SPEECH_TEXT} from '../worker/speech.js';

test('reply text is turned into words a voice can say',()=>{
 assert.equal(spokenText('**860 mL** recorded since 7:00 AM today, from 3 entries.\n\n7:00 AM: 430 mL\n- 11:05 AM: 1 mL'),'860 milliliters recorded since 7:00 AM today, from 3 entries. 7:00 AM: 430 milliliters. 11:05 AM: 1 milliliter.');
 assert.equal(spokenText('Baclofen 10mg · Gabapentin 300 mg. See [the guide](https://example.org/a) or https://example.org/b'),'Baclofen 10 milligrams, Gabapentin 300 milligrams. See the guide or.');
 assert.equal(spokenText('Done.. Choose Approve or Cancel'),'Done. Choose Approve or Cancel.');
 assert.equal(spokenText('  \n '),'');assert.equal(spokenText(null),'');
});
test('long replies are split at sentence ends into pieces the voice model accepts',()=>{
 const text=Array.from({length:30},(_,i)=>`Sentence number ${i+1} is about care.`).join(' ');
 const chunks=speechChunks(text);
 assert.ok(chunks.length>2);assert.ok(chunks.every(c=>c.length<=400&&/[.]$/.test(c)));
 assert.equal(chunks.join(' '),text);
 assert.deepEqual(speechChunks('Short reply.'),['Short reply.']);assert.deepEqual(speechChunks(''),[]);
 const unbroken=speechChunks('word '.repeat(300));assert.ok(unbroken.length>3&&unbroken.every(c=>c.length<=400));
 assert.ok(speechChunks('x'.repeat(1000)).every(c=>c.length<=400));
});
test('speech requests are validated and unknown voices fall back to the default',()=>{
 assert.deepEqual(speechRequest({text:' Take **care**. ',voice:'luna'}),{text:'Take care.',voice:'luna'});
 assert.equal(speechRequest({text:'Hello',voice:'../etc'}).voice,DEFAULT_VOICE);assert.ok(VOICES.includes(DEFAULT_VOICE));
 for(const bad of [null,{},{text:5},{text:'   '},{text:'**'}])assert.throws(()=>speechRequest(bad),/Provide the text/);
 assert.throws(()=>speechRequest({text:'word '.repeat(400)}),e=>e.status===413);
 assert.ok(speechChunks('word '.repeat(2000)).every(c=>c.length<=MAX_SPEECH_TEXT));
});
test('the voice model receives the text and voice, and failures become a clear 503',async()=>{
 const calls=[];const bytes=new Uint8Array([73,68,51,4]);
 const env={AI:{run:async(...a)=>{calls.push(a);return new Response(bytes,{headers:{'content-type':'audio/mpeg'}});}}};
 const audio=await synthesize(env,{text:'Hello.',voice:'thalia'});
 assert.deepEqual([...new Uint8Array(audio)],[...bytes]);
 assert.deepEqual(calls[0],[SPEECH_MODEL,{text:'Hello.',speaker:'thalia',encoding:'mp3'},{returnRawResponse:true}]);
 assert.equal((await synthesize({AI:{run:async()=>new Blob([bytes]).stream()}},{text:'Hi',voice:'luna'})).byteLength,4);
 for(const run of [async()=>{throw Error('down');},async()=>new Response('no',{status:500}),async()=>new Response(new Uint8Array())])
  await assert.rejects(synthesize({AI:{run}},{text:'Hi',voice:'luna'}),e=>e.status===503&&/unavailable/.test(e.message));
});
