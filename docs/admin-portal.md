# Administration

The `/admin` portal has separate credentials and sessions from Clerk personal care accounts. Username: `admin`. The password is configured outside the public repository. No administrator route provides access to private patient records or private memory text.

## Authentication

The Worker secret `ADMIN_PASSWORD_HASH` contains JSON with a random 16-byte hex `salt`, a 32-byte hex PBKDF2-SHA256 `hash`, and `iterations: 100000`. It contains a verifier, not the plaintext password. Provision this through Cloudflare Worker secrets; never commit it. The current Workers Web Crypto iteration limit is respected. Password comparisons use fixed-size timing-safe hashing. Login uses a generic failure response and IP/global attempt limits. Secrets and passwords do not appear in audit entries.

Successful login sets `__Host-sciapp-admin`, a random 256-bit token in a Secure, HttpOnly, SameSite=Strict cookie. D1 stores its SHA-256 digest, CSRF token, expiry and credential-version fingerprint. Sessions expire after four hours; logout revokes the row. Changing the verifier invalidates existing sessions. Authenticated writes require the same Origin and a session-bound `X-Admin-CSRF` header. Login also requires same Origin. Do not reuse a personal-account session as an administrator session.

## Shared resource workflow

1. Add a draft with title, original HTTPS source URL and supplied excerpt/summary.
2. Edit the draft or copy an existing resource to a new draft.
3. Review source and content, check the publication confirmation, then publish.
4. Mark reviewed again when an administrator reassesses it. The review interval highlights overdue material; it does not automatically withdraw it.
5. Archive obsolete material with an explicit confirmation. It immediately becomes ineligible for semantic hydration, catalogs and keyword fallback.

Administrator review records editorial review, not clinical certification. Published text is immutable: revise by copying into a new draft and archiving the previous version. Source URLs are citations; the portal does not fetch arbitrary URLs, crawl sites, or watch linked videos. Uploaded files are processed as described below. Use material you can share. Original shared excerpts and their review state remain in D1; private memories are never copied into the general collection automatically.

D1 `resource_publication` records draft/published/archived state, reviewer, timestamps and version. Legacy curated summaries remain available but display that no administrator review date is recorded. `admin_audit` records login/logout and resource/settings operations. Entries ending in `_attempt` also cover concurrency conflicts; they do not imply that the requested write succeeded. Mutation responses enforce optimistic version checks.

## Settings and status

- Retrieval threshold: 0.60 to 0.90, applied on subsequent semantic queries.
- Resource review interval: 30 to 730 days, used for due-for-review highlights.
- Read-only personal memory policy: always on for every signed-in account.
- Aggregate indexing totals, pending chunks and chunks with retry history, separated by collection.

Personal memory controls are absent from app Settings. The backend rejects old disable API calls and chat commands. User correction/forget/clear operations remain available to handle inaccurate statements without disabling future memory.

## Deployment and recovery

Apply additive migration `0005_admin.sql` before deploying. `scripts/deploy.mjs` includes it and preserves existing Worker secrets. It accepts `ADMIN_PASSWORD_HASH` from the environment for first configuration or rotation. Application hostnames continue to come from deployment.json; the portal uses relative paths, same-origin APIs and host cookies.

To recover access, replace the verifier through Cloudflare secrets. Do not add a plaintext fallback or bypass authentication. Future hardening priorities include named administrator identities, multi-factor authentication, backup restoration drills, and clinical review of medical resources before broad release.

## File and video resources

Resource type can be a web link, uploaded document/presentation, or video link. Each resource labels its text as a reviewed summary, supplied transcript, or extracted document text.

Administrators can upload one file per editor operation, up to 10 MB. PDF/ODT conversion uses the Workers AI `toMarkdown` binding. DOCX and PPTX extraction reads bounded OOXML text locally using fflate; PPTX slide order and speaker notes are preserved when present. UTF-8 TXT, Markdown, VTT and SRT are decoded directly, preserving supplied transcript timestamps. Legacy DOC/PPT can be stored but need a manually supplied summary or conversion to a supported format. Extraction never interprets all diagrams, tables, images or animations; scans and conversion failures may need manual text. Extraction over 1,500,000 characters is flagged rather than silently truncated. The original stays available while the administrator chooses an excerpt. Draft text is editable and must be reviewed before publication.

Originals live in the private `sciapp-resources` R2 bucket, bound as `RESOURCES`, separately from personal photos. `resource_uploads` stores file metadata/extraction status; `resource_materials` links shared sources to file/video kind and text provenance. Migration `0006_resource_files.sql` creates both tables. JSON editing permits up to 1,500,000 characters of text, with a separately bounded admin request limit. ZIP/XML extraction has entry-count and uncompressed-size limits and rejects external XML declarations. Files are downloaded as attachments with no-store/nosniff headers, never served as inline executable content.

`POST /api/admin/uploads` accepts multipart `file` with normal admin Origin/session/CSRF protection. `GET /api/admin/uploads/:id` downloads an original for an administrator. `DELETE` discards an unreferenced upload. The editor discards unused uploads on Cancel or sign-out. If a browser closes unexpectedly, unreferenced files may remain; there is no automatic retention sweep yet.

`GET /api/resources/files/:id` permits signed-in/preview-session users to download originals only while at least one linked shared resource is published. Draft-only and fully archived originals return 404. The bucket itself has public access disabled. File citations are relative application paths, preserving domain portability. An administrator can copy a resource into a revised draft while retaining its original file reference.

Video URLs support HTTPS links, including YouTube and Vimeo. Add a curated summary or supply a transcript (paste text or upload VTT/SRT). Search indexes the reviewed text and cites the video URL. The app does not download video from page URLs, fetch third-party captions, verify its claims, or claim to have watched its visual content. A link alone does not make video content searchable.

### Automatic speech transcripts

Upload MP3, WAV, M4A, MP4, WebM, OGG or FLAC (within the same 10 MB cap). The original is saved immediately; migration `0007_resource_transcription.sql` provides durable jobs and leases. Workers AI `@cf/openai/whisper-large-v3-turbo` processes the complete supplied file, without arbitrary byte splitting, using voice-activity detection and transcription rather than translation. VTT timestamps are retained in the reviewed source text when returned. Semantic chunks remove caption cue formatting so timestamps do not overwhelm the words used for retrieval. Uploading does not publish or index the transcript.

The admin page polls status and fills an empty editor when ready; the explicit Check / load transcript button can insert text after manual edits. Unattached uploads and job status are listed for recovery after closing the page. Request background work handles quick jobs; the existing minute cron picks up pending/expired leases and retries provider failures up to three attempts. A failed/no-speech/overlong result retains the original and asks for manual text. Review the generated transcript against the recording, especially medical terminology. Long recordings that exceed the upload/provider limits need shorter self-contained media clips; there is no long-video chunking/transcoding service yet.

A video/audio resource may cite its uploaded file without an external URL. For YouTube, Vimeo and other web page links, automatic downloading is not integrated. Supply a usable media file (or an authorized download through a future connector) to generate missing captions. The backend processes speech, not visual demonstrations or slide imagery. Usage is billed through the connected Cloudflare Workers AI account; no extra model key was added.

## Figures from PDFs (0.11.11)

Text extraction does not carry images, so figures are captured separately. After a PDF upload, the admin page loads pdf.js (`/pdf.min.mjs` and its worker, served by the app), reads each page's text, and treats a line that starts with `Figure N`, `Fig. N` or `Table N` followed by a separator or a title as a caption. A sentence that merely starts with a reference, such as "Figure 7 shows ...", is ignored. One figure is kept per label; a caption with a separator wins over a weaker match. Each captioned page is rendered to a JPEG about 1,400 pixels wide (at most 1.5 MB) and stored with its label, caption, page number and size in `resource_figures` and the private `RESOURCES` bucket under `figures/`. Up to 400 figures are kept per upload. Running the finder again replaces the earlier figures. The Find figures in this PDF button runs it for a pending upload or a copied draft by downloading the original.

`GET /api/resources/figures/:id` serves a figure to app users only while a resource that uses the upload is published; `GET /api/admin/figures/:id` serves it to the administrator. Discarding an unused upload deletes its figures.

In chat, `figuresForReply` runs when an answer has shared sources and is not a care review. It scores the figures of the retrieved documents: named in the answer or question, caption words shared with the question, or referred to by a retrieved passage. At most two are attached, never two images of the same page. The app shows the page image with its caption, source title and page number, reserves its space before it loads, and fetches each image once.

## Nothing to do by hand for documents (0.11.14)

Choosing a file, or Use this upload on an earlier upload, reads the text and finds the figures without further action. If the stored upload has no text (for example a book uploaded before the 1,500,000 character limit), the page asks the server to read the saved original again. The text box is collapsed under a line stating how many characters were read; open it only to review or edit. The Check if the transcript is ready button and the What the text below is selector are shown only for audio and video, where a person may supply a summary instead of the AI transcript.
