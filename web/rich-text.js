// Turns the assistant's lightly formatted text (**bold**, *italic*, lists, headings) into safe
// page elements. Text is never inserted as HTML: every piece becomes a text node or one of a few
// known elements, so formatting marks cannot carry scripts or markup.
const inlinePattern=/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_\n]*?)_(?![\w_])|`([^`\n]+?)`|\[([^\]\n]+?)\]\((https:\/\/[^\s)]+)\)/g;
export function parseInline(text){
 const out=[],value=String(text||'');let last=0;
 for(const match of value.matchAll(inlinePattern)){
  if(match.index>last)out.push({type:'text',text:value.slice(last,match.index)});
  const [,bold,bold2,italic,italic2,code,label,href]=match;
  if(bold||bold2)out.push({type:'strong',children:parseInline(bold||bold2)});
  else if(italic||italic2)out.push({type:'em',children:parseInline(italic||italic2)});
  else if(code)out.push({type:'text',text:code});
  else out.push({type:'link',text:label,href});
  last=match.index+match[0].length;
 }
 if(last<value.length)out.push({type:'text',text:value.slice(last)});
 return out;
}
export function parseRichText(text){
 const blocks=[];let paragraph=null,list=null;
 const close=()=>{paragraph=null;list=null;};
 for(const raw of String(text||'').replace(/\r\n?/g,'\n').split('\n')){
  const line=raw.trimEnd();
  if(!line.trim()){close();continue;}
  const heading=line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*$/),bullet=line.match(/^\s{0,6}[-*•]\s+(.+)$/),numbered=line.match(/^\s{0,6}(\d{1,3})[.)]\s+(.+)$/);
  if(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)){close();continue;}
  if(heading){close();blocks.push({type:'heading',children:parseInline(heading[1].replace(/^\*\*(.+)\*\*$/,'$1'))});continue;}
  if(bullet||numbered){
   const ordered=!!numbered;
   if(!list||list.ordered!==ordered){list={type:'list',ordered,start:ordered?Number(numbered[1]):1,items:[]};blocks.push(list);}
   paragraph=null;list.items.push(parseInline(ordered?numbered[2]:bullet[1]));continue;
  }
  // An indented line under a list item continues that item.
  if(list&&/^\s{2,}\S/.test(line)){list.items.at(-1).push({type:'text',text:' '},...parseInline(line.trim()));continue;}
  list=null;
  if(!paragraph){paragraph={type:'paragraph',lines:[]};blocks.push(paragraph);}
  paragraph.lines.push(parseInline(line.trim()));
 }
 return blocks;
}
function inlineNodes(document,parts){
 return parts.map(part=>{
  if(part.type==='text')return document.createTextNode(part.text);
  if(part.type==='link'){const a=document.createElement('a');a.textContent=part.text;a.href=part.href;a.target='_blank';a.rel='noopener noreferrer';return a;}
  const el=document.createElement(part.type==='strong'?'strong':'em');el.append(...inlineNodes(document,part.children));return el;
 });
}
export function renderRichText(document,text){
 const fragment=document.createDocumentFragment();
 for(const block of parseRichText(text)){
  if(block.type==='heading'){const h=document.createElement('p');h.className='rich-heading';const strong=document.createElement('strong');strong.append(...inlineNodes(document,block.children));h.append(strong);fragment.append(h);}
  else if(block.type==='list'){const list=document.createElement(block.ordered?'ol':'ul');if(block.ordered&&block.start!==1)list.start=block.start;for(const item of block.items){const li=document.createElement('li');li.append(...inlineNodes(document,item));list.append(li);}fragment.append(list);}
  else{const p=document.createElement('p');block.lines.forEach((line,index)=>{if(index)p.append(document.createElement('br'));p.append(...inlineNodes(document,line));});fragment.append(p);}
 }
 return fragment;
}
// The same text without formatting marks, for screen-reader announcements.
export const plainText=text=>parseRichText(text).map(block=>block.type==='list'?block.items.map((item,i)=>(block.ordered?`${block.start+i}. `:'')+flat(item)).join('\n'):block.type==='heading'?flat(block.children):block.lines.map(flat).join('\n')).join('\n');
const flat=parts=>parts.map(part=>part.type==='text'||part.type==='link'?part.text:flat(part.children)).join('');
