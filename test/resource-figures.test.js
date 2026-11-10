import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { findCaptions, textLines, collectFigures } from '../web/figure-captions.js';
import { saveFigure, listFigures, deleteFigures, figureDownload, figuresForReply, keywords } from '../worker/resource-figures.js';

test('captions are found at the start of a line; running prose that names a figure is not a caption',()=>{
 assert.deepEqual(findCaptions(['Figure 7 | Lower Motor Neuron Injury','Fig. 3: Skin check positions','Table 2. Daily fluid plan','FIGURE 12 – Signs of Autonomic Dysreflexia']).map(c=>[c.label,c.caption,c.strong]),[['Figure 7','Lower Motor Neuron Injury',true],['Figure 3','Skin check positions',true],['Table 2','Daily fluid plan',true],['Figure 12','Signs of Autonomic Dysreflexia',true]]);
 assert.deepEqual(findCaptions(['Figure 7 shows how the reflex arc is interrupted after injury.','Figure 8 illustrates the bowel program.','as described in Figure 9 | not at line start','Figure 10. Is a common question','Figures are helpful.','Figure']),[]);
 assert.deepEqual(findCaptions(['Figure 4','Pressure Relief in a Wheelchair','Figure 5 Transfer Board Placement']).map(c=>[c.label,c.caption,c.strong]),[['Figure 4','Pressure Relief in a Wheelchair',true],['Figure 5','Transfer Board Placement',false]]);
 assert.deepEqual(textLines([{str:'Figure 7 ',transform:[1,0,0,1,10,700]},{str:'| Lower Motor',transform:[1,0,0,1,60,700]},{str:' Neuron Injury',transform:[1,0,0,1,120,700],hasEOL:true},{str:'Body text',transform:[1,0,0,1,10,680]},{str:'next line',transform:[1,0,0,1,10,660]}]),['Figure 7 | Lower Motor Neuron Injury','Body text','next line']);
 const figures=collectFigures([{page:3,lines:['Figure 7 Overview Of The Section']},{page:40,lines:['Figure 7 | Lower Motor Neuron Injury','Table 1: Fluids']},{page:41,lines:['Figure 7 | Repeated Later']}]);
 assert.deepEqual(figures.map(f=>[f.label,f.page,f.caption]),[['Figure 7',40,'Lower Motor Neuron Injury'],['Table 1',40,'Fluids']]);
});

const jpeg=size=>{const bytes=new Uint8Array(size);bytes.set([0xff,0xd8,0xff,0xe0]);return bytes;};
const figureForm=(fields,bytes=jpeg(2000))=>{const form=new FormData();form.append('image',new File([bytes],'page.jpg',{type:'image/jpeg'}));for(const [k,v] of Object.entries({page:'40',label:'Figure 7',caption:'Lower Motor Neuron Injury',width:'1400',height:'1800',...fields}))form.append(k,v);return form;};
test('figures are stored per upload, stay private until the resource is published and attach to matching answers',async()=>{
 const mf=new Miniflare({workers:[{config:{name:'figures',compatibilityDate:'2026-11-08',env:{DB:{type:'d1',id:'DB'},RESOURCES:{type:'r2',name:'RESOURCES'}},manifest:{mainModule:'worker.js',modules:{'worker.js':{type:'esm',contents:'export default {fetch(){return new Response("ok")}}'}}}}}]});
 try{
  const DB=await mf.getD1Database('DB'),RESOURCES=await mf.getR2Bucket('RESOURCES'),env={DB,RESOURCES};
  for(const n of ['0001_initial.sql','0004_retrieval.sql','0005_admin.sql','0006_resource_files.sql','0007_resource_transcription.sql','0008_health_systems.sql','0009_ai_configuration.sql','0011_resource_figures.sql'])await DB.exec((await readFile('migrations/'+n,'utf8')).replace(/\n/g,' '));
  const stamp=new Date().toISOString();
  await DB.prepare("INSERT INTO resource_uploads VALUES('u-00000000-0000-0000-0000-000000000001','originals/u1','book.pdf','application/pdf',10,'extracted','text','',?)").bind(stamp).run();
  const upload='u-00000000-0000-0000-0000-000000000001';
  await assert.rejects(saveFigure(env,'u-missing',figureForm({})),e=>e.status===404);
  await assert.rejects(saveFigure(env,upload,figureForm({},new Uint8Array(2000))),e=>e.status===415);
  await assert.rejects(saveFigure(env,upload,figureForm({},jpeg(1500001))),e=>e.status===413);
  for(const bad of [{label:'<script>'},{page:'0'},{width:'10'},{label:'Figure'}])await assert.rejects(saveFigure(env,upload,figureForm(bad)),e=>e.status===400);
  const first=await saveFigure(env,upload,figureForm({}));
  await saveFigure(env,upload,figureForm({label:'Figure 12',caption:'Signs of Autonomic Dysreflexia',page:'88'}));
  await saveFigure(env,upload,figureForm({label:'Table 2',caption:'Daily Fluid Plan',page:'88'}));
  await saveFigure(env,upload,figureForm({label:'Figure 20',caption:'Bowel Program Positions',page:'120'}));
  const replaced=await saveFigure(env,upload,figureForm({caption:'Lower Motor Neuron Injury\u0007 (revised)'}));
  const listed=await listFigures(env,upload);assert.equal(listed.length,4);assert.equal(listed.find(f=>f.label==='Figure 7').caption,'Lower Motor Neuron Injury (revised)');assert.notEqual(first.id,replaced.id);
  assert.equal((await RESOURCES.list({prefix:'figures/'})).objects.length,4);
  // Private until a resource that uses the upload is published.
  await assert.rejects(figureDownload(env,replaced.id),e=>e.status===404);
  assert.equal((await figureDownload(env,replaced.id,{admin:true})).headers.get('Content-Type'),'image/jpeg');
  await DB.batch([DB.prepare("INSERT INTO retrieval_sources(id,scope,title,url,body,created_at) VALUES('r-book','shared','Synthetic Guide','/api/resources/files/u1','body',?)").bind(stamp),DB.prepare("INSERT INTO resource_materials VALUES('r-book','document','extracted',?)").bind(upload),DB.prepare("INSERT INTO resource_publication(source_id,status,updated_at) VALUES('r-book','draft',?)").bind(stamp)]);
  await assert.rejects(figureDownload(env,replaced.id),e=>e.status===404);
  await DB.prepare("UPDATE resource_publication SET status='published' WHERE source_id='r-book'").run();
  const shown=await figureDownload(env,replaced.id);assert.equal(shown.status,200);assert.equal(shown.headers.get('X-Content-Type-Options'),'nosniff');assert.equal((await shown.arrayBuffer()).byteLength,2000);
  // Matching answers.
  const source=(body,score=0.8)=>({upload_id:upload,title:'Synthetic Guide',body,score});
  let figures=await figuresForReply(env,'What are the signs of autonomic dysreflexia?',[source('AD is a sudden rise in blood pressure.')],'It is a sudden rise in blood pressure.');
  assert.deepEqual(figures.map(f=>f.label),['Figure 12']);assert.equal(figures[0].url,'/api/resources/figures/'+figures[0].id);assert.equal(figures[0].title,'Synthetic Guide');assert.equal(figures[0].page,88);assert.equal(figures[0].width,1400);
  figures=await figuresForReply(env,'How does a flaccid bowel work?',[source('A lower motor neuron injury (see Figure 7) leaves the bowel flaccid.')],'The bowel is flaccid.');
  assert.deepEqual(figures.map(f=>f.label),['Figure 7','Figure 20']);
  figures=await figuresForReply(env,'How should I sit?',[source('Positions are described in the text.')],'As Figure 20 shows, lean forward.');
  assert.deepEqual(figures.map(f=>f.label),['Figure 20']);
  // Never two images of the same page, never more than two, nothing for unrelated questions or sources without an upload.
  figures=await figuresForReply(env,'daily fluid plan and autonomic dysreflexia signs with bowel program positions',[source('text')],'');
  assert.equal(figures.length,2);assert.equal(new Set(figures.map(f=>f.page)).size,2);
  assert.deepEqual(await figuresForReply(env,'What time is it?',[source('Unrelated passage.')],'It is noon.'),[]);
  assert.deepEqual(await figuresForReply(env,'autonomic dysreflexia',[{title:'Seed',body:'x'}],''),[]);
  assert.ok(!mentionsFigure17(await figuresForReply(env,'see figure 1',[source('x')],'')));
  assert.deepEqual([...keywords('What are the injuries and bladder programs?')].sort(),['bladder','program']);
  assert.equal(await deleteFigures(env,upload),4);assert.equal((await RESOURCES.list({prefix:'figures/'})).objects.length,0);assert.deepEqual(await listFigures(env,upload),[]);
 }finally{await mf.dispose();}
});
const mentionsFigure17=figures=>figures.some(f=>['Figure 12','Figure 20'].includes(f.label));
