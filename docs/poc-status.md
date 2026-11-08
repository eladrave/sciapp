# POC delivery status

2026-11-08, version 0.1.0.

## Delivered

Cloudflare-hosted responsive chat, contextual buttons and review cards, manual voice transcription, optional foreground hands-free browser voice, spoken proposal details, output mute and quiet preferences, photo upload/deletion and label reading, confirmed catheterization/example-medication/vitals logging, inventory receipts and reversal history, conversational settings, and caregiver invitation drafts.

Data: D1 with per-account optimistic concurrency; private R2 originals with account authorization. Clerk development sessions and isolated preview cookies are supported. AI parsing proposes actions; deterministic handlers validate and commit them. Proposals expire, new proposals supersede old ones, replayed approval does not deduct twice, and reversing a delivery cannot make stock negative.

## Verification evidence

| Check | Result |
| --- | --- |
| Build and JavaScript checks | Passed |
| Domain and Worker integration tests | 10 passed |
| Concurrent approvals and reversal | Passed; one catheter deducted once, undo restores stock |
| Session and photo ownership, cross-site rejection | Passed in workerd/Miniflare |
| Live browser care logging and refresh | Passed; approved entry persisted |
| Live Workers AI chat | Passed |
| Live synthetic label photograph | Passed; extracted 30 units/box and asked box count |
| Live Whisper transcription | Passed against public OpenAI Whisper test audio; returned expected speech content |
| Clerk genuine browser session | Passed, including authenticated/preview history separation and invalid-token rejection |
| Google provider UI | Google option observed; actual personal Google OAuth flow not performed |
| Foreground hands-free sequence | Passed with simulated browser recognition events: phrase → proposal → voice approval → stock decrement |
| Microphone hardware and Android speech lifecycle | Requires device testing; not established by simulated recognition |
| Mobile visual inspection | Performed at 412 × 915; layout issues corrected during review |
| Local Playwright browser installation | Download blocked/corrupted in this workspace; equivalent live-browser checks performed through the connected browser |

## Starter retrieval

The source collection is four reviewed summary excerpts with primary-resource URLs (MSKTC and IDSA), selected by topic. It is a small retrieval prototype, not a complete clinical corpus or a vector index. Personal care plans and medical records are not connected.

## Limits

Only example medication is configured. Photos and bag estimates must be confirmed; no bag models have completed volume-accuracy validation. Bag contents are not summed as new urine output and do not imply new-catheter consumption.

Caregiver drafts do not send an email, connect another account, or grant access. Clinical alarms, browser background reminders, EHR/Health Connect/Bluetooth, offline synchronization, Android packaging, and WhatsApp remain subsequent milestones. The app is not an emergency monitoring service.

Daily preview limits apply per client IP: 30 sessions, 150 chat requests, 60 AI/transcription calls, and 30 photos. Shared networks share these limits. These limits are request quotas, not an account-wide dollar spending cap. Cloudflare usage is billed to the deploying account under its existing plan and allowance.
