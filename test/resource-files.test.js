import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { extractResource, fileType, materialInput, uploadResource, resourceDownload } from '../worker/resource-files.js';
import { splitText } from '../worker/retrieval.js';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';

test('Office extraction preserves slide order, notes and Word text; malformed and unsupported documents need review',async()=>{
 const ppt=zipSync({'ppt/presentation.xml':strToU8('<p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst>'),'ppt/_rels/presentation.xml.rels':strToU8('<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>'),'ppt/slides/slide1.xml':strToU8('<a:p><a:r><a:t>Original first slide with sufficient text.</a:t></a:r></a:p>'),'ppt/slides/slide2.xml':strToU8('<a:p><a:r><a:t>Actual first slide &amp; accessible text.</a:t></a:r></a:p>'),'ppt/slides/_rels/slide2.xml.rels':strToU8('<Relationship Target="../notesSlides/notesSlide1.xml"/>'),'ppt/notesSlides/notesSlide1.xml':strToU8('<a:p><a:r><a:t>Notes on transfer preparation.</a:t></a:r></a:p>')});
 const r=await extractResource({},'slides.pptx',ppt);assert.equal(r.status,'extracted');assert.ok(r.text.indexOf('Actual first')<r.text.indexOf('Original first'));assert.match(r.text,/Notes on transfer preparation/);assert.match(r.text,/& accessible/);
 const word=zipSync({'word/document.xml':strToU8('<w:p><w:r><w:t>A Word document with accessible paragraph text.</w:t></w:r></w:p><w:p><w:r><w:t>A second paragraph.</w:t></w:r></w:p>')});assert.match((await extractResource({},'guide.docx',word)).text,/text\.\nA second/);
 const bomb=zipSync({'word/document.xml':new Uint8Array(9*1024*1024).fill(65)});assert.equal((await extractResource({},'too-large.docx',bomb)).status,'needs_text');
 assert.throws(()=>fileType('not-a-pdf.pdf',strToU8('HTML content')),e=>e.status===415);assert.throws(()=>fileType('run.exe',new Uint8Array(1)),e=>e.status===415);
 const pdf=await extractResource({AI:{toMarkdown:async docs=>{assert.equal(docs[0].blob.type,'application/pdf');return[{format:'markdown',data:'A sufficiently long extracted PDF text for review.'}];}}},'guide.pdf',strToU8('%PDF-1.7'));assert.equal(pdf.status,'extracted');
 const scanned=await extractResource({AI:{toMarkdown:async()=>[{format:'markdown',data:''}]}},'scan.pdf',strToU8('%PDF-1.7'));assert.equal(scanned.status,'needs_text');
 assert.equal((await extractResource({},'captions.vtt',strToU8('WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nA supplied video transcript with timestamps.'))).status,'extracted');
});

test('original files are private until a linked resource is published, then inaccessible after archive',async()=>{
 const mf=new Miniflare({workers:[{config:{name:'files',compatibilityDate:'2026-11-08',env:{DB:{type:'d1',id:'DB'},RESOURCES:{type:'r2',name:'RESOURCES'}},manifest:{mainModule:'worker.js',modules:{'worker.js':{type:'esm',contents:'export default {fetch(){return new Response("ok")}}'}}}}}]});
 try{const DB=await mf.getD1Database('DB'),RESOURCES=await mf.getR2Bucket('RESOURCES'),env={DB,RESOURCES};for(const n of ['0001_initial.sql','0004_retrieval.sql','0005_admin.sql','0006_resource_files.sql','0007_resource_transcription.sql'])await DB.exec((await readFile('migrations/'+n,'utf8')).replace(/\n/g,' '));
 const original='A sufficiently long text document to verify the private original download and indexing review.';const upload=await uploadResource(env,new File([original],'guide.txt',{type:'text/plain'}));assert.equal(upload.extractionStatus,'extracted');assert.equal(await(await resourceDownload(env,upload.id,{admin:true})).text(),original);
 await assert.rejects(resourceDownload(env,upload.id),e=>e.status===404);
 const input=await materialInput(env,{kind:'document',uploadId:upload.id,title:'Guide',text:upload.text,textKind:'extracted'});assert.equal(input.url,'/api/resources/files/'+upload.id);
 await DB.prepare("INSERT INTO retrieval_sources(id,scope,title,url,body,created_at) VALUES('r-test','shared',?,?,?,?)").bind(input.title,input.url,input.text,new Date().toISOString()).run();await DB.prepare("INSERT INTO resource_materials VALUES('r-test','document','extracted',?)").bind(upload.id).run();await DB.prepare("INSERT INTO resource_publication(source_id,status,updated_at) VALUES('r-test','draft',?)").bind(new Date().toISOString()).run();await assert.rejects(resourceDownload(env,upload.id),e=>e.status===404);
 await DB.prepare("UPDATE resource_publication SET status='published' WHERE source_id='r-test'").run();const published=await resourceDownload(env,upload.id);assert.equal(await published.text(),original);assert.match(published.headers.get('Content-Disposition'),/^attachment;/);
 await DB.prepare("UPDATE resource_publication SET status='archived' WHERE source_id='r-test'").run();await assert.rejects(resourceDownload(env,upload.id),e=>e.status===404);
 const video=await materialInput(env,{kind:'video',url:'https://www.youtube.com/watch?v=synthetic',title:'An exercise demonstration',text:'This is a curator-supplied summary, not an automatically watched video.',textKind:'summary'});assert.equal(video.kind,'video');await assert.rejects(materialInput(env,{kind:'video',url:'javascript:alert(1)',title:'Bad',text:original}),e=>e.status===400);
 await assert.rejects(uploadResource(env,new File([new Uint8Array(10*1024*1024+1)],'large.txt')),e=>e.status===413);
 }finally{await mf.dispose();}
});

test('background speech transcription uses whole media, preserves VTT, retries and never publishes automatically',async()=>{
 const {processTranscriptions}=await import('../worker/resource-transcription.js');
 const mf=new Miniflare({workers:[{config:{name:'transcription',compatibilityDate:'2026-11-08',env:{DB:{type:'d1',id:'DB'},RESOURCES:{type:'r2',name:'RESOURCES'}},manifest:{mainModule:'worker.js',modules:{'worker.js':{type:'esm',contents:'export default {fetch(){return new Response("ok")}}'}}}}}]});
 try{const DB=await mf.getD1Database('DB'),RESOURCES=await mf.getR2Bucket('RESOURCES');for(const n of ['0001_initial.sql','0004_retrieval.sql','0005_admin.sql','0006_resource_files.sql','0007_resource_transcription.sql'])await DB.exec((await readFile('migrations/'+n,'utf8')).replace(/\n/g,' '));
 let fail=false,calls=0,silent=false;const env={DB,RESOURCES,AI:{run:async(model,payload)=>{calls++;assert.equal(model,'@cf/openai/whisper-large-v3-turbo');assert.ok(payload.audio);assert.equal(payload.vad_filter,true);if(fail)throw Error('temporary');return silent?{text:''}:{text:'This synthetic recording tests the resource transcript.',vtt:'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nThis synthetic recording tests the resource transcript.'};}}};
 const media=new File(['RIFF1234WAVE synthetic audio bytes'],'recording.wav');const uploaded=await uploadResource(env,media);assert.equal(uploaded.extractionStatus,'processing');await processTranscriptions(env,uploaded.id);let row=await DB.prepare('SELECT * FROM resource_uploads WHERE id=?').bind(uploaded.id).first();assert.equal(row.extraction_status,'transcribed');assert.match(row.extracted_text,/00:00:01/);assert.ok(!splitText(row.extracted_text).join('').includes('-->'));assert.match(splitText(row.extracted_text).join(''),/synthetic/);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM retrieval_sources').first()).n,0);
 await processTranscriptions(env,uploaded.id);assert.equal(calls,1);
 fail=true;const retry=await uploadResource(env,media);for(let i=0;i<3;i++){await DB.prepare('UPDATE resource_transcription_jobs SET next_attempt_at=0 WHERE upload_id=?').bind(retry.id).run();await processTranscriptions(env,retry.id);}row=await DB.prepare('SELECT * FROM resource_uploads WHERE id=?').bind(retry.id).first();assert.equal(row.extraction_status,'needs_text');assert.match(row.extraction_note,/failed after retries/);
 fail=false;silent=true;const empty=await uploadResource(env,media);await processTranscriptions(env,empty.id);assert.equal((await DB.prepare('SELECT extraction_status FROM resource_uploads WHERE id=?').bind(empty.id).first()).extraction_status,'needs_text');
 }finally{await mf.dispose();}
});
