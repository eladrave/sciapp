# Product requirements

## Audience and accessibility

People with paraplegia and tetraplegia, plus invited caregivers. Configure interaction by functional ability and preference rather than injury label. Support large controls, adjustable text and contrast, screen readers, switch input, long speech pauses, assisted camera capture, and no required precise gestures. The AI conversation is the primary voice experience.

## Interaction contract

- Chat-first responsive web UI, followed by Android.
- Text, speech, photos, and contextual buttons are interchangeable.
- Ask one question at a time; keep drafts across interruptions.
- Every application setting has a conversational equivalent.
- Show listening, processing, pending approval, saved, failed, and pending synchronization states.
- Important mutations require a specific reviewable proposal and approval.
- Support cancel, back, corrections, and undo where valid; preserve audit history.
- Capture evidence separately from confirmed records.
- A persistent Today view exposes upcoming and completed tasks without searching chat history.
- Emergency profile and approved care instructions remain directly accessible.

## Audio and privacy

Separate speech output from microphone input. Quiet replies allow voice input with text-only output. Silent mode disables output and leaves the microphone off until activated. Support immediate stop, timed mute, quiet hours, private notification text, and headphones-only output. Urgent-alert preferences are explicit. Do not promise browser background monitoring or guaranteed delivery.

## Care and supplies

- Blood pressure and heart rate: source, measurement time, import time, posture/symptoms when provided, and duplicate detection.
- Intermittent catheterization: user-defined schedule, actual completion time, optional volume, and one catheter deducted per confirmed new-catheter use.
- A scheduled reminder is never evidence of completion.
- Indwelling drainage: distinguish bag contents from newly produced urine; track emptying before calculating output.
- Medication name, strength, dose quantity/unit, timing, as-needed use, actual administration, exceptions, remaining stock, and replenishment.
- Delivery photos: identify product/model and units per box, ask box count if uncertain, approve receipt, detect duplicate imports.
- Bag photos: save original; experimental volume reading for validated bag models; require confirmation and allow manual override.
- Appearance photos are history, not a UTI diagnostic test.
- Inventory includes receipts, confirmed consumption, waste, corrections, and reversals; forecasts are labeled estimates.

## Caregivers and identity

Google sign-in first; additional providers and passkeys fit the account model. One account may receive care and assist multiple people. Use explicit authenticated account linking, never automatic email-only merges.

Invitations collect recipient, permission scope, history start date, notification rules, and optional expiration. Recipient must authenticate and accept. Defaults do not expose private chats, photos, or medical documents. Patients can revoke access. Each care entry identifies actor and time. Invited caregivers cannot grant themselves broader access.

Settings, invitations, sharing changes, and disconnection can be initiated through chat; provider authentication and OS consent use trusted screens.

## Resources and medical records

Curated SCI knowledge and personal clinician documents support cited answers. Distinguish general education from personal instructions, retain source/version, and acknowledge missing evidence. Shoulder resources must distinguish independent and assisted exercise. UTI support organizes symptoms, labs, care instructions, and treatment history without diagnosing from urine appearance or prescribing treatment.

Later provider connections use patient-authorized SMART on FHIR, initially read-only. Imported medications require reconciliation before changing the active schedule. Android Health Connect and selected Bluetooth devices follow the web interface milestone.

## Later modules

Bowel program, skin inspection/body map and pressure-relief routines, pain/spasticity, rehabilitation, equipment maintenance, travel packing, and appointment summaries.

## WhatsApp

Future channel for text, photos, and asynchronous voice notes. Verify platform access and documented creator-only restriction before implementation. Do not assume interactive buttons, group access, live audio, or universal availability. Securely link channel identities to app accounts. Record consent for channel sharing.
