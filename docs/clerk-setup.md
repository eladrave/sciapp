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

Production authentication has not been provisioned. A subsequent coordinated rollout must create the production instance on the selected owned domain, configure its DNS and its own Google OAuth credentials, and establish identity mapping before changing Worker keys. Development and production instances have separate user pools. No production key switch or user-record migration was attempted during the domain deployment. Keep a future domain configurable through deployment settings and review Clerk domain, DNS, OAuth redirects, CSP, and allowed origins together when it changes.

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
