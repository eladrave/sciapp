// Touch and voice share the server's medication-group workflow.
export function createMedicationCheckInUI({node,button,run,send,dismiss,isBusy}){
 const drafts=new Map();let active=null;
 function selectionContext(){if(!active||active.stage!=='selection'||Date.parse(active.expiresAt||'9999-01-01')<=Date.now())return null;return{checkInId:active.id,revision:active.revision,takenMedicationIds:[...(drafts.get(active.id+':'+active.revision)||active.takenMedicationIds)]};}
 function reset(){drafts.clear();active=null;}
 function control(label,action,data,stale=false){const b=button(label,'secondary',()=>run(action,data));b.dataset.answerControl='true';b.dataset.staleQuestion=String(stale);b.disabled=stale||isBusy();return b;}
 function group(parent,g){
  const section=node('section','care-due medication-group');section.setAttribute('aria-label',`Medication for ${g.clock}`);
  section.append(node('h4','',`Medication for ${g.clock}`));const list=node('ul');for(const m of g.medications){const item=node('li','',m.title);if(dismiss){const hide=button('Dismiss','secondary',()=>dismiss([m.occurrenceId]));hide.setAttribute('aria-label',`Dismiss reminder for ${m.title} at ${g.clock}`);hide.dataset.answerControl='true';hide.disabled=isBusy();item.append(hide);}list.append(item);}section.append(list);
  const actions=node('div','quick-replies');for(const [label,action]of [['Took them all','all'],['Took only some','some'],['Not yet','later']])actions.append(control(label,action,{groupId:g.id}));section.append(actions,node('p','answer-hint',`Say “took them all”, “only some”, or name the medicines. You can say “the ${g.clock} medicines” to choose this group.`));parent.append(section);
 }
 function question(parent,message,current){
  const c=message.medicationCheckIn;if(!c)return;
  if(current)active=c;const draftKey=c.id+':'+c.revision;
  const stale=!current,wrap=node('section','medication-question');wrap.setAttribute('aria-label',`Medication check-in for ${c.clock}`);
  const data={checkInId:c.id,revision:c.revision};
  if(c.stage==='selection'){
   const form=node('form','medication-selection');const checks=[];
   for(const m of c.medications){const label=node('label','medication-choice'),input=node('input');input.type='checkbox';input.checked=(drafts.get(draftKey)||c.takenMedicationIds).includes(m.medicationId);input.disabled=stale||isBusy();input.dataset.answerControl='true';input.dataset.staleQuestion=String(stale);input.value=m.medicationId;label.append(input,node('span','',`${m.number}. ${m.title}`));checks.push(input);input.addEventListener('change',()=>{drafts.set(draftKey,checks.filter(e=>e.checked).map(e=>e.value));while(drafts.size>50)drafts.delete(drafts.keys().next().value);});form.append(label);}
   form.append(node('p','answer-hint','Checked: taken. Unchecked: not taken yet. You can also say the names or numbers, such as “all except number 3”.'));
   const next=button('Continue','primary',()=>{});next.type='submit';next.dataset.answerControl='true';next.dataset.staleQuestion=String(stale);next.disabled=stale||isBusy();form.append(next);form.addEventListener('submit',event=>{event.preventDefault();run('select',{...data,takenMedicationIds:checks.filter(c=>c.checked).map(c=>c.value)});});wrap.append(form);
  }else{
   const list=node('ul');for(const m of c.medications.filter(m=>c.takenMedicationIds.includes(m.medicationId)))list.append(node('li','',m.title));wrap.append(list);
   const choices=node('div','quick-replies');choices.append(control('On time','time',{...data,timing:'scheduled'},stale),control('Just now','time',{...data,timing:'now'},stale));
   const other=button('Another time','secondary',()=>send('I took these medicines at another time. Ask me when.'));other.dataset.answerControl='true';other.dataset.staleQuestion=String(stale);other.disabled=stale||isBusy();choices.append(other);wrap.append(choices);
  }
  wrap.append(control('Cancel','cancel',data,stale),node('p','answer-hint','Choose a button, or say your answer. You can always type or say anything else.'));parent.append(wrap);
 }
 return {group,question,selectionContext,reset,beginRender:()=>{active=null;}};
}
