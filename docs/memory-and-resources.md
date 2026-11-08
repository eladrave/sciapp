# Personal memory and shared resources

Cloudflare D1 remains the source of truth for medications, schedules, stock, allergies and confirmed care. Private photos remain in R2. Two Cloudflare Vectorize V2 indexes support semantic retrieval:

- `sciapp-personal-memory`: historical user-written messages, partitioned into a server-derived SHA-256 namespace for each stable signed-in account. The client cannot choose the account or namespace. Hydration checks the authenticated owner and deletion tombstones in D1 even when the vector service returns an incorrect or stale ID.
- `sciapp-shared-resources`: administrator-published, source-linked educational excerpts. Private memories never flow into this index. The four existing curated summaries seed it, not full copies of external articles.

Workers AI `@cf/baai/bge-base-en-v1.5` supplies 768-dimensional embeddings; indexes use cosine distance. Original text lives in `retrieval_sources` and 500-character chunks in `retrieval_chunks`. Vectorize stores IDs, vectors and namespaces, without text metadata. A query embeds once, searches both collections, and hydrates up to five matches per collection above a 0.65 score. This threshold is an initial heuristic, not clinical validation. Source links accompany resource answers. Personal memory is historical context, never medical evidence or proof a dose was taken. Structured current records override it.

Only signed-in accounts capture personal memory, always enabled. Capture uses successful user chat turns of at least 20 characters, excluding common controls. Assistant guesses are not remembered. Existing retained user messages are backfilled; chats already removed by the old 100-message cap cannot be recovered. Old remembered statements can be stale or contradict newer ones. Users can inspect and remove inaccurate statements through conversation. There is no memory on/off setting. The full medical event ledger continues separately.

## Chat and button controls

Personal memory is automatic and does not appear in Settings. Text or voice commands include:

- `Show my memories`, followed by `Forget memory 1` for a displayed entry.
- `Clear my memories`, followed by `Yes, clear my memories`.
- `Show shared resources`.
- Administrators: `Add shared resource`. The conversation asks for title, HTTPS source URL, and text, then requires `Publish shared resource`.

Personal memory cannot be disabled through the UI, chat, old API routes, or persisted legacy flags. Clear removes original memory text from the retrieval tables immediately and tombstones chunks for asynchronous Vectorize deletion. D1 checks stop deleted text appearing during vector propagation. Original chat messages, confirmed records and provider backups are separate. Deleted source IDs and the capture cursor prevent cron from recreating cleared messages. New messages continue to be remembered.

## Administration and APIs

Resource privileges live in server-managed `resource_admins(account_id)`. They are not granted by client email, role claims or user input. The operator grants a verified stable account using a D1 insertion; public repository configuration contains no owner identity.

- `GET /api/memory`: enabled status and latest 100 memories.
- `POST /api/memory/settings`: legacy route rejects changes with HTTP 409 (memory is always on).
- `DELETE /api/memory`: `{ "confirm": true }`.
- `DELETE /api/memory/:sourceId`: owner-only removal.
- `POST /api/memory/search`: `{ "query": "my voice preferences" }`.
- `GET /api/resources`: shared resource catalog and caller's administrator status.
- `POST /api/resources`: admin-only `{ "title": "...", "url": "https://...", "text": "..." }`, maximum 120,000 characters of supplied text.
- Account export includes all active private memories in addition to care records.

Resources accept supplied excerpts, with source URLs as citations. They do not fetch arbitrary URLs. The administrator portal can extract reviewed text from uploaded PDF, DOCX, PPTX and other supported files, and can attach video links with supplied summaries/transcripts. See admin-portal.md. Review medical resources before publication and use content you can share. This seed collection needs expansion and clinical review before being treated as comprehensive guidance.

## Reliability and deployment

Migration `0004_retrieval.sql` and `0005_admin.sql` are additive. `scripts/deploy.mjs` creates both indexes if absent and binds `PERSONAL_MEMORY`, `SHARED_RESOURCES`, and `AI`, preserving authentication and push secrets. Hostnames remain configured in deployment.json.

D1 chunks act as a durable indexing queue. Request background work and the existing minute cron process jobs with leases, stable IDs and exponential retry. The cron rotates through four signed-in accounts to reconcile retained messages after interrupted requests. Indexing and deletion are eventually consistent. A user who generates more than 100 messages before reconciliation can exceed the recovery window after an archive failure. Vector outages degrade chat to recent structured context and the keyword seed collection. Log events contain operation/scope, not private text. Monitor pending jobs and retry counts in D1.

Cloudflare Vectorize and Workers AI usage is charged to the connected Cloudflare account under its current plan. No separate LLM API key was added.
