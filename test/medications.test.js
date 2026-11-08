import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, migratePersonalState, proposal, finishProposal, undoEvent } from '../worker/domain.js';
import { handleKnown } from '../worker/conversation.js';
import { parseCareList, parseReminderTimes } from '../worker/medications.js';
const sample = 'Current Medications\n• DemoAlpha (generic) 5 mg, twice daily\n• DemoBeta 12 mg, 4 times daily\n• DemoGamma 35 mg, once daily\n• DemoDelta 600 mg, 3 times daily\n• DemoEpsilon 15 mg, 3 times daily\n• DemoZeta 0.2 mg, once daily\n• DemoEta 25 mg, at bedtime as needed\n• DemoTheta (Sample Brand) 8 mg suppository, once daily\n\nAllergies\n• Sample antibiotic\n• Sample / Compound';
function approve(s,r){return finishProposal(s,r.proposal.id,'approve');}
function imported(){const s=initialState({real:true});approve(s,handleKnown(s,sample));return s;}
test('bulk medication import preserves all labels, PRN and allergies without guessing stock or schedules',()=>{
 const s=initialState({real:true});const r=handleKnown(s,sample);assert.equal(r.proposal.kind,'carePlan');assert.equal(s.medications.length,0);approve(s,r);
 assert.equal(s.medications.length,8);assert.equal(s.allergies.length,2);assert.equal(s.medications[6].asNeeded,true);assert.equal(s.medications[7].dosage,'8 mg suppository');
 for(const med of s.medications){assert.equal(med.stock,null);assert.equal(med.unitsPerDose,null);assert.deepEqual(med.times,[]);assert.ok(med.createdAt);}
 approve(s,handleKnown(s,sample));assert.equal(s.medications.length,8);assert.equal(s.allergies.length,2);
 assert.equal(s.inventory.length,1);assert.equal(s.inventory[0].count,null);
});
test('partially unreadable lists are not partially saved and invalid duplicate labels are rejected',()=>{
 const s=initialState({real:true});const r=handleKnown(s,'Current Medications\nDemoAlpha 5 mg, once daily\nunknown line');assert.equal(r.proposal,undefined);assert.equal(s.medications.length,0);
 assert.throws(()=>proposal(s,'carePlan',{medications:[{name:'Demo',dosage:'5 mg',frequency:'daily'},{name:'Demo',dosage:'10 mg',frequency:'daily'}]}),/same medication/);
 const allergies=parseCareList('Allergies\n• Sample allergy');assert.deepEqual(allergies.allergies,['Sample allergy']);
});
test('explicit schedule configuration and timezone retain exact user choices; PRN routine reminders are rejected',()=>{
 const s=imported();const r=handleKnown(s,'Remind me to take DemoAlpha at 8 am and 8 pm');assert.equal(r.proposal.kind,'medicationSchedule');approve(s,r);assert.deepEqual(s.medications[0].times,['08:00','20:00']);
 assert.equal(handleKnown(s,'Remind me to take DemoEta at 22:00').proposal,undefined);
 assert.throws(()=>proposal(s,'medicationSchedule',{medicationId:s.medications[6].id,times:['22:00']}),/as needed/);
 assert.deepEqual(parseReminderTimes('08:00 and 20:00'),['08:00','20:00']);assert.equal(parseReminderTimes('morning'),null);assert.equal(parseReminderTimes('25:00'),null);
 approve(s,handleKnown(s,'Set my timezone to Europe/London'));assert.equal(s.settings.timezone,'Europe/London');
 assert.throws(()=>proposal(s,'settings',{timezone:'Fake/Zone'}),/timezone/);
});
test('stock only decrements for confirmed use and unknown units are asked rather than inferred from mg',()=>{
 const s=imported();const med=s.medications[0];approve(s,handleKnown(s,'I took DemoAlpha'));assert.equal(med.stock,null);
 approve(s,handleKnown(s,'I have 60 DemoAlpha tablets'));assert.equal(med.stock,60);assert.equal(med.unitsPerDose,null);
 const prompt=handleKnown(s,'I took DemoAlpha');assert.match(prompt.content,/How many tablets/);assert.equal(prompt.proposal,undefined);
 const r=handleKnown(s,'2 tablets');assert.equal(med.stock,60);approve(s,r);assert.equal(med.stock,58);approve(s,r);assert.equal(med.stock,58);
 const taken=s.events[0];undoEvent(s,taken.id);assert.equal(med.stock,60);
 handleKnown(s,'Set units per dose for DemoAlpha');approve(s,handleKnown(s,'2 tablets'));assert.equal(med.unitsPerDose,2);
 approve(s,handleKnown(s,'I took DemoAlpha'));assert.equal(med.stock,58);
});
test('medication schedule changes clear times and units while preserving stock, archive stops reminders',()=>{
 const s=imported();const med=s.medications[0];approve(s,handleKnown(s,'Remind me to take DemoAlpha at 08:00'));approve(s,handleKnown(s,'I have 60 DemoAlpha tablets and take 2 tablets per dose'));
 approve(s,handleKnown(s,'Update medication DemoAlpha (generic) 10 mg, once daily'));assert.deepEqual(med.times,[]);assert.equal(med.stock,60);assert.equal(med.unitsPerDose,null);
 approve(s,handleKnown(s,'Archive DemoAlpha'));assert.equal(med.active,false);assert.deepEqual(med.times,[]);
});
test('personal migration retains history, resets synthetic stock, and recovers prior refused bulk list as review only',()=>{
 const s=initialState();s.messages.push({role:'user',content:sample});const history={id:'old',kind:'medication'};s.events.push(history);
 assert.equal(migratePersonalState(s),true);assert.equal(s.mode,'personal');assert.equal(s.inventory[0].count,null);assert.equal(s.inventory.length,1);assert.equal(s.events[0],history);assert.equal(s.medications.length,0);
 assert.equal(s.messages.at(-1).proposal.kind,'carePlan');assert.equal(migratePersonalState(s),false);
});
test('scheduled dose log preserves occurrence identity and no notification-driven inventory decrement',()=>{
 const s=imported();const med=s.medications[0],scheduledFor='2026-11-08T13:00:00.000Z';const r=proposal(s,'medication',{medicationId:med.id,scheduledFor});assert.equal(s.events.length,1);approve(s,r);assert.equal(s.events[0].data.scheduledFor,scheduledFor);
});
test('logging rejects a stock unit mismatch and changing stock units clears implicit dose units',()=>{
 const s=imported();approve(s,handleKnown(s,'I have 60 DemoAlpha tablets and take 2 tablets per dose'));const med=s.medications[0];
 const wrong=handleKnown(s,'I took 2 mL of DemoAlpha');assert.equal(wrong.proposal,undefined);assert.equal(med.stock,60);
 approve(s,handleKnown(s,'I have 60 DemoAlpha capsules'));assert.equal(med.unitsPerDose,null);assert.equal(med.unit,'capsules');
});

test('migrating a renamed sample catheter product never preserves the seeded balance',()=>{
 const s=initialState();s.inventory[0].name='Sample product label';s.inventory[0].count=90;
 migratePersonalState(s);assert.equal(s.inventory[0].count,null);assert.equal(s.inventory[0].name,'Sample product label');
});
