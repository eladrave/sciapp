# Clerk setup for the POC

Checked against official Clerk documentation on 2026-11-08. A dedicated accountless development application was initially provisioned with the official CLI without account sign-in. Its later ownership claim reused the owner's existing browser identity. No unrelated application credentials were used.

## Development application

The [Clerk CLI](https://clerk.com/docs/cli) can provision temporary development keys without a Clerk account. However, its [current README](https://github.com/clerk/cli#add-clerk-to-an-app) explicitly limits accountless setup to Next.js, Astro, Nuxt, TanStack Start, and React Router. Plain JavaScript/Vite is not in that list. Do not assume `clerk init` will create keys for this POC.

The successful setup used a disposable React Router starter outside this repository, then extracted the dedicated instance keys for our JavaScript frontend and Worker. No application framework change was required:

```sh
npx -y clerk@latest init --starter --framework react-router \
  --name sciapp-auth-bootstrap --pm npm --accountless --no-skills --yes
```

The CLI completed with exit code 0 and produced development publishable and secret keys. Private local credential and claim files were restricted to mode 600. Their contents are excluded from this repository. Do not run this command again for this app, as it would create another instance. Keep `.clerk/`, environment files, and secret keys out of git.

The original application was successfully claimed into the owner's personal Clerk workspace on 2026-11-08 and named `sciapp`. The Dashboard confirmed “Application was successfully claimed!” for the same original development instance. The existing instance and deployed keys were preserved. The single-use claim token has been consumed and must not be used again.

The supported direct Dashboard claim flow, obtained from the official CLI's `open dashboard` implementation and retained accountless metadata, avoided a managed-environment CLI localhost callback limitation. The authenticated owner browser session completed the claim. No owner credentials were entered or copied.

The [existing application Dashboard](https://dashboard.clerk.com/apps/app_3LpVf5GKSYlQLcyUAfyBK9pkf8V/instances/ins_3LpVf12ufx6m64WvQYmQBR5LTFq) now manages this instance. The public web origin is `https://sciapp.eladrave.com`; a custom web domain does not itself convert the Clerk development instance into a production instance.

On 2026-11-08, a production instance was created inside the same application by cloning development authentication and theme settings, without selecting an upgrade or paid feature. The production instance is `ins_3LppIQO7gxZVoOIQmmb9BsJ6hmJ`, and the original development instance remains intact. The app domain is `sciapp.eladrave.com`, configured as a secondary application because the parent `eladrave.com` Clerk domain is already used by another application. The production Frontend API is `clerk.sciapp.eladrave.com`.

Live instance keys were captured privately with filesystem mode 600 and were not committed. Worker keys have not been switched. Development and production instances have separate user pools. Existing-user migration and identity mapping must be approved and completed before that switch; the current application continues using its development identity pool. Keep a future domain configurable through deployment settings and review Clerk domain, DNS, OAuth redirects, CSP, and allowed origins together when it changes.

The production domain requires these DNS-only CNAME records in the `eladrave.com` zone:

| Name | Target |
| --- | --- |
| `clerk.sciapp` | `frontend-api.clerk.services` |
| `accounts.sciapp` | `accounts.clerk.services` |
| `clkmail.sciapp` | `mail.18t6g788cfgj.clerk.services` |
| `clk._domainkey.sciapp` | `dkim1.18t6g788cfgj.clerk.services` |
| `clk2._domainkey.sciapp` | `dkim2.18t6g788cfgj.clerk.services` |

The exact Google OAuth redirect URI shown by the production instance is `https://clerk.sciapp.eladrave.com/v1/oauth_callback`. The dedicated SCIapp Google OAuth client credentials were saved to the production Google connection. A page reload confirmed the expected client ID persisted, the connection was enabled for sign-up and sign-in, and the “Setup required” warning was absent. No owner Google sign-in or real production-user creation was performed as part of that verification.

Production setup checks confirmed all five DNS records verified (Frontend API, account portal, and email 3/3). The Frontend API environment endpoint returned HTTP 200 over validated TLS. The account portal host also completed validated TLS, returning HTTP 403 without an authenticated session. The privately retained live API key successfully authenticated a Backend API instance lookup and returned the expected production instance ID. No development user was deleted or imported during this setup. Provider configuration is prepared, but the running app remains on development keys pending explicit approval for existing-account continuity.

## Synthetic authentication checks

`node scripts/auth-check.mjs` uses a dedicated `+clerk_test@example.com` user and the official Backend API. It verifies anonymous rejection and that originless Backend API session tokens are rejected by the deployed `authorizedParties` policy, then removes its test user. Clerk suppresses email delivery for development test addresses.

Positive authentication and data-isolation checks require a genuine browser session token carrying the deployed origin in its `azp` claim. Provide a private JSON file containing `{ "token": "...", "userId": "..." }` through `AUTH_CHECK_TOKEN_FILE` to run those checks. The script checks authenticated history persistence, preview separation, and rejection of invalid bearer tokens even when a preview cookie exists. Token files must remain outside the repository with mode 600. The script never prints token values. A Backend API token without `azp` must not be treated as a reason to weaken the origin allowlist.

References: [Clerk testing overview](https://clerk.com/docs/guides/development/testing/overview), [test email addresses](https://clerk.com/docs/guides/development/testing/test-emails-and-phones), [sign-in tokens](https://clerk.com/docs/reference/backend/sign-in-tokens/create-sign-in-token).

### Verified deployed results

On 2026-11-08, a dedicated synthetic test user consumed a one-time sign-in ticket in a real browser on `https://sciapp.elad-rave-scm.workers.dev`. Its genuine Clerk session was accepted by the deployed Worker. The positive integration script passed all five checks: anonymous requests rejected, genuine Clerk token accepted, authenticated account does not inherit preview data, authenticated history persists separately from preview history, and an invalid bearer token cannot fall back to a preview cookie. The synthetic Clerk user was subsequently deleted, and a follow-up lookup returned 404. The interactive Google provider flow was not performed.

After the ownership claim and custom-domain deployment, a separate synthetic account authenticated through the official Frontend API ticket flow with `https://sciapp.eladrave.com` as its origin. The resulting JWT carried that exact `azp`; the deployed `/api/state` returned 200 with personal mode, no medication records, no events, and no seeded stock. The test Clerk user and its single D1 account row were removed, with zero matching account rows remaining. This domain check verifies session acceptance, not the production Google provider setup.

## Browser

Use [ClerkJS](https://clerk.com/docs/js-frontend/getting-started/quickstart) with the publishable key returned by `/api/config`. Mount Clerk's prebuilt sign-in and account controls. Get the active session token and send it as `Authorization: Bearer <token>` to API requests. Expose no secret key in the browser. A missing key must produce an explicit synthetic preview state, never a fake signed-in identity.

## Worker

Use [`@clerk/backend` `authenticateRequest()`](https://clerk.com/docs/reference/backend/authenticate-request), passing the standard Worker `Request`. Configure `publishableKey` and either `secretKey` or a PEM `jwtKey`. The latter enables networkless verification. Explicitly accept session tokens and allow only the deployed app origin plus the local development origin:

```ts
const clerk = createClerkClient({
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
  secretKey: env.CLERK_SECRET_KEY,
});
const state = await clerk.authenticateRequest(request, {
  acceptsToken: 'session_token',
  authorizedParties: [env.APP_ORIGIN],
});
if (!state.isAuthenticated) return new Response('Unauthorized', { status: 401 });
const { userId } = state.toAuth();
```

Use the verified `userId` for database ownership. Caregiver access requires a separate app authorization check against an accepted grant. Store secrets as Worker secrets, and do not log session tokens.

### Google audience publication

The dedicated Google Cloud project sciapp-eladrave has a SCIapp Web Production OAuth client configured for the app origin and exact Clerk callback above. The client secret is private and not stored in this repository. Branding uses the live /privacy and /terms pages, with homepage links. Audience is External / In production, with zero users at setup. No extra Google API access or real-owner OAuth sign-in test was performed.

The live Worker remains on development keys. An automatic approval review blocked copying the existing verified owner identity to the new production instance, requiring explicit user approval for that sensitive transfer. The prepared account_identities mapping preserves D1/R2 ownership after approval. Do not treat completed provider settings as completed authentication cutover.
