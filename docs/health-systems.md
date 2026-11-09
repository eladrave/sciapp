# Patient-authorized health system connections

## Release and boundaries

SCIapp 0.8.2 adds multiple read-only SMART on FHIR R4 connections. The live application must not describe a hospital as connected until its OAuth callback has succeeded. Directory inclusion, application registration, patient authorization and record sync are distinct states.

Jackson Health System (Miami) is listed in Oracle's official patient directory under Public Health Trust of Miami-Dade County. Its listed patient endpoint is seeded, without substituting a provider endpoint. The listed hostname did not resolve from the remote browser test environment on 2026-11-08. Recheck operational availability and confirm with Jackson/Oracle if it remains unavailable. No real Jackson record retrieval has been validated.

Epic's official public Brands bundle is attempted with a bounded 4 MB read, normally weekly. If it is too large or unavailable, the smaller official R4 Endpoint Bundle is used. The latter remains published for compatibility but is deprecated by Epic; the supported provider list may therefore be narrower than Brands. No unbounded 97 MB JSON download is buffered in a Worker. Failed downloads retry no more than hourly. Searches use the local catalog, not runtime directory queries. A verified build-time snapshot of the official compact R4 directory bootstraps production even when Epic blocks Worker egress or live directory refresh fails. The snapshot is public endpoint metadata only, stored in data/epic-directory.json, with source and retrieval date. It does not contain patient records or registrations. Jackson and the Epic synthetic-patient sandbox are always seeded. Each organization retains a distinct issuer and connection; the same patient ID in two systems is not a shared identity.

## Developer registration

Register SCIapp separately with Epic and Oracle Health as a patient-facing, standalone, read-only application. Production and sandbox client IDs must remain separate.

- App: SCIapp
- Website: https://sciapp.eladrave.com
- Callback: https://sciapp.eladrave.com/api/health-systems/callback
- Privacy: https://sciapp.eladrave.com/privacy
- Terms: https://sciapp.eladrave.com/terms
- SMART authorization: authorization-code flow with S256 PKCE
- Resource access: patient read/search for Patient, MedicationRequest, AllergyIntolerance, Condition, Observation, Encounter, DiagnosticReport and DocumentReference
- Choose SMART v1 `.read` or v2 `.rs` according to advertised capabilities. Application registration must authorize matching resource scopes.
- The app requests `launch/patient`; it does not rely on OpenID identity claims or use a hospital login as the SCIapp account login.
- Public PKCE clients can reconnect when authorization expires. Persistent background access requires a confidential registration with an activated secret, offline permission and provider-issued refresh token. No guarantee of indefinite access exists.

After vendor registration/activation, open /admin, Settings, Health system registrations. Select Epic production, Epic sandbox or Oracle Health. Save the vendor-issued client ID and the actual registered authentication method. Confidential clients require the corresponding secret. Secrets are never returned to the browser. Blank secret retains the prior secret only for the identical client ID. These are application credentials, not patient portal passwords.

Vendor accounts, attestations, production activation and patient authorization cannot be manufactured by application code. No borrowed client IDs are used. The release initially has no vendor registration configured. The operator must complete this step before the patient Connect securely button can authorize real records.

## User flow

1. Settings: Connect a health system, or ask in conversation.
2. Search the organization by name; choose its directory result.
3. Connect securely opens that health system's own authorization page. SCIapp never collects its password.
4. An encrypted, 10-minute, single-use OAuth state binds the callback to the initiating account and browser cookie. PKCE verifier stays on the server.
5. Successful authorization returns to SCIapp. Select Sync now or ask to sync the selected connection.
6. The background job imports source records and reports completion, authorization expiry, or partial data availability.
7. View imported records, inspect their provenance, and optionally prepare an imported medication for explicit care-plan review. Existing medications are not overwritten through this import tool.

Normal care confirmation and a health connection confirmation are different tools. Current health reviews are protected by account ownership, expiry and single-use status. Disconnect, deleting imported copies and changing background sync require review. A generic approval can resolve a latest health review; a negation must never become approval.

## AI tools

- search_health_systems
- connect_health_system
- list_health_connections
- sync_health_records
- list_imported_health_records
- review_imported_health_record
- prepare_imported_medication
- set_health_auto_sync
- disconnect_health_system
- delete_imported_health_records
- confirm_health_connection_action

Structured health tool results are included in subsequent model context as untrusted source evidence, with available connection/record IDs. Backend ownership and validation apply independently of model output. Imported prescriptions are not proof of current use. No hospital writes, inferred reminder times, stock deductions, diagnoses or automatic care-plan reconciliation are implemented.

## Storage and synchronization

Migration 0008_health_systems.sql is additive. It creates local provider/client registration, OAuth-state, connection, record, review, job and directory-metadata tables. Stable HEALTH_TOKEN_KEY is held as a Worker secret. Its private recovery owner is the Codex SCIapp access document; never copy it here. Do not rotate it during routine deployment.

AES-GCM encryption authenticates the account/connection or record context. Tokens, PKCE payloads, original FHIR resources and confidential app secrets are encrypted. Display summaries, source dates and connection metadata are stored in D1 alongside existing account records. The UI and model receive no OAuth credentials.

One account can connect several organizations, with one patient authorization per organization. Reconnecting another patient at an existing organization clears the previous imported record store. Reconnect resets background sync to off. More complex dependent/caregiver and multiple-patient-per-organization workflows are not implemented.

Sync is idempotent on connection/resource-type/resource-ID. A patient resource is checked against the authorized context, resource subjects are checked, FHIR pagination is bounded and stays under the known issuer, and credentials are not forwarded on redirects. Resource limits: 100 requested per page, 5 pages per type, 2 MB response, 100 KB per resource. Provider page size may vary. Unsupported/forbidden resources and skipped/failed pages are reported as warnings. DocumentReference currently imports references and available metadata, not arbitrary linked documents or every note's full text. This is not an exhaustive longitudinal archive.

Manual sync uses a durable queued job; the minute cron reconciles abandoned leases and completes jobs. Explicit background sync targets roughly every six hours while renewable authorization remains valid. Failed automatic jobs are throttled to at most hourly retries. Synchronization leases and revisions prevent in-flight writes after disconnect/deletion. A sync may partially complete, and the last_error field lists missing categories.

Disconnect destroys the local token and stops future jobs, while imported records remain. Provider-portal revocation is separately available. Delete imported copies clears the separate record store and stops background imports, but does not remove source hospital data, prior conversation excerpts, user-written memory, approved care history or provider backups. A later manual sync may reimport available records. Existing account export includes up to 100 recent imported summaries; individual source resources can be opened through the authenticated record endpoint. Full bulk export and account deletion remain separate work.

## API

All routes below require an authenticated personal SCIapp account, except the state-and-cookie-validated callback. Preview users cannot connect hospitals.

- GET /api/health-systems/catalog?q=...
- GET /api/health-systems/connections
- POST /api/health-systems/connect {providerId}
- GET /api/health-systems/callback
- POST /api/health-systems/connections/:id/sync
- GET /api/health-systems/jobs/:id
- GET /api/health-systems/records?connectionId=...&type=...
- GET /api/health-systems/records/:id
- POST /api/health-systems/connections/:id/review {action,enabled?}
- POST /api/health-systems/reviews/:id {decision}

Existing administrator auth, exact-origin and CSRF controls protect:

- GET /api/admin/health-clients
- PUT /api/admin/health-clients/:vendor
- POST /api/admin/health-directory

## Validation

72 automated tests pass, including the existing care/reminder checks and new workerd/D1 integration tests. Health tests use synthetic accounts, a fake hospital and mocked FHIR/OAuth responses. Coverage includes PKCE, callback browser binding/replay, encryption context, multiple systems/account isolation, import idempotence, review-only medications, wrong-patient data, unsafe pagination, disconnect races, queued jobs/expired auth, directory caching and administrator CSRF. The live Llama model selected search_health_systems for a natural Jackson connection request. Epic sandbox SMART metadata was reachable and advertised S256 support. Real patient authorization, real hospital retrieval and long-lived vendor refresh behavior remain unvalidated pending registration and consent.

## Official references

- https://open.epic.com/MyApps/Endpoints
- https://fhir.epic.com/Documentation?docId=patientfacingfhirapps
- https://docs.oracle.com/en/industries/health/millennium-platform-apis/millennium-endpoints-patients/
- https://docs.oracle.com/en/industries/health/millennium-platform-apis/millennium-authorization-framework/
