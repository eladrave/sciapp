# sciapp

Accessible conversational care companion for people with spinal cord injuries.

## Status

Personal care beta at **https://sciapp.eladrave.com** (0.8.2).

Clerk identities own isolated records in Cloudflare D1. Signed-in accounts have their own medications, allergies, inventory, settings, and confirmed care journal. The separate seven-day sample preview remains available. Production Clerk and Google sign-in are active. This remains a personal-care beta, not a completed production healthcare qualification.

## Try it

Sign in, paste a medication list as `name dose, frequency`, and approve the review. Add an Allergies heading with one allergy per line. Previously refused bulk lists may be recovered as pending reviews on first sign-in after upgrade. The app never infers reminder times or pill counts from a dosage label.

- “Remind me to take Sample medicine at 08:00 and 20:00” sets daily reminders after review.
- “I have 60 Sample medicine tablets” configures current stock. “Use 1 tablet per dose for Sample medicine” configures consumption units explicitly.
- “I took Sample medicine” records confirmed use. Only approval changes stock. PRN medicines do not receive routine dose reminders.
- “I have 120 catheters” sets actual current inventory. Deliveries add to an already known balance; an unknown starting balance stays unknown until counted.
- “Set catheter reminders every 4 hours” starts an interval clock now. The interval resets after each confirmed catheterization. Specify your care-plan interval.
- Settings → Enable notifications on this device → allow browser permission → Send test notification. Alerts contain only a generic prompt to open the app.
- “Show my medications”, “Show my allergies”, “Set my timezone to America/New_York”, “Make text larger”, “Mute”, and “Turn hands-free on” work in chat.
- In hands-free mode, Pause/Listen stops/resumes microphone recognition. Output sound is separate from microphone input.

Reminders use a Cloudflare minute cron and Web Push, rather than an open-page timer. Delivery depends on the browser, network, and operating system. A push-service acceptance is not proof of delivery. Caregiver access, EHR, native Android alarms and WhatsApp remain unimplemented. See [current validation and limits](docs/poc-status.md).

Domain settings live in `deployment.json`; see [moving domains later](docs/domain-migration.md). The workers.dev address remains a temporary fallback. Sign in again and enable notifications on the new origin; saved account records use the same database.

## Run locally

Requires Node.js matching the pinned Cloudflare tooling (currently Node 24.22+).

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:8787. Local development uses Miniflare and persists synthetic D1/R2 data under `.cf/local`. Without an AI binding, button-driven care flows work and freeform AI/transcription report their unavailable state. Cloudflare AI is exercised on the deployed preview.

```sh
npm test
npm run check
npx playwright install chromium
npm run test:browser
```

The browser tests simulate speech-recognition events; they do not prove microphone hardware accuracy. See [validation and limitations](docs/poc-status.md).

## Deploy

All application compute and storage use Cloudflare Workers, D1, R2, and Workers AI. Clerk provides identity; the Worker verifies its sessions and keeps care records separate.

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` privately, plus `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` for first setup. Push uses stable P-256 `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` secret bindings. Preserve them across deployments; changing them requires devices to resubscribe. Run:

```sh
npm run deploy
```

The deployment script uses Cloudflare's REST API, provisions missing named POC resources, applies the idempotent initial schema, uploads the bundled Worker, preserves existing secret bindings, and enables the built-in workers.dev URL. It does not modify unrelated Workers or domains. Configure the token with Workers Scripts Write, D1 Write, and Workers R2 Storage Write. Workers AI also needs to be available on the account. On the first vision-model use, follow Cloudflare's model-agreement instructions in the [vision guide](https://developers.cloudflare.com/workers-ai/guides/tutorials/llama-vision-tutorial/).

`cloudflare.config.ts` records the same named bindings for Cloudflare tools. The tested build/dev/deploy commands above use the explicit scripts; this repository does not depend on cf's framework auto-detection.

## Authentication

The deployed app uses a dedicated Clerk development instance with Google available. See [Clerk setup and validation](docs/clerk-setup.md). Development-instance ownership must be claimed before treating it as a durable production identity service. Credentials and ownership metadata are private and are not in this repository.

## What is deliberately next

Real medication configuration, delivered caregiver invitations/accepted grants, validated bag-volume estimation, offline synchronization, native reminders, Health Connect/Bluetooth, EHR imports, a full reviewed resource corpus, and WhatsApp are not completed in this POC. Browser preview preferences do not change a prescribed care plan.

## Product direction

One conversation supports typing, voice, photos, and large suggested-answer buttons. All settings and caregiver invitations must be manageable through the same interface. Users can move between input modes without losing task context.

Web and Android will share a Cloudflare backend. A future WhatsApp adapter will use the same authorized care actions.

- [Product requirements](docs/product-requirements.md)
- [Architecture](docs/architecture.md)
- [POC acceptance criteria](docs/poc-acceptance.md)
- [Implemented status and validation](docs/poc-status.md)

## Development boundaries

Use synthetic fixtures during initial development. Never commit credentials, personal medical data, recordings, private documents, or the reference WhatsApp PDF. Public repository visibility does not grant an open-source license; a license has not yet been selected.

Personal memory and shared resource semantic search use separate Cloudflare Vectorize indexes. See [memory and resources](docs/memory-and-resources.md) for ownership, retention, chat controls, publishing and operations.

Administrator portal: `/admin`. Shared resources have draft, published and archived states, review dates, search settings, aggregate indexing status and an administrative audit trail. Configure the password verifier through the `ADMIN_PASSWORD_HASH` Worker secret. See [administration](docs/admin-portal.md). Personal memory is always on for signed-in users and is not a Settings control.

Admin resources also accept private original files (up to 10 MB) and video URLs with supplied summaries or transcripts. PDF, DOCX, PPTX, ODT and text extraction feeds an editable draft; publication remains manual. See docs/admin-portal.md for extraction and download limits.

Uploaded MP3/WAV/M4A/MP4/WebM/OGG/FLAC can generate background speech transcripts through Cloudflare Workers AI. Pending jobs survive page closure; publication still requires review. Video page URLs are not automatically downloaded.

Chat messages now reach the Llama 3.3 70B model first, using native typed care tools. Backend validation and review still gate writes; deterministic parsing is a tool validator/offline fallback, not the primary router. Catheter reminders support explicit daily wall-clock times across midnight as well as intervals. See docs/conversation-tools.md.

Health system integrations: [setup, supported tools and current activation requirements](docs/health-systems.md). Patient-authorized hospital connections require vendor registration before real data access.

Version 0.8.3 accepts medication schedules grouped by explicit AM/PM time headings. Approval saves daily times to the profile and reminders, merges repeated medicines, and retains as-needed instructions without routine PRN reminders. Unlisted medicines remain unchanged.

Version 0.8.4 adds editable AI provider/model settings in Admin → Settings → AI models. OpenAI uses server-side credentials and the Responses API. See [AI configuration](docs/ai-configuration.md) for setup, privacy and rollback. Live OpenAI validation requires a valid project key; legacy Cloudflare can remain active during setup.

Version 0.8.5 adds configurable OpenAI-compatible base URLs, encrypted provider keys, model discovery, manual model IDs, and Responses/Chat Completions selection in Admin AI settings.

Version 0.9.0 replaces the active care command parser with typed proposals and a bounded native tool loop. The model reads context, resolves times, prepares or revises reviews, and commits only an approved current review. It retains photo evidence, supports conversational corrections and grouped medication schedules, and improves photo menu contrast. Medication bottle inventory uses configured medication IDs. No model code execution is available. See docs/care-agent.md.

Version 0.9.1 adds selectable clarification answers with free-form typing/speech, stale-question protection, medication photo strength/form matching, and reviewable care corrections. Earlier approved entries are not automatically rewritten.

Version 0.9.2 restores follow-up and clarification button availability after requests finish, including hands-free mode. Stale question answers remain disabled.

Version 0.10.0 adds a searchable care journal with original images, local-date history, three-image comparison, user observations, and printable doctor reports. Server-computed local agendas and accessible medication check-ins separate upcoming care from unconfirmed earlier items. Push registration repair and Worker delivery were verified with a real isolated browser account. See [journal and reminders](docs/journal-and-reminders.md) for behavior, validation, and storage boundaries.

Version 0.11.0 groups medication check-ins by scheduled time, supports all/some and spoken names or numbers, and records selected doses through one review. Original photo capture timestamps can prefill reviewed care times with clear timezone assumptions. Accessibility requirements are recorded in AGENTS.md. See [journal and reminders](docs/journal-and-reminders.md).

Version 0.11.3 keeps the latest chat in view through delayed photo/card layout and offers occurrence-specific reminder dismissal by button or voice, without recording care or disabling future schedules. Version 0.11.2 preserves reported medication selections across interrupted questions, resumes only the missing timing/review step, and prevents competing or empty check-in cards. Check-ins can be hidden for 30 minutes without recording care. Version 0.11.1 makes doctor reports PDF only, with full-page original-resolution images and readable dated notes. It also replaces vague notification blocking messages with browser-reported permission states and account-scoped technical setup diagnostics. See [journal and reminders](docs/journal-and-reminders.md).

Version 0.11.10 accepts whole books as shared resources. Extracted document text may be up to 1,500,000 characters (and 1.9 MB, the D1 row limit) instead of 120,000, so a long PDF fills the searchable text automatically and no manual summary is needed. Publishing inserts chunks 100 per statement, chunks end at word boundaries, and the minute cron embeds and indexes up to 200 chunks per run in groups of 50, falling back to single chunks if a group fails. Figures and images inside documents are still not extracted or shown in chat.

Version 0.11.9 adds an About you section to Settings with preferred name, full name, gender, date of birth and spinal cord injury level. Every field is optional. The Save my details button stores them directly through `POST /api/profile`; the same details can be given in the conversation, where they go through a settings review. They are identity details, not care records, and the assistant receives them as context.

Version 0.11.8 groups medicines that share a scheduled time into one row in the Today reminder list, with one Dismiss all control for that time. Dismissed and still-open medicines stay in separate rows.

Version 0.11.7 limits the Today page to today. Its reminder list shows only reminders due on the current local day in the account timezone, with clock times only; tomorrow and later days no longer appear there.

Version 0.11.6 answers questions in words instead of showing journal cards. Asking how much urine was recorded today, since 7 AM or in any period returns the total and each amount, added up by the server from approved records; unapproved bag photos are mentioned but never counted. Journal lookups accept a local clock window, and journal cards appear only when records, photos or the journal are asked for.

Version 0.11.5 opens the chat on the latest ten turns, with a See earlier messages control that loads older turns in batches without moving the turn being read. A bag photo sent on its own now prepares a catheterization review directly: the amount is read from the photo and the photo time is matched to the scheduled catheterization it follows (up to three hours after the scheduled time), so the check-in stops asking once the review is approved. See [journal and reminders](docs/journal-and-reminders.md).
