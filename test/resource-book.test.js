import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8 } from 'fflate';
import { extractResource, materialInput, uploadResource, MAX_RESOURCE_TEXT } from '../worker/resource-files.js';
import { splitText, chunkInsertStatements, processIndexJobs } from '../worker/retrieval.js';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';

// Synthetic book text: numbered sentences so every chunk can be traced back.
const book=Array.from({length:9000},(_,i)=>`Sentence ${i} explains a synthetic self-care topic in plain words.`).join(' ');
const pdfEnv=text=>({AI:{toMarkdown:async()=>[{format:'markdown',data:text}]}});

test('a whole book is extracted automatically instead of asking for a manual summary',async()=>{
 assert.ok(book.length>500000&&book.length<MAX_RESOURCE_TEXT);
 const r=await extractResource(pdfEnv(book),'book.pdf',strToU8('%PDF-1.7'));
 assert.equal(r.status,'extracted');assert.equal(r.text,book);assert.match(r.note,/whole document/);assert.match(r.note,/Images and figures are not included/);
 const huge=await extractResource(pdfEnv('x'.repeat(MAX_RESOURCE_TEXT+1)),'huge.pdf',strToU8('%PDF-1.7'));
 assert.equal(huge.status,'needs_text');assert.equal(huge.text,'');assert.match(huge.note,/Nothing was silently truncated/);
 const multibyte=await extractResource(pdfEnv('é'.repeat(1000000)),'bytes.pdf',strToU8('%PDF-1.7'));assert.equal(multibyte.status,'needs_text');
});
test('chunks end at word boundaries and lose no words',()=>{
 const chunks=splitText(book);
 assert.ok(chunks.every(c=>c.length<=500&&c.length>0));assert.ok(chunks.every(c=>/^Sentence|^\S/.test(c)&&!/\s$/.test(c)));
 assert.equal(chunks.join(' '),book);
 assert.deepEqual(splitText('x'.repeat(1200)).map(c=>c.length),[500,500,200]);
});
test('a book is stored, chunked in a few statements and indexed in groups',async()=>{
 const mf=new Miniflare({workers:[{config:{name:'book',compatibilityDate:'2026-11-08',env:{DB:{type:'d1',id:'DB'},RESOURCES:{type:'r2',name:'RESOURCES'}},manifest:{mainModule:'worker.js',modules:{'worker.js':{type:'esm',contents:'export default {fetch(){return new Response("ok")}}'}}}}}]});
 try{
  const DB=await mf.getD1Database('DB'),RESOURCES=await mf.getR2Bucket('RESOURCES');
  for(const n of ['0001_initial.sql','0004_retrieval.sql','0005_admin.sql','0006_resource_files.sql','0007_resource_transcription.sql','0008_health_systems.sql','0009_ai_configuration.sql'])await DB.exec((await readFile('migrations/'+n,'utf8')).replace(/\n/g,' '));
  const upload=await uploadResource({DB,RESOURCES,...pdfEnv(book)},new File(['%PDF-1.7 synthetic'],'book.pdf',{type:'application/pdf'}));
  assert.equal(upload.extractionStatus,'extracted');assert.equal(upload.text.length,book.length);
  const input=await materialInput({DB},{kind:'document',uploadId:upload.id,title:'Synthetic book',text:upload.text,textKind:'extracted'});assert.equal(input.text.length,book.length);
  await assert.rejects(materialInput({DB},{kind:'document',uploadId:upload.id,title:'Too big',text:'x'.repeat(MAX_RESOURCE_TEXT+1),textKind:'extracted'}),e=>e.status===400);
  const stamp=new Date().toISOString();
  await DB.batch([DB.prepare("INSERT INTO retrieval_sources(id,scope,title,url,body,created_at) VALUES('r-book','shared',?,?,?,?)").bind(input.title,input.url,input.text,stamp),DB.prepare("INSERT INTO resource_publication(source_id,status,updated_at,revision_id) VALUES('r-book','published',?,'rev-1')").bind(stamp)]);
  const expected=splitText(book),statements=chunkInsertStatements({DB},'r-book',book,'EXISTS(SELECT 1 FROM resource_publication WHERE source_id=? AND revision_id=?)',['r-book','rev-1']);
  assert.equal(statements.length,Math.ceil(expected.length/100));assert.ok(statements.length<20);
  await DB.batch(statements);
  assert.equal((await DB.prepare("SELECT COUNT(*) n FROM retrieval_chunks WHERE source_id='r-book'").first()).n,expected.length);
  for(const i of [0,99,100,expected.length-1])assert.equal((await DB.prepare('SELECT body FROM retrieval_chunks WHERE id=?').bind('r-book-'+i).first()).body,expected[i]);
  // A wrong revision inserts nothing.
  await DB.batch(chunkInsertStatements({DB},'r-other',book,'EXISTS(SELECT 1 FROM resource_publication WHERE source_id=? AND revision_id=?)',['r-book','stale']));
  assert.equal((await DB.prepare("SELECT COUNT(*) n FROM retrieval_chunks WHERE source_id='r-other'").first()).n,0);
  // Indexing: one embedding call and one upsert per group of 50.
  let embedCalls=0,upserts=0,failGroup=false;const stored=new Map();
  const index={upsert:async rows=>{upserts++;for(const r of rows)stored.set(r.id,r);},deleteByIds:async()=>{},query:async()=>({matches:[]})};
  const env={DB,AI:{run:async(model,{text})=>{embedCalls++;if(failGroup&&text.length>1)throw Error('group failure');return {data:text.map(()=>Array(768).fill(0.1))};}},PERSONAL_MEMORY:index,SHARED_RESOURCES:index};
  assert.equal(await processIndexJobs(env,50),50);assert.equal(embedCalls,1);assert.equal(upserts,1);assert.equal(stored.size,50);assert.ok([...stored.values()].every(r=>r.namespace==='shared'));
  assert.equal((await DB.prepare("SELECT COUNT(*) n FROM retrieval_chunks WHERE source_id='r-book' AND indexed_at IS NOT NULL").first()).n,50);
  // A failing group falls back to one chunk at a time, so nothing is lost.
  failGroup=true;embedCalls=0;assert.equal(await processIndexJobs(env,5),5);assert.equal(embedCalls,6);assert.equal(stored.size,55);
  failGroup=false;let rounds=0;while(await processIndexJobs(env,50))rounds++;
  assert.equal(stored.size,expected.length);assert.equal(rounds,Math.ceil((expected.length-55)/50));
  assert.equal((await DB.prepare("SELECT COUNT(*) n FROM retrieval_chunks WHERE source_id='r-book' AND indexed_at IS NULL").first()).n,0);
 }finally{await mf.dispose();}
});
