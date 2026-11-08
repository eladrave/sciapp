import test from 'node:test';
import assert from 'node:assert/strict';
import { accountIdForSubject } from '../worker/identity.js';

test('verified production identity resolves stable account without email matching',async()=>{
 const lookups=[];
 const db={prepare(sql){assert.match(sql,/SELECT account_id FROM account_identities WHERE subject=\?/);return {bind(subject){lookups.push(subject);return {async first(){return subject==='user_ProductionOwner'?{account_id:'clerk:user_OriginalOwner'}:null;}};}};}};
 assert.equal(await accountIdForSubject(db,'user_ProductionOwner'),'clerk:user_OriginalOwner');
 assert.equal(await accountIdForSubject(db,'user_AnotherUser'),'clerk:user_AnotherUser');
 await assert.rejects(()=>accountIdForSubject(db,'owner@example.test'));
 assert.deepEqual(lookups,['user_ProductionOwner','user_AnotherUser']);
});

test('D1 identity mapping preserves original records and rejects a second mapping for the same owner',async()=>{
 const {Miniflare}=await import('miniflare');const {readFile}=await import('node:fs/promises');
 const mf=new Miniflare({workers:[{config:{name:'identity-test',compatibilityDate:'2026-11-08',env:{DB:{type:'d1',id:'DB'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("ok")}}'}}}}}]});
 try{
  const db=await mf.getD1Database('DB');
  for(const migration of ['0001_initial.sql','0003_account_identities.sql'])await db.exec((await readFile(`migrations/${migration}`,'utf8')).replace(/\n/g,' '));
  const saved=JSON.stringify({medications:[{id:'sample',name:'Sample medicine'}],events:[{id:'sample-event'}]});
  await db.prepare('INSERT INTO accounts VALUES (?,?,0,?)').bind('clerk:user_OldOwner',saved,new Date().toISOString()).run();
  await db.prepare('INSERT INTO account_identities VALUES (?,?,?)').bind('user_NewOwner','clerk:user_OldOwner',new Date().toISOString()).run();
  assert.equal(await accountIdForSubject(db,'user_NewOwner'),'clerk:user_OldOwner');
  assert.equal(await accountIdForSubject(db,'user_OldOwner'),'clerk:user_OldOwner');
  assert.equal(await accountIdForSubject(db,'user_Unrelated'),'clerk:user_Unrelated');
  assert.equal((await db.prepare('SELECT state FROM accounts WHERE id=?').bind('clerk:user_OldOwner').first()).state,saved);
  await assert.rejects(()=>db.prepare('INSERT INTO account_identities VALUES (?,?,?)').bind('user_SecondOwner','clerk:user_OldOwner',new Date().toISOString()).run());
 }finally{await mf.dispose();}
});
