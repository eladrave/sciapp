# Administration

The `/admin` portal has separate credentials and sessions from Clerk personal care accounts. Username: `admin`. The password is configured outside the public repository. No administrator route provides access to private patient records or private memory text.

## Authentication

The Worker secret `ADMIN_PASSWORD_HASH` contains JSON with a random 16-byte hex `salt`, a 32-byte hex PBKDF2-SHA256 `hash`, and `iterations: 100000`. It contains a verifier, not the plaintext password. Provision this through Cloudflare Worker secrets; never commit it. The current Workers Web Crypto iteration limit is respected. Password comparisons use fixed-size timing-safe hashing. Login uses a generic failure response and IP/global attempt limits. Secrets and passwords do not appear in audit entries.

Successful login sets `__Host-sciapp-admin`, a random 256-bit token in a Secure, HttpOnly, SameSite=Strict cookie. D1 stores its SHA-256 digest, CSRF token, expiry and credential-version fingerprint. Sessions expire after four hours; logout revokes the row. Changing the verifier invalidates existing sessions. Authenticated writes require the same Origin and a session-bound `X-Admin-CSRF` header. Login also requires same Origin. Do not reuse a personal-account session as an administrator session.

## Shared resource workflow

1. Add a draft with title, original HTTPS source URL and supplied excerpt/summary.
2. Edit the draft or copy an existing resource to a new draft.
3. Review source and content, check the publication confirmation, then publish.
4. Mark reviewed again when an administrator reassesses it. The review interval highlights overdue material; it does not automatically withdraw it.
5. Archive obsolete material with an explicit confirmation. It immediately becomes ineligible for semantic hydration, catalogs and keyword fallback.

Administrator review records editorial review, not clinical certification. Published text is immutable: revise by copying into a new draft and archiving the previous version. Source URLs are citations; the portal does not fetch arbitrary URLs, crawl sites, or parse PDFs. Use material you can share. Original shared excerpts and their review state remain in D1; private memories are never copied into the general collection automatically.

D1 `resource_publication` records draft/published/archived state, reviewer, timestamps and version. Legacy curated summaries remain available but display that no administrator review date is recorded. `admin_audit` records login/logout and resource/settings operations. Entries ending in `_attempt` also cover concurrency conflicts; they do not imply that the requested write succeeded. Mutation responses enforce optimistic version checks.

## Settings and status

- Retrieval threshold: 0.60 to 0.90, applied on subsequent semantic queries.
- Resource review interval: 30 to 730 days, used for due-for-review highlights.
- Read-only personal memory policy: always on for every signed-in account.
- Aggregate indexing totals, pending chunks and chunks with retry history, separated by collection.

Personal memory controls are absent from app Settings. The backend rejects old disable API calls and chat commands. User correction/forget/clear operations remain available to handle inaccurate statements without disabling future memory.

## Deployment and recovery

Apply additive migration `0005_admin.sql` before deploying. `scripts/deploy.mjs` includes it and preserves existing Worker secrets. It accepts `ADMIN_PASSWORD_HASH` from the environment for first configuration or rotation. Application hostnames continue to come from deployment.json; the portal uses relative paths, same-origin APIs and host cookies.

To recover access, replace the verifier through Cloudflare secrets. Do not add a plaintext fallback or bypass authentication. Future hardening priorities include named administrator identities, multi-factor authentication, backup restoration drills, and clinical review of medical resources before broad release.
