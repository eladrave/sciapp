import { message, proposal, now } from './domain.js';
import { conversationControl } from '../web/conversation-controls.js';
import { reminderTasks } from './reminders.js';
export function reminderChat(state,text){
 const t=text.trim().toLowerCase();
 if(conversationControl(text))return null;
 const stock=t.match(/^(?:i have (\d+) catheters?|set (?:my )?catheter stock to (\d+)(?: catheters?)?)$/);
 if(stock)return proposal(state,'catheterStock',{count:Number(stock[1]||stock[2])});
 if(/^set (?:my )?catheter stock$/.test(t)){state.draft={kind:'catheterStock'};return message('assistant','How many catheters do you currently have in total?',{options:['Cancel']});}
 if(state.draft?.kind==='catheterStock'){const n=t.match(/^(\d+)(?: catheters?)?$/);return n?proposal(state,'catheterStock',{count:Number(n[1])}):message('assistant','Enter your current total as a whole number of catheters, or cancel.');}
 if(/^(?:enable|turn on|set up|allow) (?:push )?notifications(?: on this device)?$/.test(t))return message('assistant','Select Enable notifications on this device, then allow notifications in your browser. Medication alerts need the times you choose. Catheterization alerts need your interval and a starting time.',{options:['Enable notifications on this device','Set catheter reminders','Set medication reminders']});
 if(/^(?:disable|turn off|stop) (?:all )?(?:push )?notifications$/.test(t))return proposal(state,'settings',{notificationsEnabled:false});
 if(/^(?:send )?(?:a )?test notification$/.test(t))return message('assistant','Select the button to send a test to this device.',{options:['Send test notification']});
 if(/^(?:stop|disable|turn off|pause) (?:my )?catheter(?:ization)? reminders$/.test(t))return proposal(state,'settings',{catheterRemindersEnabled:false});
 const start=t.match(/^start catheter(?:ization)? reminders at (\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2})?(?:z|[+-]\d{2}:\d{2})) every (\d+(?:\.\d+)?) hours?$/);
 if(start)return proposal(state,'settings',{catheterIntervalHours:Number(start[2]),catheterRemindersEnabled:true,catheterStartAt:start[1].toUpperCase()});
 const interval=t.match(/(?:catheter(?:ization)? reminders?.*?(?:every|interval(?: of)?)|(?:set )?reminders? every)\s*(\d+(?:\.\d+)?)\s*hours?/);
 if(interval){
  if(/\b(?:medication|medicine|meds?)\b/.test(t)||state.draft?.kind?.startsWith('medication'))return message('assistant','Medication reminders need explicit times for a named medication. Tell me, for example, “Remind me to take Sample medicine at 08:00 and 20:00.” I have not changed your catheter reminders.');
  if(/\b(?:start(?:ing)?|from|at)\b/.test(t))return message('assistant','For a specific starting time, provide an ISO timestamp including your timezone offset, for example “Start catheter reminders at 2026-11-10T08:00:00-05:00 every 4 hours.”');
  return proposal(state,'settings',{catheterIntervalHours:Number(interval[1]),catheterRemindersEnabled:true,catheterStartAt:now()});
 }
 if(/^(?:set|start|enable|turn on) (?:my )?catheter(?:ization)? reminders$/.test(t))return message('assistant','What interval is in your care plan? For example, say “Set catheter reminders every 4 hours.” The first reminder will be that interval from now, then reset after each confirmed catheterization. No catheter is deducted by a reminder.',{options:['Cancel']});
 if(/^(?:change|set) (?:my )?timezone$/.test(t))return message('assistant','Tell me your IANA timezone, for example “Set my timezone to America/New_York.”',{options:['Set my timezone to America/New_York','Cancel']});
 if(/^(?:set|start|enable|turn on) (?:my )?(?:medication|medicine|meds?) reminders$/.test(t))return message('assistant','Tell me a medication and the exact reminder times from your care plan, for example “Remind me to take Example medicine at 08:00 and 20:00.” I will not choose times from a daily frequency. You can set each medication separately.',{options:['Show my medications','Cancel']});
 if(/^(?:what(?: is|’s|'s)? next\??|today|show my tasks)$/.test(t)&&state.mode==='personal'){
  const tasks=reminderTasks(state).slice(0,8);
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:state.settings.timezone,dateStyle:'short',timeStyle:'short'});
  return message('assistant',tasks.length?tasks.map(task=>`${task.title}: ${fmt.format(new Date(task.dueAt))}`).join('\n')+`\nTimezone: ${state.settings.timezone}. Notifications ${state.settings.notificationsEnabled?'enabled (device permission also required)':'off'}.`:'No scheduled tasks yet. Add medications and set their exact times, or set your catheter reminder interval.',{options:['Enable notifications on this device','Set catheter reminders','Set medication reminders']});
 }
 return null;
}
