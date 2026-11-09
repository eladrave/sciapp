import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
test('stale question button replies are rejected before any chat or care mutation',async()=>{
 const mf=new Miniflare({workers:[{config:{name:'sciapp',compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],env:{DEBUG:{type:'text',value:'true'},DB:{type:'d1',id:'DB'},PHOTOS:{type:'r2',name:'PHOTOS'}},manifest:{mainModule:'worker.js',modulesRoot:process.cwd(),modules:{'worker.js':{type:'esm',contents:await readFile('dist/worker.js','utf8')}}}}}]});
 try{const db=await mf.getD1Database('DB');for(const name of ['0001_initial.sql','0002_notifications.sql','0003_account_identities.sql'])await db.exec((await readFile('migrations/'+name,'utf8')).replace(/\n/g,' '));
 const session=await mf.dispatchFetch('https://sciapp.test/api/session',{method:'POST',headers:{origin:'https://sciapp.test'}});const cookie=session.headers.get('set-cookie').split(';')[0];
 const row=await db.prepare('SELECT id,state,version FROM accounts LIMIT 1').first();const state=JSON.parse(row.state);state.messages.push({id:'question',role:'assistant',content:'Use 90 tablets?',questionId:'current-question',options:['Yes','No']});await db.prepare('UPDATE accounts SET state=? WHERE id=?').bind(JSON.stringify(state),row.id).run();
 const reply=await mf.dispatchFetch('https://sciapp.test/api/chat',{method:'POST',headers:{origin:'https://sciapp.test',cookie,'content-type':'application/json'},body:JSON.stringify({message:'Yes',responseToQuestion:'old-question'})});assert.equal(reply.status,409);
 const after=await db.prepare('SELECT state FROM accounts WHERE id=?').bind(row.id).first();assert.deepEqual(JSON.parse(after.state),state);
 }finally{await mf.dispose();}
});
