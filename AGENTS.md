# SCIapp implementation requirements

This product is for people who may have limited use of their hands. Minimize required taps, typing and repeated questions in every feature.

- Group related care actions, especially medications sharing a scheduled time. Offer short contextual choices such as Took them all, Took only some and Not yet.
- Support the same workflow through ordinary voice/text, selectable answers and keyboard-accessible controls. Understand medicine names, numbered choices and all-except phrasing through the AI tools.
- Ask one essential question at a time. Reuse supplied facts and times. If the user already supplied a time or selection, proceed to the concrete review instead of asking again.
- Prepare one review for a medication group. Approval must be explicit before recording care or changing stock. Validate the entire group before applying any writes; retries must be idempotent.
- Never mark an unselected medication taken. Distinguish not taken yet, unconfirmed and actually taken. Missing records never establish adherence or clinical decisions.
- Use large controls, clear contrast, visible focus and useful screen-reader labels. Never require clicking a specific button when speaking an equivalent answer is possible.
- Camera capture timestamps are untrusted photo metadata, separate from upload time. Label missing-timezone assumptions. An explicit user time takes priority, and every clinical record still requires review.
- Test with synthetic data in the isolated test account and Remote Browser. Keep all real personal health data and credentials out of Git. Push every released version.

- Dismissing a reminder affects only its selected occurrence. Never infer taken, skipped or completed care, change stock, or disable future reminders from dismissal.
