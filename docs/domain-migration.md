# App domain configuration and future moves

`deployment.json` owns the current app origin, temporary fallback origins, and Cloudflare zone ID. The deployment script installs APP_ORIGIN and ADDITIONAL_APP_ORIGINS on the Worker and binds the primary hostname as a Cloudflare Worker Custom Domain. The Worker serves only those configured production hostnames. Browser API/asset URLs, service worker scope, manifest URLs and notification clicks are relative to the current origin.

Current primary URL: https://sciapp.eladrave.com. The previous workers.dev origin stays available during transition. Neither hostname is an account identifier: the same Worker, D1, private R2 and Clerk instance serve both.

## Moving the app later

1. Keep the same Worker, D1/R2 bindings, stable VAPID keys and Clerk application. Do not create new user identities as a side effect of a DNS move.
2. Update appOrigin and, if needed, cloudflareZoneId in deployment.json. Keep the previous hostname in additionalAppOrigins during transition. Redeploy and verify the new Worker Custom Domain, DNS and HTTPS.
3. Configure Clerk's production domain, its required DNS records, production OAuth redirect URLs and allowed origins. CSP follows the frontend hostname encoded in the trusted publishable key; no wildcard for the user's entire domain is introduced. Clerk domain changes can invalidate existing sessions, so expect users to sign in again.
4. Verify a signed-in user sees the same account records on the new origin. Origin-bound preview cookies do not transfer. Do not copy cookies or session tokens between sites.
5. Push subscriptions, browser permissions and service worker registrations are origin-bound. Enable and test notifications on the new origin, then disable notifications on the previous one to avoid two device subscriptions. Microphone/camera permissions may need approval again.
6. Retire the old hostname only after sign-in, history and notification checks. Remove it from additionalAppOrigins and remove its Cloudflare domain binding deliberately. Use a temporary browser-navigation redirect only after all API/device migration paths are tested; never redirect credential-bearing API requests to an arbitrary hostname.

## Development to production authentication is a separate operation

The current Clerk instance is still development until production is provisioned (ownership is already claimed). A development-to-production instance change is not the same as a domain change. Development identities and sessions do not automatically become production identities. Preserve existing data and prepare an explicit verified old-ID to new-ID mapping before switching keys. Never attach medical records to a new identity using an unverified email supplied by the browser.

Official references: [Cloudflare Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [Clerk changing domains](https://clerk.com/docs/guides/development/deployment/changing-domains), [Clerk production deployment](https://clerk.com/docs/guides/development/deployment/production).
