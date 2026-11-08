# sciapp

Accessible conversational care companion for people with spinal cord injuries.

## Status

Personal care beta at **https://sciapp.eladrave.com** (0.6.0).

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
