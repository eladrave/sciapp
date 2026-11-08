// Shared by the browser and Worker. Short replies apply only to a concrete pending review.
export function normalizeControl(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
    .replace(/[.!?,;:“”"()]/g, ' ').replace(/\s+/g, ' ').trim();
}
const approvals = new Set([
  'approve', 'approved', 'approve it', 'approve that', 'approve this', 'i approve', 'i approve it', 'i approve that',
  'yes', 'yes please', 'yes approve', 'yes approved', 'yes i approve', 'yes that is correct', "yes that's correct",
  'yeah', 'yep', 'yup', 'okay', 'ok', 'okay please', 'ok please',
  'confirm', 'confirmed', 'confirm it', 'save', 'save it', 'save that', 'save this',
  'looks good', 'that looks good', 'sounds good', 'correct', "that's correct", 'that is correct',
  'that works', "that's fine", 'that is fine', "that's good", 'fine', 'sure', 'sure go ahead',
  'go ahead', 'go ahead and save', 'go ahead and save it', 'yes go ahead', 'okay go ahead', 'ok go ahead',
  'yes save it', 'yes please save it', 'you can save it', 'yes looks good', 'yes sounds good',
  'do it', "that's right", 'that is right', 'all good',
]);
const cancellations = new Set([
  'no', 'nope', 'no thanks', 'no thank you', 'cancel', 'cancel it', 'cancel that', 'cancel this',
  'cancelled', 'canceled', 'no cancel', 'no cancel it', 'no cancel that',
  'reject', 'rejected', 'not approved', 'do not approve', "don't approve", 'do not save', "don't save",
  'do not save it', "don't save it", 'never mind', 'nevermind',
]);
const holds = new Set(['wait', 'wait a moment', 'hold on', 'not yet', 'wait please', 'stop', 'one moment']);
export function conversationControl(text) {
  const normalized = normalizeControl(text);
  const polite = normalized.replace(/^please /, '').replace(/ please$/, '');
  if (cancellations.has(polite)) return 'cancel';
  if (holds.has(polite)) return 'hold';
  if (approvals.has(polite)) return 'approve';
  // Mixed, negated, or uncertain confirmation language needs clarification, never an LLM-generated repeat action.
  if (/\b(approv\w*|confirm\w*|save|yes|yeah|yep|okay|ok)\b/.test(normalized)
      && /\b(no|not|never|don't|dont|do not|but|except|maybe|unsure|wait|instead|whether|if|why|how)\b/.test(normalized)) return 'clarify';
  return null;
}
export function confirmationDelay(text, { pending = false, final = false, draft = '', normal = 5000 } = {}) {
  const control = conversationControl(text);
  // Only complete, final short answers get a faster turn. Longer speech retains the configured pause.
  return pending && final && !draft.trim() && ['approve', 'cancel'].includes(control) ? Math.min(normal, 1200) : normal;
}
