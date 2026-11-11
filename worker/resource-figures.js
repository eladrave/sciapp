import { AppError, now, uid } from './domain.js';
// Figures are page images produced in the administrator's browser from an uploaded document.
// They are educational material: visible in chat only while a resource that uses the upload is published.
export const MAX_FIGURE_BYTES=1500000,MAX_FIGURES_PER_UPLOAD=400;
const imageType=data=>data[0]===0xff&&data[1]===0xd8&&data[2]===0xff?'image/jpeg':data[0]===0x89&&data[1]===0x50&&data[2]===0x4e&&data[3]===0x47?'image/png':String.fromCharCode(...data.slice(0,4))==='RIFF'&&String.fromCharCode(...data.slice(8,12))==='WEBP'?'image/webp':null;
const clean=(value,max)=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
export async function saveFigure(env,uploadId,data){
 if(!env.RESOURCES)throw new AppError('Resource file storage is not configured.',503);
 const upload=await env.DB.prepare('SELECT id FROM resource_uploads WHERE id=?').bind(uploadId).first();if(!upload)throw new AppError('Upload not found.',404);
 const file=data.get('image');if(!file||typeof file==='string'||file.size===0||file.size>MAX_FIGURE_BYTES)throw new AppError('Provide a figure image up to 1.5 MB.',413);
 const bytes=new Uint8Array(await file.arrayBuffer()),mime=imageType(bytes);if(!mime)throw new AppError('Figure images must be JPEG, PNG or WebP.',415);
 const page=Number(data.get('page')),width=Number(data.get('width')),height=Number(data.get('height')),label=clean(data.get('label'),40),caption=clean(data.get('caption'),200);
 if(!Number.isInteger(page)||page<1||page>5000||!Number.isInteger(width)||!Number.isInteger(height)||width<50||height<50||width>6000||height>6000||!/^(?:(?:Figure|Table) [0-9A-Z.-]{1,12}|Page [0-9]{1,4})$/.test(label))throw new AppError('Provide a valid figure label, page and size.');
 const existing=await env.DB.prepare('SELECT id,r2_key FROM resource_figures WHERE upload_id=? AND label=?').bind(uploadId,label).first();
 if(!existing&&(await env.DB.prepare('SELECT COUNT(*) n FROM resource_figures WHERE upload_id=?').bind(uploadId).first()).n>=MAX_FIGURES_PER_UPLOAD)throw new AppError(`A document can have up to ${MAX_FIGURES_PER_UPLOAD} figures.`,409);
 const id='f-'+uid(),key=`figures/${uploadId}/${id}`;await env.RESOURCES.put(key,bytes,{httpMetadata:{contentType:mime}});
 try{await env.DB.batch([env.DB.prepare('DELETE FROM resource_figures WHERE upload_id=? AND label=?').bind(uploadId,label),env.DB.prepare('INSERT INTO resource_figures(id,upload_id,page,label,caption,r2_key,mime_type,byte_size,width,height,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,uploadId,page,label,caption,key,mime,bytes.length,width,height,now())]);}catch(error){await env.RESOURCES.delete(key);throw error;}
 if(existing)await env.RESOURCES.delete(existing.r2_key);
 return {id,label,caption,page};
}
export async function listFigures(env,uploadId){return (await env.DB.prepare('SELECT id,page,label,caption,width,height FROM resource_figures WHERE upload_id=? ORDER BY page,label').bind(uploadId).all()).results;}
export async function deleteFigures(env,uploadId){
 const rows=(await env.DB.prepare('SELECT r2_key FROM resource_figures WHERE upload_id=?').bind(uploadId).all()).results;
 await env.DB.prepare('DELETE FROM resource_figures WHERE upload_id=?').bind(uploadId).run();
 for(const row of rows)await env.RESOURCES?.delete(row.r2_key);
 return rows.length;
}
export async function figureDownload(env,id,{admin=false}={}){
 if(!env.RESOURCES)throw new AppError('Resource file storage is not configured.',503);
 const row=await env.DB.prepare('SELECT * FROM resource_figures WHERE id=?').bind(id).first();if(!row)throw new AppError('Figure not found.',404);
 if(!admin){const published=await env.DB.prepare("SELECT m.source_id FROM resource_materials m JOIN retrieval_sources s ON s.id=m.source_id LEFT JOIN resource_publication p ON p.source_id=s.id WHERE m.upload_id=? AND s.scope='shared' AND s.deleted_at IS NULL AND COALESCE(p.status,'published')='published' LIMIT 1").bind(row.upload_id).first();if(!published)throw new AppError('Figure not found.',404);}
 const file=await env.RESOURCES.get(row.r2_key);if(!file)throw new AppError('Figure not found.',404);
 return new Response(file.body,{headers:{'Content-Type':row.mime_type,'Content-Length':String(row.byte_size),'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
const stop=new Set('what when where which while with without about after before from have does this that these those there their your yours mine much many more most some such than then them they were will would could should into over under very just like show tell give need want know help please figure table image picture diagram page spinal cord injury'.split(' '));
const stem=word=>word.replace(/ies$/,'y').replace(/(?:es|s)$/,'');
export const keywords=text=>new Set((String(text||'').toLowerCase().match(/[a-z][a-z-]{3,}/g)||[]).filter(w=>!stop.has(w)).map(stem).filter(w=>!stop.has(w)));
const mentions=(text,label)=>{const [kind,number]=label.split(' ');if(kind==='Page')return false;return new RegExp(`\\b${kind==='Table'?'table':'fig(?:ure|\\.)?'}\\s*${number.replace(/[.-]/g,'\\$&')}(?![0-9a-z])`,'i').test(String(text||''));};
// Picks at most two figures for a reply that drew on shared resources:
// a figure the answer names, a caption that matches the question, or a figure the retrieved passages refer to.
export async function figuresForReply(env,question,sources,replyText='',max=2){
 const used=(sources||[]).filter(s=>s.upload_id);const uploads=[...new Set(used.map(s=>s.upload_id))].slice(0,5);if(!uploads.length)return [];
 const rows=(await env.DB.prepare('SELECT id,upload_id,page,label,caption,width,height FROM resource_figures WHERE upload_id IN (SELECT value FROM json_each(?)) ORDER BY page LIMIT 2000').bind(JSON.stringify(uploads)).all()).results;
 const asked=keywords(question),said=keywords(replyText),scored=[];
 for(const row of rows){
  const words=[...keywords(row.caption)],overlap=words.filter(w=>asked.has(w)).length,passages=used.filter(s=>s.upload_id===row.upload_id);
  let score=0;
  if(mentions(replyText,row.label)||mentions(question,row.label))score+=10;
  if(overlap)score+=3*overlap+overlap/Math.max(1,words.length);
  // An illustrated page has headings instead of a caption: it also counts when the answer itself talks about what those headings name.
  if(row.label.startsWith('Page ')){const spoken=words.filter(w=>said.has(w)&&!asked.has(w)).length;if(spoken>=2||spoken&&overlap)score+=2*spoken;}
  const passage=passages.filter(s=>mentions(s.body??s.text,row.label)).sort((a,b)=>(b.score||0)-(a.score||0))[0];if(passage)score+=4+(passage.score||0);
  if(score>0)scored.push({score,row,title:passages[0]?.title||''});
 }
 scored.sort((a,b)=>b.score-a.score||a.row.page-b.row.page);
 const picked=[],pages=new Set();
 // A weak match is not shown next to a strong one: extra pictures must be at least half as relevant as the best.
 const best=scored[0]?.score||0;
 for(const {row,title,score} of scored){if(score<best*0.5)break;const key=row.upload_id+':'+row.page;if(pages.has(key))continue;pages.add(key);picked.push({id:row.id,url:'/api/resources/figures/'+row.id,label:row.label,caption:row.caption,page:row.page,width:row.width,height:row.height,title});if(picked.length>=max)break;}
 return picked;
}
