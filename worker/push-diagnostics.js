import {AppError} from './domain.js';
export const diagnosticPhases=['status','permission-blocked','permission-requested','permission-result','service-worker','subscribing','registering','ready','setup-failed'];
export async function savePushDiagnostic(env,accountId,data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new AppError('Invalid notification diagnostic.');
 if(!/^[a-f0-9-]{36}$/.test(data.browserId||'')||!diagnosticPhases.includes(data.phase))throw new AppError('Invalid notification diagnostic.');
 const details={};
 for(const field of ['permission','beforePermission','permissionResult'])if(data[field]!==undefined){if(!['default','granted','denied','unavailable'].includes(data[field]))throw new AppError('Invalid permission state.');details[field]=data[field];}
 for(const field of ['supported','secureContext','topLevel','standalone','userActivation','hasSubscription','requestCalled','userActivationAtRequest'])if(data[field]!==undefined){if(typeof data[field]!=='boolean')throw new AppError('Invalid notification diagnostic flag.');details[field]=data[field];}
 if(data.permissionApi!==undefined){if(!['prompt','granted','denied','unavailable'].includes(data.permissionApi))throw new AppError('Invalid browser permission state.');details.permissionApi=data.permissionApi;}
 if(data.elapsedMs!==undefined){if(!Number.isInteger(data.elapsedMs)||data.elapsedMs<0||data.elapsedMs>3600000)throw new AppError('Invalid request duration.');details.elapsedMs=data.elapsedMs;}
 if(data.chromeMajor!==undefined&&data.chromeMajor!==null){if(!Number.isInteger(data.chromeMajor)||data.chromeMajor<1||data.chromeMajor>999)throw new AppError('Invalid browser version.');details.chromeMajor=data.chromeMajor;}
 if(data.errorName!==undefined){if(typeof data.errorName!=='string'||! /^[A-Za-z][A-Za-z0-9]{0,59}$/.test(data.errorName))throw new AppError('Invalid diagnostic error code.');details.errorName=data.errorName;}
 await env.DB.batch([
  env.DB.prepare('INSERT INTO push_setup_diagnostics(account_id,browser_id,phase,details,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id,browser_id,phase) DO UPDATE SET details=excluded.details,updated_at=excluded.updated_at').bind(accountId,data.browserId,data.phase,JSON.stringify(details),Date.now()),
  env.DB.prepare('DELETE FROM push_setup_diagnostics WHERE account_id=? AND rowid NOT IN (SELECT rowid FROM push_setup_diagnostics WHERE account_id=? ORDER BY updated_at DESC LIMIT 60)').bind(accountId,accountId)
 ]);
}
