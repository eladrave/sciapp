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
