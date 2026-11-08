# POC acceptance criteria

## First usable checkpoint

On an Android phone browser, a tester can type, speak, or select a suggested response to log a catheterization. The app proposes a specific action, saves it after approval, deducts one catheter, and retains the record across refresh. Repeating the approval does not deduct again. A correction is recorded with a visible result.

This is the first end-to-end delivery target, not a claim of implemented behavior.

## Next interface scenarios

1. Voice: grant microphone permission, speak with pauses, inspect/correct transcript, approve via voice or buttons.
2. Audio: stop current speech, mute output while preserving text, switch input modes without losing the draft.
3. Photos: capture/upload a synthetic product label, inspect extracted model and units, supply box count, approve receipt, correct mistakes.
4. Medication: record selected scheduled medications with exceptions; verify correct dose units and inventory consumption.
5. Settings: conversationally change quiet hours/text size/reminder preferences and verify persistence.
6. Caregiver: create a scoped invitation, accept with a separate test account, verify allowed history and denied content, revoke and verify subsequent requests fail.
7. Resources: answer a question from reviewed sources with a working source link; state when evidence is missing.
8. Accessibility: keyboard and screen-reader navigation, large text, button names, no color-only states, and no mandatory timed responses.
9. Failure recovery: denied camera/mic, failed upload/inference, failed save, expired approval, refresh, and duplicated submission have clear recoverable outcomes.

## Scope and honesty

Use synthetic identities and records until authentication, authorization, data handling, and provider configuration are implemented and tested. Label demo fixtures and experimental visual estimates. Never show mock actions as delivered invitations, imported medical records, or successfully saved cloud records.

Defer Health Connect, Bluetooth, native reminder guarantees, live EHR connections, clinical alerting, and production WhatsApp integration until their own acceptance checkpoints.

## Decisions not required to begin

Final brand, custom domain, commercial pricing, additional identity providers, and WhatsApp onboarding are not blockers for the initial local interface. Use a temporary deployment address when authorized. Google OAuth configuration is required before real Google login can be completed.
