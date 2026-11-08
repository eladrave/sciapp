// Deploy through Cloudflare's documented REST API. No credentials are persisted.
import { readFile } from 'node:fs/promises';
const deployment=JSON.parse(await readFile('deployment.json','utf8'));
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
const api=async(path,method='GET',body)=>{
 const multipart=body instanceof FormData;
 const r=await fetch(`https://api.cloudflare.com/client/v4${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(body&&!multipart?{'Content-Type':'application/json'}:{})},...(body?{body:multipart?body:JSON.stringify(body)}:{})});
 const d=await r.json();if(!r.ok||!d.success)throw new Error(`Cloudflare ${method} ${path}: HTTP ${r.status} ${d.errors?.map(e=>e.code).join(',')||''}`);return d.result;
};
let databases=await api(`/accounts/${account}/d1/database`);
let db=databases.find(d=>d.name==='sciapp-poc');
if(!db)db=await api(`/accounts/${account}/d1/database`,'POST',{name:'sciapp-poc',primary_location_hint:'enam'});
const buckets=await api(`/accounts/${account}/r2/buckets`);
if(!buckets.buckets.some(b=>b.name==='sciapp-poc-photos'))await api(`/accounts/${account}/r2/buckets`,'POST',{name:'sciapp-poc-photos',locationHint:'enam'});
for(const migration of ['0001_initial.sql','0002_notifications.sql','0003_account_identities.sql','0004_retrieval.sql'])await api(`/accounts/${account}/d1/database/${db.uuid}/query`,'POST',{sql:await readFile(`migrations/${migration}`,'utf8')});
for(const name of ['sciapp-personal-memory','sciapp-shared-resources']){const indexes=await api(`/accounts/${account}/vectorize/v2/indexes`);if(!indexes.some(index=>index.name===name))await api(`/accounts/${account}/vectorize/v2/indexes`,'POST',{name,config:{dimensions:768,metric:'cosine'}});}
const bindings=[{type:'vectorize',name:'PERSONAL_MEMORY',index_name:'sciapp-personal-memory'},{type:'vectorize',name:'SHARED_RESOURCES',index_name:'sciapp-shared-resources'},{type:'plain_text',name:'APP_ORIGIN',text:deployment.appOrigin},{type:'plain_text',name:'ADDITIONAL_APP_ORIGINS',text:deployment.additionalAppOrigins.join(',')},{type:'d1',name:'DB',id:db.uuid},{type:'r2_bucket',name:'PHOTOS',bucket_name:'sciapp-poc-photos'},{type:'ai',name:'AI'}];
for(const name of ['CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY'])if(process.env[name])bindings.push({type:'secret_text',name,text:process.env[name]});
const metadata={main_module:'worker.js',compatibility_date:'2026-11-08',compatibility_flags:['nodejs_compat'],bindings,keep_bindings:['secret_text'],observability:{enabled:true,logs:{enabled:true,invocation_logs:false},traces:{enabled:true},redact_query_string:true}};
const form=new FormData();form.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.append('worker.js',new Blob([await readFile('dist/worker.js','utf8')],{type:'application/javascript+module'}),'worker.js');
await api(`/accounts/${account}/workers/scripts/sciapp`,'PUT',form);
await api(`/accounts/${account}/workers/scripts/sciapp/subdomain`,'POST',{enabled:true,previews_enabled:false});
await api(`/accounts/${account}/workers/scripts/sciapp/schedules`,'PUT',[{cron:'* * * * *'}]);
await api(`/accounts/${account}/workers/domains`,'PUT',{hostname:new URL(deployment.appOrigin).hostname,service:'sciapp',zone_id:deployment.cloudflareZoneId,enabled:true,previews_enabled:false});
const subdomain=await api(`/accounts/${account}/workers/subdomain`);
console.log(`Deployed ${deployment.appOrigin} (fallback: https://sciapp.${subdomain.subdomain}.workers.dev)`);
