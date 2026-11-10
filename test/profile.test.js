import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,proposal,finishProposal} from '../worker/domain.js';
import {normalizeProfile,updateProfile,profileSummary} from '../worker/profile.js';
import {careContext} from '../worker/care-agent.js';

const at=Date.parse('2026-11-10T12:00:00Z');
test('personal details are optional, trimmed, validated and removable',()=>{
 const s=initialState({real:true});
 updateProfile(s,{name:'  Sam ',fullName:'Sam  Synthetic Example',gender:'Non-binary',dateOfBirth:'1980-02-29',injuryLevel:'C6 incomplete'},at);
 assert.deepEqual(s.profile,{name:'Sam',fullName:'Sam Synthetic Example',gender:'Non-binary',dateOfBirth:'1980-02-29',injuryLevel:'C6 incomplete'});
 assert.equal(profileSummary(s.profile).find(r=>r.label==='Date of birth').value,'February 29, 1980');
 updateProfile(s,{name:'',gender:'',dateOfBirth:''},at);
 assert.deepEqual(s.profile,{name:'You',fullName:'Sam Synthetic Example',injuryLevel:'C6 incomplete'});
 for(const bad of [{dateOfBirth:'1981-02-29'},{dateOfBirth:'2026-11-11'},{dateOfBirth:'1899-12-31'},{dateOfBirth:'02/03/1980'},{fullName:'x'.repeat(121)},{gender:5},{},{unknown:'x'},null])assert.throws(()=>normalizeProfile(bad,at));
 assert.deepEqual(s.profile,{name:'You',fullName:'Sam Synthetic Example',injuryLevel:'C6 incomplete'});
});
test('details given in conversation go through a settings review and reach the assistant context',()=>{
 const s=initialState({real:true});
 const reply=proposal(s,'settings',{fullName:'Sam Synthetic Example',gender:'Female',dateOfBirth:'1975-06-01'});
 assert.deepEqual(reply.proposal.details,['Full name: Sam Synthetic Example','Gender: Female','Date of birth: 1975-06-01']);
 assert.equal(s.profile.fullName,undefined);
 finishProposal(s,reply.proposal.id,'approve');
 assert.equal(s.profile.fullName,'Sam Synthetic Example');assert.equal(s.profile.gender,'Female');assert.equal(s.profile.name,'You');assert.equal(s.settings.fullName,undefined);
 assert.equal(careContext(s,{}).profile.dateOfBirth,'1975-06-01');
 assert.throws(()=>proposal(s,'settings',{dateOfBirth:'tomorrow'}));
});
