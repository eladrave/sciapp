// Finds figure and table captions in the text lines of one document page.
// A caption starts its line: "Figure 7 | Lower Motor Neuron Injury", "Fig. 3: Skin check", "Table 2. Fluids".
// A sentence that merely starts with a reference ("Figure 7 shows how ...") is not a caption.
const pattern=/^(figure|fig\.?|table)\s*(\d{1,3}[a-z]?(?:[.-]\d{1,3})?)\s*([|:.–—-])?\s*(.*)$/i;
export function figureLabel(kind,number){return `${/^t/i.test(kind)?'Table':'Figure'} ${String(number).toUpperCase()}`;}
export function findCaptions(lines){
 const found=[];
 for(let i=0;i<lines.length;i++){
  const line=String(lines[i]||'').replace(/\s+/g,' ').trim(),match=line.match(pattern);if(!match)continue;
  const [,kind,number,separator,rest]=match;let caption=rest.trim(),strong=!!separator&&caption.length>0;
  if(!caption){const next=String(lines[i+1]||'').replace(/\s+/g,' ').trim();if(!next||pattern.test(next)||next.length>160)continue;caption=next;strong=true;}
  else if(!separator&&!(/^[A-Z0-9(]/.test(caption)&&line.length<=110))continue;
  // "Figure 7. Shows" style sentences: a caption does not read like running prose.
  if(/^(?:shows?|illustrates?|depicts?|lists?|summari[sz]es?|describes?|is|are|was|were|and|or|on|in|for|below|above)\b/i.test(caption))continue;
  found.push({label:figureLabel(kind,number),caption:caption.replace(/\s*[|]\s*/g,' ').slice(0,200).trim(),strong});
 }
 return found;
}
// Text items from a PDF page become lines: a new line starts at an end-of-line mark or a change of baseline.
export function textLines(items){
 const lines=[];let current='',y=null;
 for(const item of items||[]){
  if(typeof item.str!=='string')continue;
  const itemY=item.transform?.[5];
  if(current&&y!=null&&itemY!=null&&Math.abs(itemY-y)>2){lines.push(current);current='';}
  current+=item.str;if(itemY!=null)y=itemY;
  if(item.hasEOL){lines.push(current);current='';y=null;}
 }
 if(current)lines.push(current);
 return lines.map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean);
}
// One figure per label across the document; a clearly separated caption wins over a weaker match.
export function collectFigures(pages){
 const byLabel=new Map();
 for(const {page,lines} of pages)for(const caption of findCaptions(lines)){const existing=byLabel.get(caption.label);if(!existing||caption.strong&&!existing.strong)byLabel.set(caption.label,{...caption,page});}
 return [...byLabel.values()].sort((a,b)=>a.page-b.page||a.label.localeCompare(b.label,undefined,{numeric:true}));
}
// Illustrated pages: a page with photos or drawings but no "Figure N" caption (exercise sheets,
// positioning guides). The headings on the page name what the pictures show, so they become the
// caption. A page with pictures and no heading is treated as decoration and skipped.
const headingWord=/^(?:[A-Z][A-Za-z'’()-]*|\d+[A-Za-z]*|\([A-Za-z]+\)|and|or|of|the|to|for|in|on|with|a|an|\/|&|[A-Z][a-z]+\/[A-Z][a-z]+(?:\/[A-Z][a-z]+)*)$/;
export function pageHeadings(lines,repeated=new Set()){
 const found=[];
 for(const raw of lines||[]){
  const line=String(raw||'').replace(/\s+/g,' ').trim();
  if(line.length<4||line.length>60||/[.:;,!?]$/.test(line)||repeated.has(line)||pattern.test(line)||/^(?:appendix|chapter|section|resources?|publications?|notes?|contents)\b/i.test(line)||/^\d+$/.test(line))continue;
  const words=line.split(' ');if(words.length>7||!/^[A-Z]/.test(line)||!words.every(w=>headingWord.test(w))||words.filter(w=>/^[A-Z]/.test(w)).length<Math.min(2,words.length))continue;
  if(!found.includes(line))found.push(line);
 }
 return found;
}
// images: share of the page area (in percent) covered by each picture drawn on the page.
export const pictureShare=images=>(images||[]).filter(share=>share>=3&&share<=70).reduce((sum,share)=>sum+share,0);
export function collectIllustrations(pages,captionedPages=new Set()){
 const seen=new Map();for(const {lines} of pages)for(const line of new Set((lines||[]).map(l=>String(l).replace(/\s+/g,' ').trim())))seen.set(line,(seen.get(line)||0)+1);
 const repeated=new Set([...seen].filter(([,count])=>count>=3).map(([line])=>line));
 const found=[];
 for(const {page,lines,images} of pages){
  if(captionedPages.has(page)||pictureShare(images)<8)continue;
  const headings=pageHeadings(lines,repeated);if(!headings.length)continue;
  found.push({label:`Page ${page}`,caption:headings.slice(0,5).join(', ').slice(0,200),page});
 }
 return found;
}
