import { mediaTypes } from './resource-transcription.js';
import { unzipSync, strFromU8 } from 'fflate';
import { AppError, now, uid } from './domain.js';
import { resourceInput } from './retrieval.js';
export const MAX_FILE_BYTES=10*1024*1024;
// A whole book is accepted. D1 stores a row of at most 2 MB, so the text is capped by characters and bytes.
export const MAX_RESOURCE_TEXT=1500000,MAX_RESOURCE_BYTES=1900000;
export const resourceTextTooLarge=text=>text.length>MAX_RESOURCE_TEXT||new TextEncoder().encode(text).length>MAX_RESOURCE_BYTES;
const types={...mediaTypes,pdf:'application/pdf',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',odt:'application/vnd.oasis.opendocument.text',doc:'application/msword',ppt:'application/vnd.ms-powerpoint',txt:'text/plain',md:'text/markdown',vtt:'text/vtt',srt:'application/x-subrip'};
export function fileType(name,data){
 const extension=name.toLowerCase().split('.').at(-1);if(!Object.hasOwn(types,extension))throw new AppError('Upload PDF, PPTX, DOCX, ODT, DOC, PPT, TXT, MD, VTT, SRT, MP3, WAV, M4A, MP4, WebM, OGG or FLAC files.',415);
 if(Object.hasOwn(mediaTypes,extension)){const start=strFromU8(data.slice(0,12));const valid=extension==='wav'?start.startsWith('RIFF')&&start.endsWith('WAVE'):['mp4','m4a'].includes(extension)?start.slice(4,8)==='ftyp':extension==='webm'?[26,69,223,163].every((v,i)=>data[i]===v):extension==='ogg'?start.startsWith('OggS'):extension==='flac'?start.startsWith('fLaC'):start.startsWith('ID3')||data[0]===255&&(data[1]&224)===224;if(!valid)throw new AppError('The media file signature does not match its extension.',415);}
 if(extension==='pdf'&&strFromU8(data.slice(0,5))!=='%PDF-')throw new AppError('This file does not have a valid PDF signature.',415);
 if(['pptx','docx','odt'].includes(extension)&&!(data[0]===80&&data[1]===75&&data[2]===3&&data[3]===4))throw new AppError('This file does not have an Office document signature.',415);
 if(['doc','ppt'].includes(extension)&&[208,207,17,224,161,177,26,225].some((b,i)=>data[i]!==b))throw new AppError('This file does not have a legacy Office signature.',415);
 return {extension,mime:types[extension]};
}
function entities(text){return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,key)=>{if(key[0]==='#'){const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key.toLowerCase()];});}
function xmlText(xml,prefix){if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('External XML declarations are unsupported');return xml.split(new RegExp(`</${prefix}:p>`)).map(p=>[...p.matchAll(new RegExp(`<${prefix}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${prefix}:t>`,'g'))].map(m=>entities(m[1])).join('')).filter(Boolean).join('\n');}
function officeText(data,extension){
 let count=0,total=0;const files=unzipSync(data,{filter:file=>{count++;total+=file.originalSize;if(count>3000||total>40*1024*1024||file.originalSize>8*1024*1024)throw Error('Document exceeds safe extraction limits');return /^(?:ppt\/presentation.xml|ppt\/_rels\/presentation.xml.rels|ppt\/slides\/slide\d+.xml|ppt\/notesSlides\/notesSlide\d+.xml|ppt\/slides\/_rels\/slide\d+.xml.rels|word\/document.xml)$/.test(file.name);}});
 const read=name=>files[name]?strFromU8(files[name]):'';
 if(extension==='docx'){if(!files['word/document.xml'])throw Error('Word document text missing');return xmlText(read('word/document.xml'),'w');}
 const ordered=[];const presentation=read('ppt/presentation.xml'),rels=read('ppt/_rels/presentation.xml.rels');const relationships={};
 for(const match of rels.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)){const id=match[1].match(/\bId="([^"]+)"/)?.[1],target=match[1].match(/\bTarget="([^"]+)"/)?.[1];if(id&&target)relationships[id]=target;}
 for(const match of presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)){const target=relationships[match[1]];if(target&&/^\/?(?:ppt\/)?slides\/slide\d+\.xml$/.test(target))ordered.push(target.startsWith('/ppt/')?target.slice(1):target.startsWith('ppt/')?target:'ppt/'+target);}
 if(!ordered.length)ordered.push(...Object.keys(files).filter(n=>/^ppt\/slides\/slide\d+.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1])));
 if(!ordered.length)throw Error('Presentation slides missing');
 return ordered.map((name,i)=>{let text=`Slide ${i+1}\n${xmlText(read(name),'a')}`;const relationship=read(name.replace('/slides/','/slides/_rels/')+'.rels');const notes=relationship.match(/Target="(?:\.\.\/notesSlides\/|\/ppt\/notesSlides\/)(notesSlide\d+\.xml)"/);if(notes){const content=xmlText(read('ppt/notesSlides/'+notes[1]),'a');if(content)text+='\nSpeaker notes\n'+content;}return text;}).join('\n\n');
}
export async function extractResource(env,name,data){
 const {extension,mime}=fileType(name,data);let text='',note='';
 try{
  if(['txt','md','vtt','srt'].includes(extension)){text=new TextDecoder('utf-8',{fatal:true}).decode(data);if(text.includes('\0'))throw Error('Binary text');}
  else if(['pptx','docx'].includes(extension)){text=officeText(data,extension);note='Text extraction does not interpret images, charts, diagrams or animations. Check against the original.';}
  else if(['pdf','odt'].includes(extension)&&typeof env.AI?.toMarkdown==='function'){const raw=await env.AI.toMarkdown([{name,blob:new Blob([data],{type:mime})}]);const converted=Array.isArray(raw)?raw[0]:raw;if(converted?.format==='error'||typeof converted?.data!=='string')throw Error('Conversion failed');text=converted.data;note='Review extracted text against the original. Scanned pages, diagrams and tables may need a manual correction or summary.';}
  else note='Original file saved. Add a reviewed summary, or convert this file to PDF, PPTX or DOCX for text extraction.';
 }catch{note='Original file saved, but text extraction was unsuccessful. Add a reviewed summary or transcript before publishing.';}
 text=text.replace(/\u0000/g,'').trim();
 if(resourceTextTooLarge(text))return {mime,text:'',status:'needs_text',note:`Original file saved. Extracted text exceeds ${MAX_RESOURCE_TEXT.toLocaleString('en-US')} characters; split the document into parts, or add an excerpt or summary. Nothing was silently truncated.`};
 if(text.length<30)return {mime,text:'',status:'needs_text',note:note||'No sufficient readable text found. Add a summary or transcript before publishing.'};
 if(text.length>120000)note=`Extracted ${text.length.toLocaleString('en-US')} characters from the whole document. Images and figures are not included; spot-check the text against the original.`;
 return {mime,text,status:'extracted',note:note||'Review this text before publishing. Transcript timestamps are retained when supplied.'};
}
export async function uploadResource(env,file){
 if(!env.RESOURCES)throw new AppError('Resource file storage is not configured.',503);
 if(!file||typeof file==='string'||file.size===0||file.size>MAX_FILE_BYTES)throw new AppError('Choose a resource file between 1 byte and 10 MB.',413);
 const name=String(file.name||'resource').replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(-180),data=new Uint8Array(await file.arrayBuffer());const type=fileType(name,data);
 const id='u-'+uid(),key='originals/'+id;await env.RESOURCES.put(key,data,{httpMetadata:{contentType:type.mime}});
 try{const media=Object.hasOwn(mediaTypes,type.extension);const extracted=media?{text:'',status:'processing',note:'Automatic speech transcription is queued. You can leave this page and return to the pending uploads list.'}:await extractResource(env,name,data);const statements=[env.DB.prepare('INSERT INTO resource_uploads VALUES(?,?,?,?,?,?,?,?,?)').bind(id,key,name,type.mime,data.length,extracted.status,extracted.text,extracted.note,now())];if(media)statements.push(env.DB.prepare('INSERT INTO resource_transcription_jobs(upload_id) VALUES(?)').bind(id));await env.DB.batch(statements);return{id,fileName:name,mimeType:type.mime,size:data.length,text:extracted.text,extractionStatus:extracted.status,note:extracted.note};}catch(error){await env.RESOURCES.delete(key);throw error;}
}
// Reads the text again from the stored original for an upload that has none, such as a book
// uploaded when the size limit was lower. Media files are transcribed by their own job instead.
export async function reextractUpload(env,id){
 const row=await env.DB.prepare('SELECT id,r2_key,file_name,mime_type,extraction_status,extracted_text,extraction_note FROM resource_uploads WHERE id=?').bind(id).first();
 if(!row)throw new AppError('Upload not found.',404);
 if(row.extraction_status==='needs_text'&&!row.extracted_text&&!/^(audio|video)\//.test(row.mime_type)){
  const object=await env.RESOURCES.get(row.r2_key);if(!object)throw new AppError('The original file is no longer stored.',404);
  const extracted=await extractResource(env,row.file_name,new Uint8Array(await object.arrayBuffer()));
  await env.DB.prepare('UPDATE resource_uploads SET extraction_status=?,extracted_text=?,extraction_note=? WHERE id=?').bind(extracted.status,extracted.text,extracted.note,id).run();
  Object.assign(row,{extraction_status:extracted.status,extracted_text:extracted.text,extraction_note:extracted.note});
 }
 const {r2_key,...shown}=row;return shown;
}
export async function materialInput(env,data){
 const kind=data?.kind||'link';if(!['link','document','video'].includes(kind))throw new AppError('Choose a link, document or video.');
 const textKind=data.textKind||'summary';if(!['summary','transcript','extracted'].includes(textKind))throw new AppError('Choose a summary, transcript or extracted text.');
 let upload=null;if(data.uploadId){if(typeof data.uploadId!=='string')throw new AppError('Choose a valid uploaded file.');upload=await env.DB.prepare('SELECT id,mime_type FROM resource_uploads WHERE id=?').bind(data.uploadId).first();if(!upload)throw new AppError('Uploaded file not found.',404);}
 if(kind==='document'&&!upload)throw new AppError('Upload the original document first.');
 const ownFile=kind==='document'||kind==='video'&&upload&&!data.url&&/^(audio|video)\//.test(upload.mime_type);
 const clean=resourceInput({...data,url:ownFile?'https://resource.invalid/file':data.url},MAX_RESOURCE_TEXT);if(resourceTextTooLarge(clean.text))throw new AppError('This text is too large to store. Split the document into parts.');
 return {...clean,url:ownFile?'/api/resources/files/'+upload.id:clean.url,kind,textKind,uploadId:upload?.id||null};
}
export async function resourceDownload(env,id,{admin=false}={}){
 if(!env.RESOURCES)throw new AppError('Resource file storage is not configured.',503);
 const row=await env.DB.prepare('SELECT * FROM resource_uploads WHERE id=?').bind(id).first();if(!row)throw new AppError('File not found.',404);
 if(!admin){const published=await env.DB.prepare("SELECT m.source_id FROM resource_materials m JOIN retrieval_sources s ON s.id=m.source_id LEFT JOIN resource_publication p ON p.source_id=s.id WHERE m.upload_id=? AND s.scope='shared' AND s.deleted_at IS NULL AND COALESCE(p.status,'published')='published' LIMIT 1").bind(id).first();if(!published)throw new AppError('File not found.',404);}
 const file=await env.RESOURCES.get(row.r2_key);if(!file)throw new AppError('File not found.',404);
 return new Response(file.body,{headers:{'Content-Type':row.mime_type,'Content-Disposition':`attachment; filename="${row.file_name.replace(/[^a-z0-9._ -]/gi,'_')}"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,'Content-Length':String(row.byte_size),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
