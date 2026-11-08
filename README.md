# sciapp

Accessible conversational care companion for people with spinal cord injuries.

## Status

Working mobile-friendly web proof of concept, deployed at **https://sciapp.elad-rave-scm.workers.dev**.

This is a synthetic-data preview. Do not use it for real medical decisions, emergency monitoring, or real patient records.

## Try it

Open the preview and choose **Start private preview**, or use Clerk sign-in. Each preview gets a separate seven-day cookie session and isolated records.

- Type “I catheterized 350 mL”, review, and approve. Stock decreases only after approval.
- Photograph a sample catheter-box label, confirm units per box and box count, then approve the delivery.
- Record example medication use, blood pressure, and heart rate.
- Ask for a shoulder-resource overview or information about SCI-specific UTI symptoms; answers link to the starter source collection.
- Say/type “Make text larger”, “Mute”, “Wait 10 seconds”, or “Turn hands-free on”.
- Use **Talk** to record and transcribe a voice draft. Optional hands-free mode uses browser speech recognition while the page is open. Actual support depends on the browser and microphone permission.
- Review inventory/history and undo mistaken entries. Caregiver invitations are explicitly drafts; this preview does not send them or grant access.

Sound starts off. The sound button immediately stops spoken replies; it is separate from microphone input. Quiet replies do not imply that the microphone is off.

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

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` privately, plus `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` for first setup. Run:

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
