export const answerHint='Choose a button, or type or say any other answer.';
export function questionChoices(message){
 if(message.role!=='assistant')return {choices:[],reference:null};
 const content=message.content||'';const isQuestion=!!message.questionId||content.includes('?')||/reply.*yes|type.*yes/i.test(content);
 const reference=message.questionId||(isQuestion&&message.id?'legacy:'+message.id:null);
 const choices=message.options?.length?message.options:isQuestion?(/\b(?:yes|no)\b/i.test(content)||/\b(?:do you|would you|should i|shall i|is this|are these)\b/i.test(content)?['Yes','No','Cancel']:['I need help','Cancel']):[];
 return {choices,reference,hint:message.answerHint||answerHint};
}
