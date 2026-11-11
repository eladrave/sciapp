import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRichText,parseInline,plainText} from '../web/rich-text.js';

test('bold, italics, lists and headings become structure, not marks',()=>{
 const blocks=parseRichText('## What helps\n\n**Take a warm shower or bath.** It relaxes *tight* muscles.\nSecond line.\n\n- **Stretch** daily\n- Avoid triggers\n   like cold\n\n1. Sit up\n2. Loosen clothing\n\n---\nAsk your care team.');
 assert.deepEqual(blocks.map(b=>b.type),['heading','paragraph','list','list','paragraph']);
 assert.deepEqual(blocks[1].lines[0],[{type:'strong',children:[{type:'text',text:'Take a warm shower or bath.'}]},{type:'text',text:' It relaxes '},{type:'em',children:[{type:'text',text:'tight'}]},{type:'text',text:' muscles.'}]);
 assert.equal(blocks[1].lines.length,2);
 assert.equal(blocks[2].ordered,false);assert.equal(blocks[2].items.length,2);assert.equal(blocks[2].items[0][0].type,'strong');assert.equal(blocks[2].items[1].map(p=>p.text).join(''),'Avoid triggers like cold');
 assert.equal(blocks[3].ordered,true);assert.equal(blocks[3].start,1);assert.equal(blocks[3].items.length,2);
 assert.equal(plainText('**Take a warm shower.**\n\n1. Sit up\n2. *Loosen* clothing'),'Take a warm shower.\n1. Sit up\n2. Loosen clothing');
});
test('ordinary text with stars, underscores, math and markup is left alone and never becomes HTML',()=>{
 assert.deepEqual(parseInline('2 * 3 * 4 and file_name_here and 5*6'),[{type:'text',text:'2 * 3 * 4 and file_name_here and 5*6'}]);
 assert.deepEqual(parseInline('<img src=x onerror=alert(1)> **<b>x</b>**'),[{type:'text',text:'<img src=x onerror=alert(1)> '},{type:'strong',children:[{type:'text',text:'<b>x</b>'}]}]);
 assert.deepEqual(parseInline('[guide](https://example.org/a) [bad](javascript:alert(1))'),[{type:'link',text:'guide',href:'https://example.org/a'},{type:'text',text:' [bad](javascript:alert(1))'}]);
 assert.deepEqual(parseRichText(''),[]);assert.deepEqual(parseRichText('Saved. You have 59 catheters remaining.'),[{type:'paragraph',lines:[[{type:'text',text:'Saved. You have 59 catheters remaining.'}]]}]);
 assert.equal(parseRichText('8. Continue the count')[0].start,8);
});
