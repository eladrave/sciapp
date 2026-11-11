import {message} from './domain.js';
// First steps for suspected autonomic dysreflexia, in the order rehabilitation teams teach them.
// General first aid that the user can hear hands-free; a personal plan from their doctor comes first.
export const AD_STEPS=[
 'Sit up straight, or raise your head as high as you can, and lower your legs. Stay sitting up.',
 'Loosen or remove anything tight: clothing, belt, abdominal binder, leg bag straps, stockings and shoes.',
 'Check your bladder first. Empty it now. If you have an indwelling catheter, look for a kinked tube, a full bag or a blockage.',
 'If the symptoms continue, check whether your bowel is full.',
 'Check your skin for pressure, a cut, a burn, something sharp, or an ingrown toenail.',
 'Check your blood pressure every 5 minutes if you can, and tell me each reading so I can keep a record.'
];
export const AD_EMERGENCY='Use the Call button below, or call emergency services, if your blood pressure stays high (top number 150 or more), the symptoms do not ease, or you cannot find the cause. Say the words autonomic dysreflexia, and give your location shown below.';
export function adHelp(){
 const content=['Autonomic dysreflexia can be an emergency. Do these steps now, in order:',...AD_STEPS.map((step,i)=>`${i+1}. ${step}`),AD_EMERGENCY,'These are general first steps. If your doctor gave you your own plan or medicine for this, follow that.'].join('\n');
 return message('assistant',content,{adHelp:true,options:['Log blood pressure','I feel better now']});
}
