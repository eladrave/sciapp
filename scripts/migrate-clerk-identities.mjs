// Explicit one-time administration, never an app API. It emits no emails/tokens.
// Creates production identities but never modifies/deletes existing care records.
// Usage: LEGACY_ACCOUNT_IDS_FILE=/private/ids.json CLERK_SOURCE_FILE=/private/dev.json
// CLERK_TARGET_FILE=/private/prod.json IDENTITY_MAP_FILE=/private/map.json node scripts/migrate-clerk-identities.mjs --apply
import { readFile, writeFile, chmod } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClerkClient } from '@clerk/backend';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
assert(process.argv.includes('--apply'),'Provisioning production identities requires explicit approval and --apply');
const source=await read(process.env.CLERK_SOURCE_FILE),target=await read(process.env.CLERK_TARGET_FILE),ids=await read(process.env.LEGACY_ACCOUNT_IDS_FILE);
assert(source.CLERK_SECRET_KEY.startsWith('sk_test_'),'Source must be the development instance');
assert(target.CLERK_SECRET_KEY.startsWith('sk_live_'),'Target must be the production instance');
assert(process.env.IDENTITY_MAP_FILE,'A private output path is required');
const from=createClerkClient({secretKey:source.CLERK_SECRET_KEY}),to=createClerkClient({secretKey:target.CLERK_SECRET_KEY});
const mappings=[];let orphaned=0,skippedTest=0;
for(const accountId of ids){
 assert(/^clerk:user_[A-Za-z0-9]+$/.test(accountId),'Invalid stable account ID');
 const oldId=accountId.slice('clerk:'.length);let user;
 try{user=await from.users.getUser(oldId);}catch(error){if(error.status===404){orphaned++;continue;}throw error;}
 const address=user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId);
 assert(address?.verification?.status==='verified','Every migrated owner must have a verified primary email');
 const email=address.emailAddress;
 if(/\+clerk_test@|@example\.(?:com|org|test)$/i.test(email)){skippedTest++;continue;}
 assert(!user.banned&&!user.locked,'An inactive identity requires manual review');
 const externalId=`sciapp-legacy:${accountId}`;
 let existing=await to.users.getUserList({externalId:[externalId],limit:2});
 assert(existing.data.length<=1,'Ambiguous target identity');let next=existing.data[0];
 if(!next){
  const collision=await to.users.getUserList({emailAddress:[email],limit:2});
  assert(collision.data.length===0,'An existing production email needs explicit reconciliation');
  next=await to.users.createUser({emailAddress:[email],externalId,firstName:user.firstName||undefined,lastName:user.lastName||undefined,skipPasswordRequirement:true});
 }
 assert(next.externalId===externalId,'Unexpected production identity link');
 assert(next.emailAddresses.some(e=>e.emailAddress.toLowerCase()===email.toLowerCase()&&e.verification?.status==='verified'),'Target email verification was not preserved');
 mappings.push({subject:next.id,accountId,createdAt:new Date().toISOString()});
}
await writeFile(process.env.IDENTITY_MAP_FILE,JSON.stringify({mappings,orphaned,skippedTest},null,2),{mode:0o600});await chmod(process.env.IDENTITY_MAP_FILE,0o600);
console.log(JSON.stringify({mapped:mappings.length,orphaned,skippedTest,careRecordsChanged:false}));
