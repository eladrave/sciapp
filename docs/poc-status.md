# Current status: personal care beta 0.5.0

The primary domain is https://sciapp.eladrave.com, with the workers.dev origin retained for transition. Domain configuration and future migration steps are documented in domain-migration.md.

The live app uses real Cloudflare D1/R2 persistence with isolated Clerk account identities. Signed-in records now support medications, dosage/frequency labels, allergies, explicitly chosen schedules, confirmed dose logging, and per-medication inventory. The sample preview stays separate.

## Working behavior

- Medication and allergy lists become review cards. Partial parsing is rejected; imported labels never manufacture times, units per dose, or stock.
- Existing signed-in sample accounts migrate lazily on their next authenticated request. History is preserved; example balances do not become actual supplies. A previously refused bulk list can become a pending review, never an automatic save.
- Actual catheter count is set explicitly. Medication stock is counted in the chosen unit; consumption units are configured or requested before deduction. An approval is idempotent. Reminders never imply medication or catheter use.
- Daily medication reminders use explicit local times and account timezone. As-needed medication has no automatic dose schedule. Catheter reminders use an explicitly enabled interval, anchored to the start clock or most recent confirmed catheterization.
- Device subscriptions and delivery attempts are stored in D1. A minute cron encrypts generic Web Push payloads, claims occurrences, retries provider failures with bounded attempts, and removes expired subscriptions. Provider requests use an endpoint hostname allowlist and no redirects.
- Lock-screen text contains no medication, dosage, volume, allergy, or account identity. Signing out disables the device subscription. Shared browsers do not inherit another account’s local subscription.
- Hands-free Pause/Listen, manual voice drafts, sound mute, photo upload, reviewed experimental measurements, basic vitals logging, and undo remain available.

## Validation

49 automated tests pass, including workerd/Miniflare personal-account API persistence/isolation, concurrent approvals, medication stock and unit validation, notification permission behavior, generic lock-screen content, retry/deduplication/expiry, and DST scheduling. JavaScript checks and build pass.

Live mobile browser checks at 412 × 915 verified generic medication/allergy import, review, explicit schedule, stock decrement once, reload persistence, Today rendering, and no horizontal overflow. Live health reports 0.5.0; notification configuration is enabled. The Cloudflare minute cron and additive D1 migration are installed.

A live two-account Clerk smoke test also passed medication import/review, explicit schedules, stock deduction and replay safety, proposal isolation, push status and invalid-endpoint rejection. Both synthetic users and their D1 records were removed.

Physical Android microphone behavior and actual phone notification receipt require device testing. Local Playwright browser installation previously failed; the live browser checks supplement, rather than pretend to be, a completed local Playwright suite. Source tests include simulated speech and permission lifecycle behavior.

## Exact reminder semantics

Schedules are not retroactive before their saved timestamp. DST fall-back uses the first occurrence once; nonexistent spring-gap times shift forward by the gap. A dose logged within 90 minutes of a scheduled time suppresses that closest uncompleted occurrence; an explicit scheduledFor can link it exactly. The UI still shows the entered time.

Only reminders due within the previous ten minutes are eligible for push. Offline/browser/provider behavior can delay or prevent delivery; a missed cron beyond that window does not send a stale burst. Pending/overdue tasks remain visible for the recent day. Push retries are at least once at the network boundary; a stable generic tag collapses duplicate tray entries. No clinical alarm guarantee exists.

Catheter reminders fire once when due, then await another confirmed catheterization or a new interval clock. They do not repeat indefinitely when overdue. A current medication log removes its matching reminder; it does not silently log other medicines at the same time.

## Remaining production work

The existing Clerk application is claimed as sciapp in the owner’s workspace. The production instance is active at sciapp.eladrave.com, with its own Google OAuth client and External / In production audience. DNS is verified and both certificates are issued. The user explicitly approved copying the verified owner identity into production and linking it to its original account. One real owner was imported and mapped; a stale orphan account was retained without import. Runtime keys were switched together, with existing D1/R2 ownership preserved. Development credentials remain private for rollback.

Caregiver invitations remain drafts, without messages or access grants. No EHR/Health Connect/Bluetooth, native Android alarms, offline record synchronization, clinical monitoring, or WhatsApp connection exists. Public privacy and usage pages now describe the implemented beta behavior. Formal privacy/security/service-term review, account deletion UX, restore testing and wider load/operational qualification remain launch work. The app is a personal beta, not a fully qualified healthcare production service.

Personal photos stay private in R2 and are experimental inputs requiring review. Urine appearance cannot establish or exclude UTI; image volume accuracy has not been validated for specific bags. Starter retrieval remains a small curated summary collection with primary-resource links, not a complete medical knowledge base.

## Authentication migration and production checks

The server-managed account_identities resolver preserves stable D1/R2 ownership after the Clerk identity change. The app never links accounts from a browser-provided email. The explicit administration script imports verified existing owners, uses an external identity marker, refuses ambiguous collisions, and requires --apply. After explicit approval, the real owner’s identity was imported and mapped without modifying its account snapshot during the identity operation. First production load also applied the existing personal-care schema upgrade, preserving history and recovering a previous bulk medication message as a pending review. This review was not approved automatically.

Production smoke testing passed all nine grouped checks: reported0.3.1 and production environment, genuine origin-bearing sessions, separate personal spaces, approval-gated lists, cross-account proposal denial, explicit reminder times, exactly-once dose approval, invalid bearer rejection, and empty push subscriptions for fresh accounts. Both synthetic users and exactly two synthetic D1 accounts were removed, with zero matching rows remaining.

The actual Google OAuth flow was also completed in the browser. It linked to the expected imported identity, returned to the app, and opened the existing history and conversation. Login did not approve medication or other care actions. Production Clerk SDK, mobile modal rendering and anonymous access rejection were checked. Logout cleared the client UI/session and anonymous /api/state returned401. Old workers.dev home navigation now redirects to the canonical domain without forwarding auth query parameters; API requests are not redirected. This validates authentication, not clinical qualification or physical phone notification delivery.

## Conversation reliability update

AI-generated actions now discard unset optional fields, validate explicit settings, and ask for clarification when malformed. Schedule descriptions cannot become taken doses. Reminder times require explicit user input. Recent AI context includes review-card details and does not duplicate the current utterance. Chat responses include computed reminder tasks.

Conversation sends retain the latest turn instead of resetting to the top. Background re-renders preserve the visible message and offset, and the composer avoids forced keyboard focus. Three mobile browser regressions cover send/failure, navigation/expiry anchoring, and hands-free focus.

Storage remains per-account versioned JSON in Cloudflare D1, with confirmed event history and the latest 100 chat messages; private photos are in R2. AI input uses the latest eight messages plus structured care data, matching historical user statements, and source-linked resource excerpts. Separate Cloudflare Vectorize indexes now support private memory and shared resources, with the keyword seed collection as a fallback. See memory-and-resources.md for controls, isolation, retention and current limitations.

## Semantic memory update

Two 768-dimensional cosine Vectorize indexes are provisioned and bound to the Worker. D1 migration 0004 stores source text, chunks, indexing jobs, preferences and operator-managed resource privileges. Private namespaces are derived on the server and D1 ownership/deletion checks apply to every returned match. Personal memory is always enabled for signed-in users. Settings contains no memory controls; users can inspect and correct remembered statements in conversation. Legacy disable requests are rejected and persisted disabled flags are ignored. Administrators can publish source-linked shared excerpts through an explicit review step. No private content is automatically published. Workers AI provides embeddings, preserving the Cloudflare backend.

Automated validation includes adversarial cross-owner vector results, wrong-owner deletion attempts, stale-index tombstones, disabled capture/retrieval, idempotent seeding, invalid source URLs, administrator enforcement and indexing retries. The existing minute cron reconciles saved recent messages and indexes jobs. Resource catalog initially contains the four prior curated summaries, not a complete medical library.

Live validation at 0.4.0 used two isolated synthetic accounts. Exact private retrieval returned the correct owner statement; the other account did not receive its ID. Shared search returned the shoulder exercise summary and original source link. Wrong-owner deletion and unauthorized publishing were blocked, disabling suppressed private matches, clear required explicit confirmation, deleted text could not be retrieved through stale vectors, and mobile Settings exposed the controls. The screenshot schedule clarification returned HTTP 200 with reminder tasks and no mute error. Synthetic records and vectors were removed after testing.

## Administration update

Version 0.5.0 adds a separate `/admin` portal with password-verifier authentication stored as a Worker secret, rate-limited sign-in, four-hour server-side sessions, Secure/HttpOnly/SameSite cookies, exact-origin validation and CSRF protection. It manages shared resource drafts, reviewed publication, immutable published excerpts, archival, configurable retrieval threshold/review interval, aggregate indexing status and administrative audit events. No private user records appear in the portal. Draft and archive filtering applies to semantic hydration, resource catalogs and keyword fallback. Personal memory is always enabled and removed from Settings.

Live 0.5.0 mobile verification (412 x 915): administrator login/logout, settings save, draft creation/edit/archive, publication confirmation, Activity display, HTTP 401 for unauthenticated or logged-out access, HTTP 403 for missing CSRF, and no horizontal overflow passed. The synthetic unpublished draft was removed; administrative audit entries remain. The normal app Settings view has zero memory controls.
