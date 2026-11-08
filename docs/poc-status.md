# Current status: personal care beta 0.2.1

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

39 automated tests pass, including workerd/Miniflare personal-account API persistence/isolation, concurrent approvals, medication stock and unit validation, notification permission behavior, generic lock-screen content, retry/deduplication/expiry, and DST scheduling. JavaScript checks and build pass.

Live mobile browser checks at 412 × 915 verified generic medication/allergy import, review, explicit schedule, stock decrement once, reload persistence, Today rendering, and no horizontal overflow. Live health reports 0.2.1; notification configuration is enabled. The Cloudflare minute cron and additive D1 migration are installed.

A live two-account Clerk smoke test also passed medication import/review, explicit schedules, stock deduction and replay safety, proposal isolation, push status and invalid-endpoint rejection. Both synthetic users and their D1 records were removed.

Physical Android microphone behavior and actual phone notification receipt require device testing. Local Playwright browser installation previously failed; the live browser checks supplement, rather than pretend to be, a completed local Playwright suite. Source tests include simulated speech and permission lifecycle behavior.

## Exact reminder semantics

Schedules are not retroactive before their saved timestamp. DST fall-back uses the first occurrence once; nonexistent spring-gap times shift forward by the gap. A dose logged within 90 minutes of a scheduled time suppresses that closest uncompleted occurrence; an explicit scheduledFor can link it exactly. The UI still shows the entered time.

Only reminders due within the previous ten minutes are eligible for push. Offline/browser/provider behavior can delay or prevent delivery; a missed cron beyond that window does not send a stale burst. Pending/overdue tasks remain visible for the recent day. Push retries are at least once at the network boundary; a stable generic tag collapses duplicate tray entries. No clinical alarm guarantee exists.

Catheter reminders fire once when due, then await another confirmed catheterization or a new interval clock. They do not repeat indefinitely when overdue. A current medication log removes its matching reminder; it does not silently log other medicines at the same time.

## Remaining production work

The existing Clerk application has been claimed as sciapp in the owner’s personal workspace, preserving its development instance and keys. The owned app domain is connected. Configure a production instance and production OAuth credentials, then migrate existing development identities deliberately. Do not replace auth keys without an identity mapping, which would orphan existing records.

Caregiver invitations remain drafts, without messages or access grants. No EHR/Health Connect/Bluetooth, native Android alarms, offline record synchronization, clinical monitoring, or WhatsApp connection exists. Formal privacy/security/service-term review, account deletion UX, restore testing and wider load/operational qualification remain launch work. The app is a personal beta, not a fully qualified healthcare production service.

Personal photos stay private in R2 and are experimental inputs requiring review. Urine appearance cannot establish or exclude UTI; image volume accuracy has not been validated for specific bags. Starter retrieval remains a small curated summary collection with primary-resource links, not a complete medical knowledge base.
