# Architecture

## Decisions

- Begin with a responsive web POC.
- Backend uses Cloudflare Workers and Cloudflare services.
- Web, Android, and future WhatsApp clients share action contracts and authorization.
- Keep conversation transcripts separate from authoritative care records.
- Select a small implementation stack; add services as the relevant flow requires them.

## Proposed service responsibilities

| Service | Responsibility |
| --- | --- |
| Workers with Static Assets | Web delivery, API, authentication, permission checks, integrations, and action validation |
| D1 | Accounts, care relationships, settings, drafts/proposals, confirmed events, inventory ledger, and audit records |
| Private R2 | Photos and documents, with authorized access and deletion policies |
| Durable Objects | Session coordination and streamed conversation connections when required |
| Queues and Workflows | Retriable ingestion, extraction, indexing, provider sync, and notification jobs |
| Vectorize | Retrieval over reviewed resources and authorized personal documents |
| Workers AI / AI Gateway | Evaluated inference paths for conversation, image interpretation, speech, and embeddings |

Model selection remains open. Distinguish Cloudflare-hosted inference from third-party providers routed through AI Gateway; validate privacy/retention and capabilities before processing personal health information. Exclude health payloads from operational logs and caches by default. Verify applicable service terms before a real-patient launch.

## Action contract

A channel normalizes input into text, attachments, actor identity, channel identifier, and source-message ID. The assistant proposes a typed action. Deterministic handlers enforce validation, permissions, approval, and idempotency before changing records.

Example actions:
- recordCatheterization
- confirmMedicationTaken
- receiveSupplies
- inviteCaregiver
- updateSharing
- updateSettings

Every proposal has an ID, actor, care recipient, validated parameters, expiration, and state. Approval binds to the exact proposal/version. Replayed, stale, or already-executed approvals cannot execute again. Recheck authorization at execution time, including caregiver revocation.

Write a care event and its inventory consequences atomically within the chosen database boundary. Use unique source-event keys and transactional ledger changes. Never let the model directly mutate quantities or permission grants.

## Retrieval boundary

Authorize the care recipient and document scope before selecting retrieval material; enforce authorization again when serving originals. Shared curated education is separate from personal records. Retrieved text is evidence, not executable instructions.

## Client responsibilities

The web client owns accessible rendering, camera/microphone permissions, playback/mute, and clear capability/error states. The later Android client adds Health Connect, native device connectivity, local scheduled reminders, and offline synchronization. Browser testing does not establish native reminder reliability.

## WhatsApp adapter

The supplied manual describes polling, saved offsets, creator-scoped recipients, media handling, and message receipts. Verify access before promising this channel. Design a durable polling lifecycle rather than relying on an unbounded HTTP request handler. Deduplicate inbound message IDs. Unknown outbound delivery outcomes must not cause repeated care actions. Securely link opaque channel identifiers to canonical accounts; do not treat a WhatsApp ID as permanent proof of patient identity.

## Public repository

Code, synthetic fixtures, and sanitized documentation only. Secrets stay in deployment secret storage. Store actual patient files privately outside Git. No real medical data is needed to demonstrate the interface.
