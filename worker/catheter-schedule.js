// Intent/time grounding is independent of the model. Clock values never become volumes.
const catheter=/\b(?:catheter(?:iz|is)(?:ation|e|ed|ing)?|catheters?|cath)\b/i;
export const hasClock=text=>/\b\d{1,2}:\d{2}\b|\b\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\.?\b|\b(?:noon|midnight)\b/i.test(text);
export function scheduleIntent(text){
 if(!catheter.test(text))return false;
 if(/\b(?:schedule|remind|reminder|daily|every day|usually|normally|typically|regularly)\b/i.test(text))return !/\b(?:every|interval)\s+\d+(?:\.\d+)?\s*hours?\b/i.test(text);
 return !/\b(?:yesterday|catheterized|catheterised|did|finished|completed|just)\b/i.test(text)&&(/\bi\s+(?:(?:usually|normally)\s+)?(?:do|cath|catheterize|catheterise)\b/i.test(text)||hasClock(text));
}
export function scheduleTimes(text){
 let t=text.toLowerCase().replace(/\ba\.?\s*m\.?\b/g,'am').replace(/\bp\.?\s*m\.?\b/g,'pm').replace(/\bmidnight\b/g,'12am').replace(/\bnoon\b/g,'12pm');
 const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
 t=t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+(thirty|fifteen|forty five))?\s*(am|pm)\b/g,(_,h,m,a)=>`${words[h]}${m?':'+({thirty:'30',fifteen:'15','forty five':'45'}[m]):''}${a}`);
 t=t.replace(/(\d{1,2}(?::\d{2})?)\s+(?:in the|in|at)\s+(morning|afternoon|evening|night)/g,(_,n,period)=>n+(period==='morning'?'am':'pm'));
 const matches=[...t.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/g)],times=[];
 if(!matches.length)return null;
 for(const m of matches){let h=Number(m[1]),min=Number(m[2]||0);if(!m[3]&&!m[2]||min>59||(m[3]?h<1||h>12:h>23))return null;if(m[3])h=h%12+(m[3]==='pm'?12:0);times.push(String(h).padStart(2,'0')+':'+String(min).padStart(2,'0'));}
 return [...new Set(times)].sort();
}
export function explicitVolume(text){const match=text.match(/\b(\d+(?:\.\d+)?)\s*(?:ml|millilit(?:er|re)s?)\b/i);return match?Number(match[1]):null;}
