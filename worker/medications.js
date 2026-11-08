// Parsing records user-entered labels. It never computes a prescribed dose or schedule.
export const medicationKey = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const stockUnit = value => { const unit=String(value).toLowerCase();return unit==='ml'?'mL':unit==='suppository'?'suppositories':unit.endsWith('s')?unit:unit+'s'; };
export function findMedication(state, value) {
 const key = medicationKey(value);
 const active = (state.medications || []).filter(m => m.active !== false);
 const exact = active.find(m => m.id === value || medicationKey(m.name) === key);
 if (exact) return exact;
 const matches = active.filter(m => [m.name.replace(/\([^)]*\)/g, ''), ...(m.name.match(/\(([^)]*)\)/)?.[1].split(/[,/]/) || [])].some(name => medicationKey(name) === key));
 return matches.length === 1 ? matches[0] : null;
}
export function parseMedicationLine(line) {
 const text = line.trim().replace(/^[•*\-]\s*/, '').replace(/^(?:add|update|change) (?:my )?medication\s*:?\s*/i, '');
 const match = text.match(/^(.+?)\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|units?|puffs?)\b.*?)\s*,?\s*((?:once|twice|three times|four times|\d+ times?|at bedtime|every|daily|as needed)\b.*)$/i);
 if (!match) return null;
 return {name:match[1].trim(),dosage:match[2].replace(/,\s*$/, '').trim(),frequency:match[3].trim(),asNeeded:/as needed|\bprn\b/i.test(match[3])};
}
export function parseCareList(text) {
 const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
 const meds = [], allergies = [], invalid = []; let section = 'medications';
 for (const line of lines) {
  if (/^(?:current |my )?medications?\s*:?$/i.test(line)) { section = 'medications'; continue; }
  if (/^(?:my )?allergies\s*:?$/i.test(line)) { section = 'allergies'; continue; }
  if (/^(?:please )?(?:add|save|update|here (?:is|are)) (?:my |these )?(?:current )?(?:medications?|medication list|medications? and allergies)\s*:?$/i.test(line)) continue;
  if (section === 'allergies') { const name = line.replace(/^[•*\-]\s*/, '').trim(); if (name && name.length <= 200) allergies.push(name); else invalid.push(line); }
  else { const med = parseMedicationLine(line); if (med) meds.push(med); else invalid.push(line); }
 }
 return { medications:meds, allergies, invalid };
}
export function parseReminderTimes(text) {
 const chunks = text.split(/\s*(?:,|\band\b)\s*/i).filter(Boolean), times=[];
 for (const chunk of chunks) {
  const m=chunk.trim().replace(/[.!]$/, '').match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if(!m || (!m[3] && !m[2])) return null;
  let h=Number(m[1]);const min=Number(m[2]||0);
  if(min>59 || (m[3] ? h<1||h>12 : h>23)) return null;
  if(m[3])h=h%12+(m[3].toLowerCase()==='pm'?12:0);
  times.push(`${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`);
 }
 return [...new Set(times)].sort();
}
