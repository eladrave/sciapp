// Synthetic development-instance check. No secrets or token values are printed.
// Usage: CLERK_CREDENTIALS_FILE=/private/keys.json node scripts/auth-check.mjs
import { readFile, writeFile, chmod } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClerkClient } from '@clerk/backend';

const origin = process.env.AUTH_CHECK_ORIGIN || 'https://sciapp.elad-rave-scm.workers.dev';
const credentials = JSON.parse(await readFile(process.env.CLERK_CREDENTIALS_FILE || '/tmp/sciapp-clerk-credentials.json', 'utf8'));
assert(credentials.CLERK_SECRET_KEY.startsWith('sk_test_'), 'Only development instances may be tested');
const clerk = createClerkClient({ secretKey: credentials.CLERK_SECRET_KEY, publishableKey: credentials.CLERK_PUBLISHABLE_KEY });
const externalToken = process.env.AUTH_CHECK_TOKEN_FILE ? JSON.parse(await readFile(process.env.AUTH_CHECK_TOKEN_FILE, 'utf8')) : null;
const result = { origin, method: externalToken ? 'browser-session-token' : 'backend-session-origin-negative', passed: [], cleanup: false };
let user;
let cookie;
const headers = { Origin: origin, 'Content-Type': 'application/json' };
const request = (path, options = {}) => fetch(origin + path, { ...options, signal: AbortSignal.timeout(30000) });
try {
  assert.equal((await request('/api/state')).status, 401);
  result.passed.push('anonymous state rejected');
  const preview = await request('/api/session', { method: 'POST', headers });
  assert.equal(preview.status, 200);
  cookie = preview.headers.get('set-cookie')?.split(';')[0];
  assert(cookie, 'Preview cookie exists');
  const previewHeaders = { ...headers, Cookie: cookie };
  assert.equal((await request('/api/chat', { method: 'POST', headers: previewHeaders, body: JSON.stringify({ message: 'Settings' }) })).status, 200);
  let token;
  if (externalToken) {
    token = { jwt: externalToken.token };
  } else {
    user = await clerk.users.createUser({ emailAddress: [`sciapp-auth-${Date.now()}+clerk_test@example.com`], skipPasswordRequirement: true, privateMetadata: { e2eTestUser: true, purpose: 'sciapp-auth-check' } });
    const session = await clerk.sessions.createSession({ userId: user.id });
    token = await clerk.sessions.getToken(session.id);
    await writeFile('/tmp/sciapp-auth-check-private.json', JSON.stringify({ userId: user.id, sessionId: session.id, token: token.jwt }) + '\n', { mode: 0o600 });
    await chmod('/tmp/sciapp-auth-check-private.json', 0o600);
  }
  assert(token.jwt, 'Official session token exists');
  const authHeaders = { ...headers, Authorization: `Bearer ${token.jwt}` };
  const auth = await request('/api/state', { headers: authHeaders });
  if (!externalToken) {
    // Backend-minted sessions have no browser Origin (azp), so the deployed
    // authorizedParties policy must reject them. Use an actual browser token
    // through AUTH_CHECK_TOKEN_FILE for the positive integration checks.
    assert.equal(auth.status, 401);
    result.passed.push('originless backend token rejected by authorizedParties');
    result.pending = ['positive authentication and isolation require origin-bearing browser token'];
  } else {
  const claims = JSON.parse(Buffer.from(token.jwt.split('.')[1], 'base64url'));
  assert.equal(claims.azp, origin);
  if (externalToken.userId) assert.equal(claims.sub, externalToken.userId);
  assert.equal(auth.status, 200, 'Genuine Clerk session accepted by Worker');
  let state = await auth.json();
  assert(!state.messages.some(m => m.role === 'user' && m.content === 'Settings'), 'Authenticated account does not inherit preview messages');
  result.passed.push('genuine Clerk session accepted', 'authenticated account does not inherit preview');
  const write = await request('/api/chat', { method: 'POST', headers: authHeaders, body: JSON.stringify({ message: 'Record blood pressure' }) });
  assert.equal(write.status, 200);
  state = await (await request('/api/state', { headers: authHeaders })).json();
  assert(state.messages.some(m => m.role === 'user' && m.content === 'Record blood pressure'));
  const separate = await (await request('/api/state', { headers: previewHeaders })).json();
  assert(!separate.messages.some(m => m.role === 'user' && m.content === 'Record blood pressure'));
  assert(separate.messages.some(m => m.role === 'user' && m.content === 'Settings'));
  result.passed.push('authenticated history persisted separately from preview');
  assert.equal((await request('/api/state', { headers: { ...previewHeaders, Authorization: 'Bearer invalid' } })).status, 401);
  result.passed.push('invalid bearer token cannot fall back to preview cookie');
  }
} catch (error) {
  result.failure = { name: error.name, message: String(error.message).replace(/(?:pk|sk)_(?:test|live)_\S+/g, '[redacted]'), status: error.status, codes: error.errors?.map(e => e.code) };
  process.exitCode = 1;
} finally {
  if (user) { await clerk.users.deleteUser(user.id); result.cleanup = true; }
  if (cookie) await request('/api/session', { method: 'DELETE', headers: { ...headers, Cookie: cookie } });
  await writeFile('/tmp/sciapp-auth-check-result.json', JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(result));
}
