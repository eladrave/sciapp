import { build } from 'esbuild';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
const assets={};
for(const name of await readdir('web')) { const ext=name.slice(name.lastIndexOf('.'));if(types[ext])assets[`/${name}`]={body:await readFile(`web/${name}`,'utf8'),type:types[ext]}; }
await mkdir('generated',{recursive:true});await mkdir('dist',{recursive:true});
await writeFile('generated/assets.js',`export const assets=${JSON.stringify(assets)};\n`);
await build({entryPoints:['worker/index.js'],outfile:'dist/worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022',conditions:['workerd','worker','browser'],minify:false});
console.log(`Built worker and ${Object.keys(assets).length} web assets.`);
