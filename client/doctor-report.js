import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

function jpegOrientation(bytes){
 try{const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let p=2,segments=0;p+4<bytes.length&&segments++<1024;){if(bytes[p]!==255)break;const marker=bytes[p+1],n=v.getUint16(p+2);if(marker===218||n<2||p+2+n>bytes.length)break;if(marker===225&&String.fromCharCode(...bytes.subarray(p+4,p+10))==='Exif\0\0'){const base=p+10,little=v.getUint16(base)===0x4949;if(v.getUint16(base+2,little)!==42)return 1;const ifd=base+v.getUint32(base+4,little),count=v.getUint16(ifd,little);if(count>256)return 1;for(let i=0;i<count;i++){const q=ifd+2+i*12;if(v.getUint16(q,little)===274&&v.getUint16(q+2,little)===3&&v.getUint32(q+4,little)===1){const o=v.getUint16(q+8,little);return o>=1&&o<=8?o:1;}}}p+=n+2;}}catch{}return 1;
}
async function normalizedPng(blob){
 let image,close=()=>{};
 if(typeof createImageBitmap==='function'){image=await createImageBitmap(blob,{imageOrientation:'from-image'});close=()=>image.close();}
 else{const url=URL.createObjectURL(blob);image=new Image();try{image.src=url;await image.decode();}catch(e){URL.revokeObjectURL(url);throw e;}close=()=>URL.revokeObjectURL(url);}
 try{const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;if(!width||!height)throw Error('The original image could not be decoded.');const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,0,0);const png=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Image conversion failed.')),'image/png'));return new Uint8Array(await png.arrayBuffer());}finally{close();}
}

export async function createDoctorReportPDF(entries,{timezone,readPhoto,fontBytes,generatedAt=new Date().toISOString(),convertImage=normalizedPng}={}){
 if(!entries?.length)throw Error('Choose journal entries before creating a PDF.');
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(fontBytes,{subset:true});
 pdf.setTitle('SCIapp doctor care journal');pdf.setCreator('SCIapp');pdf.setSubject('User-entered care records and original photo evidence');pdf.setLanguage('en-US');
 const supported=new Set(font.getCharacterSet());let missingGlyphs=false;
 const text=value=>Array.from(String(value??'')).map(c=>{if(c==='\n'||c==='\t'||supported.has(c.codePointAt(0)))return c;missingGlyphs=true;return '[U+'+c.codePointAt(0).toString(16).toUpperCase()+']';}).join('');
 const local=value=>new Intl.DateTimeFormat('en-US',{timeZone:timezone||'UTC',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 const dark=rgb(.08,.23,.18),muted=rgb(.28,.36,.32),lineHeight=19,margin=40;
 let page=pdf.addPage([612,792]),y=750;
 function wrap(value,size,width){const lines=[];for(const paragraph of text(value).split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(!word)continue;if(font.widthOfTextAtSize((line?line+' ':'')+word,size)<=width){line+=(line?' ':'')+word;continue;}if(line){lines.push(line);line='';}let fragment='';for(const c of word){if(fragment&&font.widthOfTextAtSize(fragment+c,size)>width){lines.push(fragment);fragment='';}fragment+=c;}line=fragment;}lines.push(line);}return lines;}
 function addText(value,{size=12,color=dark,gap=6}={}){for(const line of wrap(value,size,page.getWidth()-2*margin)){if(y<58){page=pdf.addPage([612,792]);y=750;}if(line)page.drawText(line,{x:margin,y,size,font,color});y-=Math.max(lineHeight,size*1.35);}y-=gap;}
 addText('SCIapp care journal',{size:22});addText(`Generated: ${local(generatedAt)} (${timezone||'UTC'})`);addText(`${entries.length} entries. User-entered care and unvalidated photo estimates. A missing record does not establish that care was missed.`,{color:muted});
 const photos=[];let recordNumber=0;
 for(const e of entries){recordNumber++;addText(`${recordNumber}. ${e.title||'Care record'}`,{size:15});addText(`Status: ${e.status||'approved'} | Category: ${e.category||e.kind||'care'}`);addText(`Observed: ${local(e.occurredAt)}\nSaved: ${local(e.recordedAt)}`);if(e.detail)addText(e.detail);if(e.userObservation)addText('User observation: '+e.userObservation);if(e.aiObservation){const a=e.aiObservation;addText('AI photo observation (unvalidated): '+[a.notes,a.color&&'Color: '+a.color,a.cloudiness&&'Cloudiness: '+a.cloudiness,a.volumeMl!=null&&'Estimated volume: '+a.volumeMl+' mL',a.systolic!=null&&'Extracted BP: '+a.systolic+'/'+a.diastolic,a.heartRate!=null&&'Extracted pulse: '+a.heartRate+' bpm'].filter(Boolean).join('. '));}
  if(e.photoAvailable&&e.photoId){let ref=photos.findIndex(p=>p.photoId===e.photoId);if(ref<0){photos.push(e);ref=photos.length-1;}addText(`Original photo: image ${ref+1}, on its own full-page view after these records.`,{color:muted});}else if(e.photoId)addText('Original photo was deleted or is unavailable; the care record is retained.',{color:muted});y-=12;
 }
 if(missingGlyphs)addText('Characters unavailable in the embedded font are shown as Unicode code points.',{color:muted});
 for(let i=0;i<photos.length;i++){
  const e=photos[i];let image;
  try{const blob=await readPhoto(e.photoId),bytes=new Uint8Array(await blob.arrayBuffer());if(bytes[0]===255&&bytes[1]===216&&jpegOrientation(bytes)===1)image=await pdf.embedJpg(bytes);else if(bytes[0]===137&&bytes[1]===80)image=await pdf.embedPng(bytes);else image=await pdf.embedPng(await convertImage(blob));}
  catch{page=pdf.addPage([612,792]);y=750;addText(`Image ${i+1}: original photo unavailable`,{size:18});addText(`Observed: ${local(e.occurredAt)} (${timezone||'UTC'})`);addText('The image could not be read for this export. Its journal record is retained.');continue;}
  const landscape=image.width>image.height;page=pdf.addPage(landscape?[792,612]:[612,792]);const w=page.getWidth(),h=page.getHeight();page.drawText(`Image ${i+1} | ${text(e.category||'Care photo')}`,{x:24,y:h-30,size:14,font,color:dark});page.drawText(text(`Observed: ${local(e.occurredAt)} (${timezone||'UTC'})`),{x:24,y:h-48,size:10,font,color:muted});
  const availableW=w-48,availableH=h-90,scale=Math.min(availableW/image.width,availableH/image.height),iw=image.width*scale,ih=image.height*scale;
  page.drawImage(image,{x:(w-iw)/2,y:30+(availableH-ih)/2,width:iw,height:ih});
 }
 const pages=pdf.getPages();for(let i=0;i<pages.length;i++){const p=pages[i];p.drawText(`SCIapp | Page ${i+1} of ${pages.length}`,{x:24,y:13,size:8,font,color:muted});}
 return pdf.save();
}
