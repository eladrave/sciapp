import { AppError } from './domain.js';
export const DIRECTORY='https://open.epic.com/Endpoints/Brands';
export const defaults=[
 {id:'jackson-miami',name:'Jackson Health System (Miami)',vendor:'oracle',issuer:'https://fhir-myrecord.cerner.com/r4/9NRYwNOTpYhpe-Vh6-aSWRYPlx02SAgP',source_url:'https://docs.oracle.com/en/industries/health/millennium-platform-apis/millennium-endpoints-patients/'},
 {id:'epic-sandbox',name:'Epic developer sandbox (test patients only)',vendor:'epic-sandbox',issuer:'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',source_url:'https://open.epic.com/MyApps/Endpoints'}
];
export function publicURL(value){
 let u;try{u=new URL(value);}catch{throw new AppError('Invalid health system URL.');}
 const h=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||u.hash||!h.includes('.')||/^[\d.]+$|[:\[\]]/.test(h)||/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(h))throw new AppError('Unsafe health system URL.');
 return u;
}
export async function readJSON(response,max=2000000){
 if(!response.ok){await response.body?.cancel();throw new AppError(response.status===401?'Health system authorization expired. Reconnect this system.':response.status===403?'The health system did not authorize this data type.':response.status===429?'The health system is busy. Try syncing later.':'The health system request failed.',response.status===401?401:502);}
 const reader=response.body?.getReader();if(!reader)throw new AppError('Empty health system response.',502);let size=0,text='';const decoder=new TextDecoder();
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new AppError('The health system response exceeds the import limit.',502);text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}catch(e){await reader.cancel().catch(()=>{});if(e instanceof AppError)throw e;throw new AppError('Invalid health system response.',502);}
}
export async function seedProviders(env){for(const p of defaults)await env.DB.prepare('INSERT OR IGNORE INTO health_providers VALUES(?,?,?,?,?,?)').bind(p.id,p.name,p.vendor,p.issuer,p.source_url,Date.now()).run();}
export async function provider(env,id){await seedProviders(env);const row=await env.DB.prepare('SELECT * FROM health_providers WHERE id=?').bind(String(id||'')).first();if(!row)throw new AppError('Choose a health system from the directory.',404);return row;}
export async function catalog(env,query=''){
 await seedProviders(env);const q=String(query).trim().slice(0,160).replace(/[\%_]/g,'');
 let tokens=q.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>1&&!['in','the','to','connect','system','systems','health','hospital','my','find','for','and'].includes(t)).slice(0,6);
 if(/jackson|public health trust/i.test(q))tokens=['jackson'];
 const conditions=tokens.map(()=>'(LOWER(p.name) LIKE ? OR LOWER(p.vendor) LIKE ? OR LOWER(p.id) LIKE ?)');
 const params=tokens.flatMap(t=>['%'+t+'%','%'+t+'%','%'+t+'%']);
 const rows=(await env.DB.prepare("SELECT p.*,CASE WHEN c.client_id IS NULL THEN 0 ELSE 1 END AS registered FROM health_providers p LEFT JOIN health_clients c ON c.vendor=p.vendor"+(conditions.length?' WHERE '+conditions.join(' AND '):'')+" ORDER BY CASE WHEN p.id='jackson-miami' THEN 0 ELSE 1 END,p.name LIMIT 30").bind(...params).all()).results;
 return rows.map(p=>({id:p.id,name:p.name,vendor:p.vendor,issuer:p.issuer,registered:!!p.registered,sourceUrl:p.source_url,sandbox:p.vendor==='epic-sandbox'}));
}
export async function refreshDirectory(env,fetcher=fetch,force=false){
 const meta=await env.DB.prepare("SELECT updated_at FROM health_meta WHERE id='epic-directory'").first();if(!force&&meta&&meta.updated_at>Date.now()-7*86400000)return;const attempt=await env.DB.prepare("SELECT updated_at FROM health_meta WHERE id='epic-directory-attempt'").first();if(!force&&attempt&&attempt.updated_at>Date.now()-3600000)return;await env.DB.prepare("INSERT INTO health_meta VALUES('epic-directory-attempt','attempted',?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(Date.now()).run();
 const data=await readJSON(await fetcher(DIRECTORY,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/fhir+json, application/json'}}),16000000);
 const entries=(data.entry||[]).map(e=>e.resource).filter(Boolean),byId=new Map();for(const r of entries){byId.set(r.resourceType+'/'+r.id,r);if(r.id)byId.set('urn:uuid:'+r.id,r);}
 const rows=[];for(const org of entries.filter(r=>r.resourceType==='Organization'&&!r.partOf))for(const ref of org.endpoint||[]){const ep=byId.get(ref.reference);if(!ep?.address||ep.status==='off'||ep.extension?.some(e=>e.url?.endsWith('endpoint-fhir-version')&&e.valueCode&&!e.valueCode.startsWith('4.')))continue;let u;try{u=publicURL(ep.address);}catch{continue;}if(!/\/R4\/?$/i.test(u.pathname))continue;const issuer=u.href.replace(/\/$/,'');const id='epic-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(issuer)))).slice(0,10).map(b=>b.toString(16).padStart(2,'0')).join('');rows.push({id,name:String(org.name||ep.name||u.hostname).slice(0,200),issuer});}
 if(!rows.length)throw new AppError('The official Epic directory did not contain usable R4 endpoints.',502);
 for(let n=0;n<rows.length;n+=50)await env.DB.batch(rows.slice(n,n+50).map(r=>env.DB.prepare('INSERT INTO health_providers VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,issuer=excluded.issuer,updated_at=excluded.updated_at').bind(r.id,r.name,'epic',r.issuer,DIRECTORY,Date.now())));
 await env.DB.prepare("INSERT INTO health_meta VALUES('epic-directory','downloaded',?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(Date.now()).run();return rows.length;
}
export function endpointURL(value,p){const u=publicURL(value);const base=publicURL(p.issuer);if(u.origin!==base.origin&&!(p.vendor==='oracle'&&u.hostname==='authorization.cerner.com'))throw new AppError('The health system returned an unexpected authorization host.',502);return u.href;}
export async function discover(p,fetcher=fetch){
 let d;try{d=await readJSON(await fetcher(p.issuer+'/.well-known/smart-configuration',{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}}));}catch{throw new AppError('This health system’s authorization service is currently unreachable. No connection was made. Try again later or contact the health system.',503);}
 if(!d.code_challenge_methods_supported?.includes('S256'))throw new AppError('This health system does not advertise secure S256 authorization support.',503);
 return {...d,authorization_endpoint:endpointURL(d.authorization_endpoint,p),token_endpoint:endpointURL(d.token_endpoint,p)};
}
