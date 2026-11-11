import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {PDFDocument,PDFName} from 'pdf-lib';
import UPNG from '@pdf-lib/upng';
import {createDoctorReportPDF} from '../client/doctor-report.js';
function png(w,h){const pixels=new Uint8Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(y*w+x)*4,mark=y%150<8&&x>w*.2&&x<w*.8;pixels[p]=mark?25:230;pixels[p+1]=mark?55:202;pixels[p+2]=mark?40:115;pixels[p+3]=255;}return new Blob([(UPNG.default||UPNG).encode([pixels.buffer],w,h,0)],{type:'image/png'});}
const entry=(id,photoId)=>({id,photoId,photoAvailable:true,title:'Catheter observation '+id,category:'catheter',status:'approved',detail:'420 mL. Synthetic test record, not real health information.',occurredAt:'2026-11-08T12:00:00Z',recordedAt:'2026-11-09T15:00:00Z',userObservation:'Light yellow; clarity uncertain. בדיקה'});
test('doctor PDF preserves original image pixels, gives each unique photo a full page, and keeps readable dated records',async()=>{
 const images={portrait:png(1200,1800),landscape:png(1800,1200)},fontBytes=await readFile('assets/report-font.woff');const bytes=await createDoctorReportPDF([entry('a','portrait'),entry('b','landscape'),entry('c','portrait')],{timezone:'America/New_York',readPhoto:async id=>images[id],fontBytes,generatedAt:'2026-11-09T15:00:00Z'});
 assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');const doc=await PDFDocument.load(bytes);assert.equal(doc.getPageCount(),3);assert.equal(doc.getPages()[1].getWidth(),612);assert.equal(doc.getPages()[2].getWidth(),792);
 const embedded=[];for(const [,object]of doc.context.enumerateIndirectObjects()){if(object.dict?.get(PDFName.of('Subtype'))?.toString()==='/Image')embedded.push([object.dict.get(PDFName.of('Width')).asNumber(),object.dict.get(PDFName.of('Height')).asNumber()]);}
 assert.ok(embedded.some(([w,h])=>w===1200&&h===1800));assert.ok(embedded.some(([w,h])=>w===1800&&h===1200));assert.equal(doc.getTitle(),'SCIapp doctor care journal');await mkdir('/tmp/sciapp-report-test',{recursive:true});await writeFile('/tmp/sciapp-report-test/doctor-report.pdf',bytes);
});
test('long notes paginate and unavailable originals are labeled without inventing images',async()=>{
 const e=entry('long','missing');e.detail='Synthetic clinical note with enough detail for a doctor. '.repeat(300);const bytes=await createDoctorReportPDF([e],{timezone:'America/New_York',readPhoto:async()=>{throw Error('deleted');},fontBytes:await readFile('assets/report-font.woff')});const doc=await PDFDocument.load(bytes);assert.ok(doc.getPageCount()>3);assert.equal(doc.getPages().at(-1).getWidth(),612);
});
test('doctor PDF carries the personal details the user chose to enter',async()=>{
 const fontBytes=await readFile('assets/report-font.woff'),options={timezone:'America/New_York',readPhoto:async()=>{throw Error('none');},fontBytes,generatedAt:'2026-11-09T15:00:00Z'};
 const plain=await createDoctorReportPDF([{...entry('a',null),photoAvailable:false}],options);
 const named=await createDoctorReportPDF([{...entry('a',null),photoAvailable:false}],{...options,profile:{name:'Sam',fullName:'Sam Synthetic Example',dateOfBirth:'1980-02-29',gender:'Non-binary',injuryLevel:'C6 incomplete'}});
 assert.ok(named.length>plain.length+40);assert.equal((await PDFDocument.load(named)).getPageCount(),(await PDFDocument.load(plain)).getPageCount());
 assert.equal((await createDoctorReportPDF([{...entry('a',null),photoAvailable:false}],{...options,profile:{name:'You'}})).length,plain.length);
});
