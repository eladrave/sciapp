// Trusted deployment configuration only. Clients use relative API and asset URLs.
export function configuredOrigins(env, requestOrigin) {
 if (!env.APP_ORIGIN) return [requestOrigin]; // Unconfigured local/test runtime.
 const values = [env.APP_ORIGIN,...String(env.ADDITIONAL_APP_ORIGINS||'').split(',').filter(Boolean)];
 return values.map(value=>{const url=new URL(value.trim());if(url.protocol!=='https:'||url.origin!==value.trim())throw new Error('Invalid app origin configuration');return url.origin;});
}
export function contentSecurityPolicy(publishableKey) {
 let clerk='';
 if(publishableKey){
  const encoded=publishableKey.replace(/^pk_(?:test|live)_/,'').replace(/-/g,'+').replace(/_/g,'/');
  const host=atob(encoded).replace(/\$$/,'');
  if(!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(host))throw new Error('Invalid Clerk frontend hostname');
  clerk=` https://${host}`;
 }
 return `default-src 'self'; script-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com${clerk}; connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com${clerk}; img-src 'self' blob: data: https://img.clerk.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; frame-src https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com${clerk}; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`;
}
