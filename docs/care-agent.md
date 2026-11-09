# Conversational care agent

The active `/api/chat` path calls `runCareAgent`. Each turn allows up to six sequential model calls. The model can read account-owned care context, resolve a local time, then prepare or revise one typed review. Native assistant function calls and tool-result messages are passed back to the provider. Responses mode translates these to `function_call` / `function_call_output` items. Chat Completions uses assistant `tool_calls` and `tool` messages.

The model receives `get_care_context`, `resolve_care_time`, `prepare_care_change`, `revise_care_change`, and `commit_care_review`, plus existing health connectivity and memory/resource tools. Core care changes do not use the old text parsers or their keyword intent gates. Those remain for offline controls and compatibility tests. Code execution, arbitrary URLs, shell commands and model-defined tools are not exposed.

## Data and review boundaries

Changes use a discriminated action kind with its own parameter schema. Unknown fields and invalid types fail before a proposal is created. The existing domain layer validates quantities, units, configured medication IDs, timezone names, duplicate medication rows, PRN schedules and inventory arithmetic. The evidence quote must come from the current user message. The model interprets that quote; this check establishes provenance, not semantic proof. The model can still misinterpret a request, so clear reviews and explicit approval remain essential.

Time resolution runs on the server in the saved account timezone. It returns a turn-scoped opaque reference to a UTC instant. Explicit clocks use the supplied local date, or propose today with a visible assumption. `most_recent_schedule` chooses a past scheduled catheter occurrence and labels the match as an assumption. The schedule never proves care occurred. Missing essential facts lead to clarification. No time token is parsed as a volume.

Photo readings are observations, not care events. Visible extracted numbers are checked against photo-sourced proposals. Missing measurements remain unknown. A bag can become a catheterization review when the user's intent and context support completed care; a generic bag reading does not deduct a catheter. Medication bottles are a separate photo type, and photo-based medication stock requires a matching configured medication ID, visible package count and unit. A package-label count is explicitly marked for verification against the actual remaining balance; it is not assumed to prove current consumption or regimen.

An unresolved photo observation may be retained privately for 30 minutes so an answer to a clarification keeps its source. It is excluded from the public state payload. A reviewed photo remains available as context only while that review is pending. Deleting the photo clears the observation and cancels linked pending reviews. Existing approved history is never rewritten by this change.

`revise_care_change` identifies the current review and replaces its complete typed parameters while preserving its original source photo. Context exposes editable parameters and a time reference for the pending review, allowing corrections such as “actually 450, same time.” The old proposal is cancelled. Approval must reference the original pending proposal ID from the start of the user turn, so a model cannot create and commit a new proposal in one turn. Compound confirmations with corrections do not commit. The existing approval button also commits exactly its proposal ID. Optimistic account-state persistence prevents concurrent stale writes.

The backend rejects repeated use of the same approved source photo and duplicate catheterization entries at the same exact instant. Approval is idempotent. This does not detect duplicate re-uploads of the same image under different IDs or clinically equivalent entries at slightly different times.

Assumptions and extraction estimates are displayed with the review, alongside explicit time and timezone. Amount and time can be corrected in chat or via the review buttons. All care and stock changes wait for approval. Logs must not contain credentials or original private messages. Provider failures do not grant new capabilities or enable code execution.

## Validation

Automated tests exercise context/time/proposal loops, medication schedules without legacy input grammar, typed rejection, PRN handling, revisions, exact-review commits, unknown tool rejection, clarification continuity, image/medication inventory separation, and provider-native tool-result conversion. Live tests use isolated synthetic state: the supplied bag image with “This is my 7am,” a conversational amount correction, and the supplied grouped medication schedule. No personal care events are saved by those tests.

## Accessible clarifications and corrections

Clarifications use `ask_care_question` with a question and two to six short answer buttons. The UI explains that users may type or speak any other answer, provides a composer-focus alternative and uses at least 48-pixel answer controls with visible keyboard focus. Questions have stable IDs; earlier answer buttons are disabled and the API rejects stale question-bound responses before recording a chat message. Free-form answers remain unrestricted. Plain model questions receive fallback choices if the model omits the question tool. Spoken replies include the alternative-input hint. `cancel_care_setup` dismisses unresolved clarification context without modifying saved care.

Medication label matching removes photographed strength/form suffixes to identify an existing medication, then verifies the visible strength against the saved dose label. It does not normalize the user's conversational grammar or invent identities. Photo-based inventory counts require a matching medication ID and visible count/unit; remaining-balance assumptions remain reviewable.

`careCorrection` prepares an undo review for an account-owned, reversible care event. Approval keeps the original and a correction record, reverses any tracked stock delta when valid, and restores a superseded supply label from another non-voided delivery or the generic Catheters label. It never invents a numeric stock balance. Preparing a correction does not itself alter the original event.

Answer controls synchronize disabled state after every request, recording and upload transition. Controls rendered while a request is busy must become usable after completion; stale-question controls remain disabled. End-to-end verification must include a second action after an actual saved response, not only the first click from an initial fixture.
