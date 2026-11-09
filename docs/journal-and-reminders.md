# Care journal and local-time reminders (0.10.0)

## Reminder behavior

The backend compares UTC instants, then formats clocks in the account IANA timezone. `careAgenda` returns the local clock, today's unconfirmed occurrences, the next future task, and active routine medications without explicit times. At 09:30 in America/New_York on November 9, 2026, the 11:30 catheter task is upcoming. Notification permission does not gate the agenda or in-chat check-ins.

`get_care_agenda` returns the authoritative schedule reply directly. The model selects the tool from ordinary language; it does not have to infer task status by comparing UTC clock strings with local HH:mm values. The UI shows a check-in after messages and refreshes it each minute while the conversation or Today page is visible and idle. Refreshes do not interrupt the journal, draft text, settings, or an open dialog.

Medication occurrences have distinct IDs. A due dose offers a choice of actual time (scheduled time, now, or another time), then a review. Approval records the actual time and `scheduledFor` separately and suppresses that occurrence. Unknown stock consumption units do not block recording a reported dose; the review explicitly leaves stock unchanged. Reminders never establish dose completion or recommend catch-up doses. The 30-minute chat snooze stores a reminder preference, not a dose record, and requires an open page or subsequent return to show again. PRN medications have no routine reminders.

## Push notifications

The browser requests permission from a direct Enable button before network awaits. Device registration follows permission and service-worker subscription. Account-scoped endpoint checks detect a missing server registration and reconnect an already-authorized browser. The conversation exposes setup when this browser is disconnected. Browser or Android permission denial must be changed on that device.

The Worker push fetch uses `redirect: manual`, rejects unsuccessful responses, and retains the FCM/Mozilla/Apple host allowlist, encrypted generic payloads, occurrence deduplication, retries, and expired-endpoint cleanup. No health details appear on the lock screen. Medication and catheter schedules use the same minute dispatcher.

## Persistent journal

Original image bytes remain in the private per-account R2 namespace. Image metadata, vision evidence, and user text are saved alongside the account's care ledger; confirmed events link the original photo ID. The previous 100-photo preview cap applies only to anonymous previews. Signed-in users retain originals until explicit deletion. Raw voice recordings are not retained; submitted transcription text is part of the conversation.

`occurredAt` is the observation/administration time. `createdAt` is when the record was saved. BP/pulse, medication doses, bag readings, catheterization, and journal notes support distinct occurrence times. Historic records without an occurrence timestamp fall back to their original creation timestamp; an earlier time cannot be reconstructed from missing evidence.

`POST /api/journal` searches the complete account ledger, not only the last 15 events shown in AI context. Filters include category, inclusive local start/end dates, today/yesterday, images only, and inclusion of corrected records. Queries use the account timezone and an exclusive start of the day after the requested end date, including DST transitions. Results are newest first, with a maximum of 50 entries per request and stable cursor pagination. Image queries deduplicate repeated records about the same original. Unlinked images are explicitly unreviewed; deleted originals remain unavailable while the care record is retained.

`query_care_journal` normally renders matching records and original image cards directly in chat. `purpose: lookup` permits reading identifiers or values before another action or analysis. Lookup results include server-formatted local timestamps; the model must not convert UTC clock strings itself. All lookups are read-only and account scoped. `journalNote` prepares a reviewed user observation with a resolved occurrence time, category, and optional owned photo. AI appearance estimates remain separate from user observations and are not diagnoses.

History provides category/date filters, original image viewing, comparison of up to three images, correction visibility, and a self-contained HTML doctor report with the shown entries and embedded original images. Load additional pages before preparing a larger report. The ready links save the HTML or open it for browser printing / Save as PDF. Reports are generated locally and are not sent to anyone. Account JSON export includes care data and photo metadata, not original image bytes.

## Validation

- 104 automated tests passed, plus JavaScript syntax checks, build, and whitespace checks.
- Coverage includes the exact 09:30 / 11:30 regression, medication occurrence matching independent of push permission, local-date retrieval across UTC midnight, 70-record pagination, account isolation, retained original references, correction visibility, and approved timed observations.
- Live Remote Browser used an isolated signed-in test account, synthetic records, actual R2 uploads, the configured AI provider, actual APIs, approval and persistence.
- Verified native AI requests for What's next, yesterday's BP, last three catheter images, and a reviewed color/cloudiness note with its original image and observation time.
- Verified mobile gallery, original images, three-image comparison, no horizontal overflow, and a printable self-contained report with three embedded original PNG images. Remote Browser did not expose a download completion event; the report opened and its complete embedded content was inspected.
- Verified real Web Push registration, provider acceptance, visible browser notification, and a separate medication occurrence delivered by the minute cron with one accepted attempt.
- Physical Android permission and notification receipt still require a test on that phone. No claim of physical Android validation is made.

## Storage boundary

This release searches the existing persistent account ledger rather than introducing a separate clinical database. Image bytes are stored separately in R2, but account metadata and care events still share the account JSON record. A future storage migration should move journal rows and photo metadata into indexed per-account tables before sustained high-volume use approaches D1's row/value limits. The API pagination contract is designed to remain stable through that migration. This release does not establish a clinical archive retention SLA or validate urine appearance as a medical measurement.
