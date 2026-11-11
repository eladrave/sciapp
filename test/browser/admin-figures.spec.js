import { test, expect } from '@playwright/test';

// A small synthetic PDF: page 1 has no figure, page 2 has a captioned figure, page 3 only refers to it.
function syntheticPdf(){
 const pages=[['Introduction to a synthetic self-care guide.'],['Body text above the drawing.','Figure 7 | Lower Motor Neuron Injury'],['Figure 7 shows how the reflex arc is interrupted.']];
 const objects=[];const add=body=>{objects.push(body);return objects.length;};
 add('<< /Type /Catalog /Pages 2 0 R >>');add('');add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 const kids=[];
 for(const lines of pages){const stream='BT /F1 14 Tf '+lines.map((l,i)=>`1 0 0 1 72 ${700-i*30} Tm (${l.replace(/[()\\]/g,'\\$&')}) Tj`).join(' ')+' ET';const content=add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`));}
 objects[1]=`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(k=>k+' 0 R').join(' ')}] >>`;
 let out='%PDF-1.4\n';const offsets=[];objects.forEach((body,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${body}\nendobj\n`;});
 const xref=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(out,'latin1');
}

test('uploading a PDF finds captioned figures and saves an image of each figure page',async({page})=>{
 const posted=[];let deleted=0;
 await page.route('**/api/admin/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname.replace('/api/admin/',''),method=route.request().method();
  if(path==='session')return route.fulfill({json:{username:'admin',csrfToken:'synthetic'}});
  if(path==='overview')return route.fulfill({json:{queue:[],appVersion:'test',settings:{retrievalThreshold:0.65,resourceReviewDays:180},settingsVersion:0,resources:{},accounts:0}});
  if(path==='resources')return route.fulfill({json:{resources:[]}});
  if(path==='audit')return route.fulfill({json:{entries:[]}});
  if(path==='ai')return route.fulfill({json:{version:0,keyConfigured:false,settings:{baseUrl:'',apiFormat:'',provider:'',chatModel:'',visionModel:'',chatReasoning:'',visionReasoning:'',maxOutputTokens:1000}}});
  if(path==='uploads'&&method==='GET')return route.fulfill({json:{uploads:[]}});
  if(path==='uploads'&&method==='POST')return route.fulfill({status:201,json:{id:'u-00000000-0000-0000-0000-000000000001',fileName:'guide.pdf',mimeType:'application/pdf',size:1000,text:'Synthetic extracted text that is long enough to be saved as a searchable resource.',extractionStatus:'extracted',note:'Review this text.'}});
  if(/^uploads\/u-[0-9a-f-]+\/figures$/.test(path)){
   if(method==='DELETE'){deleted++;return route.fulfill({json:{removed:0}});}
   if(method==='POST'){const body=route.request().postDataBuffer(),text=body.toString('latin1');const field=name=>text.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1];posted.push({label:field('label'),caption:field('caption'),page:field('page'),width:Number(field('width')),height:Number(field('height')),jpeg:body.includes(Buffer.from([0xff,0xd8,0xff])),bytes:body.length});return route.fulfill({status:201,json:{id:'f-1'}});}
   return route.fulfill({json:{figures:[]}});
  }
  return route.fulfill({status:404,json:{error:'Unexpected '+method+' '+path}});
 });
 await page.goto('/admin');
 await page.getByRole('button',{name:'Resources',exact:true}).click();
 await page.getByRole('button',{name:'Add resource'}).click();
 await page.locator('#resource-file').setInputFiles({name:'guide.pdf',mimeType:'application/pdf',buffer:syntheticPdf()});
 await expect(page.locator('#figure-state')).toHaveText(/1 figure saved from this PDF/,{timeout:30000});
 expect(deleted).toBe(1);expect(posted).toHaveLength(1);
 expect(posted[0]).toMatchObject({label:'Figure 7',caption:'Lower Motor Neuron Injury',page:'2',jpeg:true});
 expect(posted[0].width).toBeGreaterThan(1000);expect(posted[0].height).toBeGreaterThan(posted[0].width);expect(posted[0].bytes).toBeGreaterThan(5000);expect(posted[0].bytes).toBeLessThan(1500000);
 await expect(page.locator('#resource-text')).toHaveValue(/Synthetic extracted text/);
 await expect(page.locator('#error')).toBeHidden();
});

test('an earlier upload without text is read again and its figures found, with nothing to do by hand',async({page})=>{
 const id='u-00000000-0000-0000-0000-000000000002';let extracted=0,posted=0;
 const text='Synthetic extracted book text that is long enough to be saved as a searchable resource.';
 await page.route('**/api/admin/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname.replace('/api/admin/',''),method=route.request().method();
  if(path==='session')return route.fulfill({json:{username:'admin',csrfToken:'synthetic'}});
  if(path==='overview')return route.fulfill({json:{queue:[],appVersion:'test',settings:{retrievalThreshold:0.65,resourceReviewDays:180},settingsVersion:0,resources:{},accounts:0}});
  if(path==='resources')return route.fulfill({json:{resources:[]}});
  if(path==='audit')return route.fulfill({json:{entries:[]}});
  if(path==='ai')return route.fulfill({json:{version:0,keyConfigured:false,settings:{baseUrl:'',apiFormat:'',provider:'',chatModel:'',visionModel:'',chatReasoning:'',visionReasoning:'',maxOutputTokens:1000}}});
  if(path==='uploads'&&method==='GET')return route.fulfill({json:{uploads:[{id,file_name:'book.pdf',mime_type:'application/pdf',extraction_status:'needs_text',extraction_note:'Extracted text exceeds 120,000 characters',created_at:new Date().toISOString()}]}});
  if(path===`uploads/${id}/status`)return route.fulfill({json:{id,file_name:'book.pdf',mime_type:'application/pdf',extraction_status:'needs_text',extracted_text:'',extraction_note:'Extracted text exceeds 120,000 characters'}});
  if(path===`uploads/${id}/extract`&&method==='POST'){extracted++;return route.fulfill({json:{id,file_name:'book.pdf',mime_type:'application/pdf',extraction_status:'extracted',extracted_text:text,extraction_note:'Extracted from the whole document.'}});}
  if(path===`uploads/${id}/figures`){if(method==='POST'){posted++;return route.fulfill({status:201,json:{id:'f-1'}});}if(method==='DELETE')return route.fulfill({json:{removed:0}});return route.fulfill({json:{figures:[]}});}
  if(path===`uploads/${id}`&&method==='GET')return route.fulfill({contentType:'application/pdf',body:syntheticPdf()});
  return route.fulfill({status:404,json:{error:'Unexpected '+method+' '+path}});
 });
 await page.goto('/admin');
 await page.getByRole('button',{name:'Resources',exact:true}).click();
 await page.getByRole('button',{name:'Use this upload'}).click();
 await expect(page.locator('#figure-state')).toHaveText(/1 figure saved from this PDF/,{timeout:30000});
 expect(extracted).toBe(1);expect(posted).toBe(1);
 await expect(page.locator('#resource-text')).toHaveValue(text);
 await expect(page.locator('#text-summary')).toHaveText(/Text read from the file automatically \(\d+ characters\)\. Nothing to type\./);
 expect(await page.locator('#text-details').evaluate(el=>el.open)).toBe(false);
 await expect(page.locator('#text-kind-field')).toBeHidden();await expect(page.locator('#check-transcript')).toBeHidden();
 await expect(page.getByRole('button',{name:/Find figures/})).toHaveCount(0);
 expect(await page.locator('#text-kind').inputValue()).toBe('extracted');
 expect(await page.locator('#resource-form').evaluate(form=>form.checkValidity())).toBe(true);
 await expect(page.locator('#error')).toBeHidden();
});
