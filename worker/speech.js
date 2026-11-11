import {AppError} from './domain.js';
import {spokenText} from '../web/speech-text.js';
// Natural spoken replies. The text of one reply is sent to the voice model and the audio is
// returned to the browser; neither is stored.
export const SPEECH_MODEL='@cf/deepgram/aura-2-en';
export const VOICES=['thalia','luna','helena','andromeda','apollo','arcas','orion'];
export const DEFAULT_VOICE='thalia';
export const MAX_SPEECH_TEXT=1200;
export function speechRequest(data){
 if(!data||typeof data!=='object'||typeof data.text!=='string')throw new AppError('Provide the text to read aloud.');
 const text=spokenText(data.text);
 if(!text)throw new AppError('Provide the text to read aloud.');
 if(text.length>MAX_SPEECH_TEXT)throw new AppError('That text is too long to read aloud in one piece.',413);
 return {text,voice:VOICES.includes(data.voice)?data.voice:DEFAULT_VOICE};
}
export async function synthesize(env,{text,voice}){
 let audio;
 try{
  const result=await env.AI.run(SPEECH_MODEL,{text,speaker:voice,encoding:'mp3'},{returnRawResponse:true});
  if(result instanceof Response){if(!result.ok)throw Error('Voice model failed');audio=await result.arrayBuffer();}
  else audio=await new Response(result).arrayBuffer();
 }catch{throw new AppError('The natural voice is unavailable right now.',503);}
 if(!audio.byteLength)throw new AppError('The natural voice is unavailable right now.',503);
 return audio;
}
