// Prepares reply text for a text-to-speech voice: the words a person would say, without
// formatting marks, links or abbreviations a voice reads badly.
const units=[[/(\d)\s?mL\b/g,'milliliters'],[/(\d)\s?mcg\b/gi,'micrograms'],[/(\d)\s?mg\b/gi,'milligrams'],[/(\d)\s?kg\b/gi,'kilograms']];
export function spokenText(text){
 let t=String(text||'').replace(/```[\s\S]*?```/g,' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,' ').replace(/[*_`#>|]+/g,' ').replace(/^\s*[-•]\s+/gm,'').replace(/\s*·\s*/g,', ');
 for(const [pattern,word] of units)t=t.replace(pattern,`$1 ${word}`);
 t=t.replace(/\b1 (milliliter|microgram|milligram|kilogram)s\b/g,(m,unit,i,all)=>/[\d.,]$/.test(all.slice(0,i))?m:`1 ${unit}`);
 t=t.split(/\n+/).map(line=>line.trim()).filter(Boolean).map(line=>/[.!?:;,]$/.test(line)?line:line+'.').join(' ');
 return t.replace(/\s+/g,' ').replace(/([.!?])(?:\s*\.)+/g,'$1').replace(/\s+([.,!?;:])/g,'$1').trim();
}
// Short pieces start playing sooner and stay under the voice model's request limit.
export function speechChunks(text,max=400){
 const clean=spokenText(text),chunks=[];if(!clean)return chunks;
 let current='';
 const push=()=>{if(current.trim())chunks.push(current.trim());current='';};
 for(const sentence of clean.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g)||[clean]){
  if((current+sentence).length>max)push();
  if(sentence.length<=max){current+=sentence;continue;}
  for(const word of sentence.split(/\s+/)){if((current+' '+word).length>max)push();current+=(current?' ':'')+word.slice(0,max);}
  current+=' ';
 }
 push();return chunks;
}
