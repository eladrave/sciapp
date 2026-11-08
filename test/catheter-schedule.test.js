import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, finishProposal, proposal } from '../worker/domain.js';
import { scheduleTimes } from '../worker/catheter-schedule.js';
import { reminderChat, repairLegacyScheduleReview } from '../worker/reminder-chat.js';
import { handleKnown, interpret } from '../worker/conversation.js';
import { executeCareTool } from '../worker/chat-tools.js';
import { assistantAction } from '../worker/assistant-actions.js';
import { reminderTasks, dueTasks } from '../worker/reminders.js';
const routine='I do catheterization at 6:15am, 10:45am, 3pm, 7:15pm, 12:30am';
const times=['00:30','06:15','10:45','15:00','19:15'];
test('routine clock times prepare a schedule, never a volume or stock deduction',()=>{
 for(const input of [routine,'My catheter schedule is 06:15, 10:45, 15:00, 19:15 and 00:30',"Remind me to catheterize every day at 6:15am, 10:45am, 3pm, 7:15pm and 12:30am"]){
  const state=initialState({real:true});state.inventory[0].count=80;state.draft={kind:'catheterization'};
  const reply=reminderChat(state,input);assert.equal(reply.proposal.kind,'catheterSchedule');assert.deepEqual(state.proposals.at(-1).params.times,times);assert.equal(state.inventory[0].count,80);assert.equal(state.events.length,0);assert.equal(state.settings.catheterRemindersEnabled,false);
  const saved=finishProposal(state,reply.proposal.id,'approve');assert.match(saved.content,/Daily catheterization reminders saved/);assert.equal(state.settings.notificationsEnabled,true);assert.equal(state.inventory[0].count,80);assert.equal(state.events.filter(e=>e.kind==='catheterization').length,0);
  finishProposal(state,reply.proposal.id,'approve');assert.equal(state.events.length,1);
 }
});
test('ambiguous clock lists ask AM/PM and cannot become AI or legacy volume entries',()=>{
 const state=initialState({real:true});const reply=reminderChat(state,'I do catheterization at 6, 10, 3 and 7');assert.equal(reply.proposal,undefined);assert.match(reply.content,/AM or PM/);
 assert.equal(assistantAction(state,routine,{kind:'catheterization',params:{volume:10}}).proposal,undefined);
 assert.equal(assistantAction(state,routine,{kind:'catheterSchedule',params:{times:['08:00']}}).proposal,undefined);
 const log=handleKnown(initialState({real:true}),'I catheterized at 6am');assert.equal(log.proposal,undefined);assert.match(log.content,/volume/);
 assert.equal(assistantAction(state,'I catheterized',{kind:'catheterization',params:{volume:300}}).proposal,undefined);assert.equal(assistantAction(state,'I catheterized 350 mL',{kind:'catheterization',params:{volume:300}}).proposal,undefined);assert.equal(scheduleTimes('6:75am'),null);assert.equal(scheduleTimes('25:00'),null);
});
test('daily targets cross midnight without drifting after completed care',()=>{
 const state=initialState({real:true});state.settings={...state.settings,catheterScheduleMode:'daily',catheterTimes:['00:30','06:15','19:15'],catheterScheduleUpdatedAt:'2026-11-08T00:00:00Z',catheterScheduleId:'test',catheterRemindersEnabled:true,notificationsEnabled:true};
 const at=Date.parse('2026-11-09T00:15:20Z');const due=dueTasks(state,at);assert.equal(due.length,1);assert.equal(due[0].dueAt,'2026-11-09T00:15:00.000Z');
 const before=reminderTasks(state,at);assert.ok(before.some(t=>t.dueAt==='2026-11-09T05:30:00.000Z'));
 state.events.unshift({kind:'catheterization',occurredAt:'2026-11-09T00:10:00Z'});assert.equal(dueTasks(state,at).length,0);assert.ok(reminderTasks(state,at).some(t=>t.dueAt==='2026-11-09T05:30:00.000Z'));
 state.settings.notificationsEnabled=false;assert.equal(dueTasks(state,Date.parse('2026-11-09T05:30:20Z')).length,0);
});
test('legacy pending misclassification is replaced with a schedule review without changing care',()=>{
 const state=initialState({real:true});delete state.schedulingSchemaVersion;state.messages.push({id:'original-user',role:'user',content:routine});const old=proposal(state,'catheterization',{volume:10});state.messages.push(old);
 repairLegacyScheduleReview(state);assert.equal(state.proposals[0].status,'cancelled');assert.equal(state.proposals.at(-1).kind,'catheterSchedule');assert.equal(state.events.length,0);assert.equal(state.settings.catheterRemindersEnabled,false);const count=state.proposals.length;repairLegacyScheduleReview(state);assert.equal(state.proposals.length,count);
});
test('model receives typed tools before any care parser and tool arguments are grounded',async()=>{
 const state=initialState({real:true});let called=false;
 const env={AI:{run:async(model,payload)=>{called=true;assert.equal(state.proposals.length,0);assert.ok(payload.tools.some(t=>t.name==='set_catheter_schedule'));return{tool_calls:[{name:'set_catheter_schedule',arguments:{times}}]};}}};
 const interpreted=await interpret(env,state,routine);assert.equal(called,true);assert.equal(interpreted.kind,'tool');const reply=await executeCareTool(env,'clerk:test',state,routine,interpreted.tool);assert.equal(reply.proposal.kind,'catheterSchedule');assert.equal(state.events.length,0);
 const no=await executeCareTool(env,'clerk:test',state,'What does approval mean?',{name:'confirm_pending_action',arguments:{decision:'approve'}});assert.equal(no.proposal,undefined);assert.equal(state.proposals.at(-1).status,'pending');
 const yes=await executeCareTool(env,'clerk:test',state,'Approved.',{name:'confirm_pending_action',arguments:{decision:'approve'}});assert.match(yes.content,/Daily catheterization reminders saved/);assert.equal(state.settings.catheterScheduleMode,'daily');
});
