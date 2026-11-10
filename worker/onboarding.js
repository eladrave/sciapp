import {helpTopics} from '../web/onboarding.js';
import {AppError,message,now} from './domain.js';
const headings={overview:'Here is what you can do with SCIapp.',setup:'Set up your own care plan in your own words.',photos:'Use a photo or your voice when typing is difficult.',questions:'Ask questions about symptoms, exercises, and everyday care.',history:'Find past readings and photos, or prepare a doctor PDF.'};
export function appHelp(topic='overview'){
 if(!Object.hasOwn(headings,topic))throw new AppError('Choose a supported help topic.');
 return message('assistant',headings[topic],{appHelp:{topic},answerHint:helpTopics[topic].intro+' '+helpTopics[topic].examples.map(([name,text])=>name+'. '+text).join(' ')});
}
export function completeOnboarding(state){state.onboarding={version:1,completedAt:now()};return message('assistant','Ready when you are. You can always select Help or say “what can you do” to see the guide again.');}
