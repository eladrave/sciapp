# Model-first conversation execution

The configured conversation model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast` on Cloudflare Workers AI. Every server chat message first reaches the model with typed native tool definitions, the current care state, current pending review, recent conversation, and retrieved context. Photo messages additionally provide the separately analyzed, untrusted image evidence. Care parsers no longer run ahead of a successful model request. Direct approval buttons, microphone controls and OS notification-permission buttons remain explicit UI actions.

The model selects among `set_catheter_schedule`, `record_catheterization`, `set_medication_reminders`, `record_medication`, `record_vitals`, `change_preferences`, `manage_care_plan`, `get_care_overview`, `confirm_pending_action`, `memory_or_resources` and `use_photo`. A rejected tool can be returned to the model once as validation feedback, allowing it to correct intent or ask for missing details before the app responds. Multiple tool calls are rejected in favor of one change at a time. Unsupported or malformed calls cannot perform arbitrary operations. The server owns account identity; the model cannot choose an account. Model text cannot itself write care records.

Tools validate parameters against domain rules and, for schedules, the user-supplied times. Plan/list workflows parse the original utterance rather than a model rewrite of medication labels or quantities. Workflow parsing uses a working copy and rejects unexpected care actions. Approval by chat additionally requires the explicit conversational confirmation/cancellation signal and the current pending action. Care changes use review cards and existing idempotent approval/storage rules.

A failed model call uses labeled deterministic offline controls; it does not silently pretend the model processed the message. The existing chat/AI daily rate limits both permit up to 150 turns per IP per day. Native tool responses support Cloudflare flat and OpenAI-style nested function envelopes. Conversation model metadata is available on `/api/health`.

## Daily catheterization reminders

A routine such as “I catheterize at 8am, noon and 8pm” prepares `catheterSchedule`, not a completed-use event. Times are stored as unique HH:mm values using the account's IANA timezone. Unmarked bare hours are clarified. Clock tokens cannot be used as mL. The backend will not accept model-invented times.

Approval saves `catheterScheduleMode: daily`, the explicit times, schedule ID/update time, and enabled catheter/account notification flags. It creates a schedule audit event, never a catheterization-use event or stock decrement. Registered devices use those occurrences; a device that lacks notification permission/subscription still needs its OS permission step. The app never claims a device is registered based on a chat instruction.

Daily task generation uses each calendar date and the existing timezone/DST conversion, including overnight reminders. Completion can satisfy its nearest occurrence without shifting later daily times. Interval reminders remain an alternate mode that resets from recorded care, rather than being inferred from uneven daily slots. Reminder dispatch uses stable occurrence IDs for deduplication and the existing generic encrypted push payloads.

Older signed-in states receive scheduling schema version 1. If the current unapproved catheterization review was generated from a prior explicit schedule message, it is cancelled and a corrected daily schedule review is appended. No historical completed care entry is reversed automatically. No schedule is activated until its corrected review is approved.

Current grounding understands explicit numeric AM/PM or HH:mm times and some common spoken forms. Complex recurring rules and ambiguous wording still require clarification rather than guessing. The model-first design improves intent understanding while these checks keep proposed actions reviewable.
