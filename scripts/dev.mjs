import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
const mf=new Miniflare({port:Number(process.env.PORT||8787),host:process.env.HOST||'127.0.0.1',resourcePersistencePath:'.cf/local',workers:[{config:{name:'sciapp',compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],env:{DB:{type:'d1',id:'DB'},PHOTOS:{type:'r2',name:'PHOTOS'}},manifest:{mainModule:'worker.js',modulesRoot:process.cwd(),modules:{'worker.js':{type:'esm',contents:await readFile('dist/worker.js','utf8')}}}}}]});
for(const name of ['0001_initial.sql','0002_notifications.sql']) await (await mf.getD1Database('DB')).exec((await readFile(`migrations/${name}`,'utf8')).replace(/\n/g,' '));
console.log(`SCIapp ready: ${await mf.ready}`);
process.on('SIGINT',async()=>{await mf.dispose();process.exit();});
