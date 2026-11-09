import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {savePushDiagnostic} from '../worker/push-diagnostics.js';
test('notification diagnostics are account scoped, bounded and never store arbitrary health text or endpoints',async()=>{
 const mf=new Miniflare({workers:[{config:{name:'diagnostics',compatibilityDate:'2026-11-08',env:{DB:{type:'d1',id:'DB'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("ok")}}'}}}}}]});
 try{const db=await mf.getD1Database('DB');for(const file of ['0001_initial.sql','0010_push_diagnostics.sql'])await db.exec((await readFile('migrations/'+file,'utf8')).replace(/\n/g,' '));for(const id of ['clerk:a','clerk:b'])await db.prepare('INSERT INTO accounts VALUES(?,?,0,?)').bind(id,'{}',new Date().toISOString()).run();
 const data={browserId:'11111111-1111-4111-8111-111111111111',phase:'permission-blocked',permission:'denied',requestCalled:false,standalone:false,content:'private health text',endpoint:'https://private-endpoint.invalid'};
 await savePushDiagnostic({DB:db},'clerk:a',data);await savePushDiagnostic({DB:db},'clerk:b',{...data,permission:'default'});
 const a=await db.prepare('SELECT details FROM push_setup_diagnostics WHERE account_id=?').bind('clerk:a').first();assert.equal(JSON.parse(a.details).permission,'denied');assert.ok(!a.details.includes('private'));assert.equal((await db.prepare('SELECT COUNT(*) n FROM push_setup_diagnostics WHERE account_id=?').bind('clerk:b').first()).n,1);
 await assert.rejects(savePushDiagnostic({DB:db},'clerk:a',null));await assert.rejects(savePushDiagnostic({DB:db},'clerk:a',{...data,permission:'invented'}));
 for(let i=0;i<70;i++)await savePushDiagnostic({DB:db},'clerk:a',{...data,browserId:String(i).padStart(8,'0')+'-1111-4111-8111-111111111111'});
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM push_setup_diagnostics WHERE account_id=?').bind('clerk:a').first()).n,60);assert.equal((await db.prepare('SELECT COUNT(*) n FROM push_setup_diagnostics WHERE account_id=?').bind('clerk:b').first()).n,1);
 }finally{await mf.dispose();}
});
