import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredOrigins, contentSecurityPolicy } from '../worker/origins.js';

test('deployed hostnames come from one explicit origin configuration',()=>{
 const env={APP_ORIGIN:'https://care.example.org',ADDITIONAL_APP_ORIGINS:'https://previous.example.org'};
 assert.deepEqual(configuredOrigins(env,'https://untrusted.example'),['https://care.example.org','https://previous.example.org']);
 assert.deepEqual(configuredOrigins({},'http://127.0.0.1:8787'),['http://127.0.0.1:8787']);
 assert.throws(()=>configuredOrigins({APP_ORIGIN:'https://care.example.org/path'},'https://x.test'));
 assert.throws(()=>configuredOrigins({APP_ORIGIN:'http://care.example.org'},'https://x.test'));
});
test('Clerk CSP follows the configured auth frontend without permitting unrelated subdomains',()=>{
 const key='pk_live_'+Buffer.from('clerk.care.example.org$').toString('base64url');
 const csp=contentSecurityPolicy(key);
 assert.ok(csp.includes('https://clerk.care.example.org'));assert.ok(!csp.includes('*.example.org'));
 assert.throws(()=>contentSecurityPolicy('pk_live_'+Buffer.from('bad.test; unsafe$').toString('base64url')));
});
