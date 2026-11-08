export const TRANSCRIPTION_MODEL='@cf/openai/whisper-large-v3-turbo';
export const mediaTypes={mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',mp4:'video/mp4',webm:'video/webm',ogg:'audio/ogg',flac:'audio/flac'};
export async function processTranscriptions(env,uploadId=null){
 if(!env.AI||!env.RESOURCES)return;
 const jobs=await env.DB.prepare("SELECT j.*,u.r2_key FROM resource_transcription_jobs j JOIN resource_uploads u ON u.id=j.upload_id WHERE j.status IN ('pending','processing') AND j.next_attempt_at<=? AND j.lease_until<?"+(uploadId?' AND j.upload_id=?':'')+' ORDER BY j.next_attempt_at LIMIT 1').bind(Date.now(),Date.now(),...(uploadId?[uploadId]:[])).all();
 for(const job of jobs.results){
  const lease=Date.now()+10*60000;const claimed=await env.DB.prepare("UPDATE resource_transcription_jobs SET status='processing',lease_until=? WHERE upload_id=? AND lease_until<? AND status IN ('pending','processing')").bind(lease,job.upload_id,Date.now()).run();if(claimed.meta.changes!==1)continue;
  try{
   const file=await env.RESOURCES.get(job.r2_key);if(!file)throw Error('Original unavailable');
   const bytes=new Uint8Array(await file.arrayBuffer()),parts=[];for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));const audio=btoa(parts.join(''));
   const result=await env.AI.run(TRANSCRIPTION_MODEL,{audio,task:'transcribe',vad_filter:true,condition_on_previous_text:false});
   const speech=typeof result.text==='string'?result.text.trim():'';const transcript=typeof result.vtt==='string'&&result.vtt.trim()?result.vtt.trim():speech;
   if(speech.length<10||transcript.length>120000){await env.DB.batch([env.DB.prepare("UPDATE resource_uploads SET extraction_status='needs_text',extraction_note=? WHERE id=?").bind(speech.length<10?'No sufficient speech was detected. Supply a reviewed summary or transcript.':'Transcript exceeds 120,000 characters. Supply a selected excerpt or summary; no transcript was silently truncated.',job.upload_id),env.DB.prepare("UPDATE resource_transcription_jobs SET status='failed',lease_until=0 WHERE upload_id=?").bind(job.upload_id)]);continue;}
   await env.DB.batch([env.DB.prepare("UPDATE resource_uploads SET extracted_text=?,extraction_status='transcribed',extraction_note=? WHERE id=?").bind(transcript,'AI-generated speech transcript. Review against the audio before publication. Visual demonstrations are not interpreted.',job.upload_id),env.DB.prepare("UPDATE resource_transcription_jobs SET status='complete',lease_until=0 WHERE upload_id=?").bind(job.upload_id)]);
  }catch{
   const failed=job.attempts>=2;
   await env.DB.batch([env.DB.prepare('UPDATE resource_transcription_jobs SET status=?,attempts=attempts+1,next_attempt_at=?,lease_until=0 WHERE upload_id=?').bind(failed?'failed':'pending',Date.now()+60000*2**job.attempts,job.upload_id),env.DB.prepare('UPDATE resource_uploads SET extraction_status=?,extraction_note=? WHERE id=?').bind(failed?'needs_text':'processing',failed?'Automatic transcription failed after retries. The original is saved; supply a reviewed summary or transcript.':'Transcription is queued for retry. You may leave this page and return to the pending uploads list.',job.upload_id)]);
   console.warn(JSON.stringify({event:'resource_transcription_retry',exhausted:failed}));
  }
 }
}
