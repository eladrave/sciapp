import { build } from 'esbuild';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
const assets={};
for(const name of await readdir('web')) { const ext=name.slice(name.lastIndexOf('.'));if(types[ext])assets[`/${name}`]={body:await readFile(`web/${name}`,'utf8'),type:types[ext]}; }
await mkdir('generated',{recursive:true});await mkdir('dist',{recursive:true});
const reportBuild=await build({entryPoints:['client/doctor-report.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
assets['/doctor-report.js']={body:reportBuild.outputFiles[0].text,type:'text/javascript; charset=utf-8'};
assets['/report-font.woff']={base64:(await readFile('assets/report-font.woff')).toString('base64'),type:'font/woff'};
await writeFile('generated/assets.js',`export const assets=${JSON.stringify(assets)};\n`);
await build({entryPoints:['worker/index.js'],outfile:'dist/worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022',conditions:['workerd','worker','browser'],minify:true});
console.log(`Built worker and ${Object.keys(assets).length} web assets.`);
