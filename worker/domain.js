export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export function message(role, content, extra = {}) { return { id: uid(), role, content, createdAt: now(), ...extra }; }
export function initialState() {
  return {
    profile: { name: 'You' },
    inventory: [{ id: 'catheter', name: 'Example catheters', count: 60, unit: 'catheters' }, { id: 'medication', name: 'Example medication', count: 30, unit: 'tablets' }],
    events: [], caregivers: [], settings: { muted: true, handsFree: false, voicePauseMs: 5000, textScale: 1, catheterIntervalHours: 4, timezone: 'America/New_York' },
    messages: [message('assistant', 'Welcome. This is your private SCI care preview, with example supplies and medication. What would you like to try? Please use sample information while we test.', { options: ['Log catheterization', 'Add supplies', 'Record medication', 'Invite a caregiver'] })],
    draft: null, photos: [], proposals: [], reminders: [],
  };
}
export class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const string = (v, name, max = 300) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new AppError(`Please provide a valid ${name}.`); return v.trim(); };
const number = (v, name, min, max) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new AppError(`Please provide ${name} between ${min} and ${max}.`); return n; };
export function proposal(state, kind, params) {
  let title, details;
  if (kind === 'catheterization') {
    params = { volume: params.volume == null ? null : number(params.volume, 'volume in mL', 0, 3000), photoId: params.photoId || null, time: params.time || now() };
    if (!Number.isFinite(Date.parse(params.time))) throw new AppError('Please provide a valid time.');
    title = 'Record catheterization'; details = [params.volume == null ? 'Volume not recorded' : `${params.volume} mL`, 'Use one new catheter', 'Deduct 1 catheter from your supplies'];
  } else if (kind === 'supplies') {
    params = { name: string(params.name || 'Catheters', 'product name'), boxes: number(params.boxes, 'number of boxes', 1, 1000), perBox: number(params.perBox, 'units per box', 1, 1000), photoId: params.photoId || null };
    if (!Number.isInteger(params.boxes) || !Number.isInteger(params.perBox)) throw new AppError('Box and unit counts must be whole numbers.');
    title = 'Add supply delivery'; details = [params.name, `${params.boxes} boxes × ${params.perBox} each`, `Add ${params.boxes * params.perBox} catheters`];
  } else if (kind === 'medication') {
    params = { quantity: number(params.quantity ?? 1, 'tablets taken', 0.25, 20), name: 'Example medication' };
    title = 'Record example medication'; details = [`${params.quantity} tablet(s) of Example medication`, 'Record as taken now', `Deduct ${params.quantity} tablet(s) from supplies`, 'Preview medication only; this is not a prescribed regimen'];
  } else if (kind === 'bag') {
    params = { volume: number(params.volume, 'volume in mL', 0, 3000), photoId: params.photoId || null };
    title = 'Save bag reading'; details = [`${params.volume} mL currently in bag`, 'Visual estimate checked by you', 'No catheter deducted; this is not cumulative urine output'];
  } else if (kind === 'vitals') {
    params = { systolic: params.systolic == null ? null : number(params.systolic, 'systolic pressure', 30, 300), diastolic: params.diastolic == null ? null : number(params.diastolic, 'diastolic pressure', 20, 250), heartRate: params.heartRate == null ? null : number(params.heartRate, 'heart rate', 20, 250) };
    if ((params.systolic == null) !== (params.diastolic == null)) throw new AppError('Please provide both blood pressure numbers.');
    if (params.systolic == null && params.heartRate == null) throw new AppError('Please provide a blood pressure or heart-rate reading.');
    title = 'Save your reading'; details = [params.systolic == null ? null : `Blood pressure: ${params.systolic}/${params.diastolic} mmHg`, params.heartRate == null ? null : `Heart rate: ${params.heartRate} bpm`, 'Source: entered by you'].filter(Boolean);
  } else if (kind === 'settings') {
    const allowed = ['muted', 'handsFree', 'voicePauseMs', 'textScale', 'quietUntil', 'catheterIntervalHours', 'name'];
    params = Object.fromEntries(Object.entries(params).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(params).length) throw new AppError('Which setting would you like to change?');
    if ('muted' in params && typeof params.muted !== 'boolean') throw new AppError('Mute must be on or off.');
    if ('handsFree' in params && typeof params.handsFree !== 'boolean') throw new AppError('Hands-free must be on or off.');
    if ('voicePauseMs' in params) params.voicePauseMs = number(params.voicePauseMs, 'pause in milliseconds', 2000, 15000);
    if ('textScale' in params) params.textScale = number(params.textScale, 'text size', 1, 1.5);
    if ('catheterIntervalHours' in params) params.catheterIntervalHours = number(params.catheterIntervalHours, 'hours between reminders', 1, 24);
    if ('quietUntil' in params && params.quietUntil !== null && (!Number.isFinite(Date.parse(params.quietUntil)) || Date.parse(params.quietUntil) <= Date.now())) throw new AppError('Quiet time must end in the future.');
    if ('name' in params) params.name = string(params.name, 'name', 80);
    title = 'Update your preferences'; details = Object.entries(params).map(([k, v]) => ({ muted: `Spoken replies ${v ? 'off' : 'on'}`, handsFree: `Hands-free browser voice ${v ? 'on' : 'off'} while this page is open`, voicePauseMs: `Wait ${Number(v)/1000} seconds after speech`, textScale: `Text size ${Math.round(Number(v) * 100)}%`, catheterIntervalHours: `Catheterization interval: ${v} hours`, quietUntil: v ? `Quiet until ${v}` : 'End timed quiet mode', name: `Call you ${v}` })[k]);
  } else if (kind === 'caregiver') {
    params = { email: string(params.email, 'email address', 254), role: ['follow', 'record'].includes(params.role) ? params.role : 'follow' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.email)) throw new AppError('Please check the email address.');
    title = 'Save caregiver invitation draft'; details = [params.email, params.role === 'follow' ? 'Proposed access: tasks and history, view only' : 'Proposed access: tasks, history, and care logging', 'No photos, medical documents, or private chat access', 'Draft only. No invitation will be sent or access granted in this preview.'];
  } else throw new AppError('That action is not supported yet.');
  // An approval must always name a specific, current action.
  for (const p of state.proposals) if (p.status === 'pending') { p.status = 'cancelled'; for (const m of state.messages) if (m.proposal?.id === p.id) m.proposal.status = 'cancelled'; }
  const p = { id: uid(), kind, title, details, params, status: 'pending', createdAt: now(), expiresAt: new Date(Date.now() + 30 * 60000).toISOString() };
  state.proposals.push(p); state.draft = null;
  return message('assistant', 'Please review this before I save it.', { proposal: publicProposal(p), options: [] });
}
export function publicProposal(p) { const { params, ...publicFields } = p; return { ...publicFields, ...(p.kind === 'settings' ? { changedSettings: Object.keys(params) } : {}) }; }
export function finishProposal(state, id, decision) {
  const p = state.proposals.find(p => p.id === id);
  if (!p) throw new AppError('This action was not found.', 404);
  if (p.status !== 'pending') return message('assistant', p.status === 'approved' ? 'This action was already saved. Nothing was counted twice.' : 'This action was cancelled. Nothing was changed.');
  if (Date.parse(p.expiresAt) <= Date.now()) throw new AppError('This approval has expired. Please ask again.', 409);
  if (!['approve', 'cancel'].includes(decision)) throw new AppError('Choose approve or cancel.');
  if (decision === 'cancel') { p.status = 'cancelled'; syncProposal(state, p); return message('assistant', 'Cancelled. Your care records and supplies are unchanged.'); }
  const data = p.params;
  const event = { id: uid(), kind: p.kind, title: p.title, detail: p.details.join(' · '), createdAt: now(), occurredAt: data.time || now(), actor: state.profile.name, proposalId: p.id, delta: null, data: { ...data } };
  if (p.kind === 'catheterization' || p.kind === 'supplies' || p.kind === 'medication') {
    const item = state.inventory.find(i => i.id === (p.kind === 'medication' ? 'medication' : 'catheter'));
    const delta = p.kind === 'supplies' ? data.boxes * data.perBox : p.kind === 'medication' ? -data.quantity : -1;
    if (item.count + delta < 0) throw new AppError(`There are not enough ${item.unit} in your inventory. Correct your stock first.`, 409);
    item.count += delta; if (p.kind === 'supplies') item.name = data.name;
    event.delta = { itemId: item.id, quantity: delta };
  }
  if (p.kind === 'settings') for (const [key, value] of Object.entries(data)) { if (key === 'name') state.profile.name = value; else state.settings[key] = value; }
  if (p.kind === 'caregiver') state.caregivers.push({ id: uid(), ...data, status: 'draft', createdAt: now() });
  state.events.unshift(event); p.status = 'approved'; syncProposal(state, p);
  const suffix = event.delta ? ` You have ${state.inventory.find(i => i.id === event.delta.itemId).count} ${state.inventory.find(i => i.id === event.delta.itemId).unit} remaining.` : '';
  return message('assistant', (p.kind === 'caregiver' ? 'Invitation draft saved. It has not been sent, and no access has been granted.' : 'Saved.') + suffix, { options: ['What is next?', 'Show my supplies'] });
}
function syncProposal(state, p) { for (const m of state.messages) if (m.proposal?.id === p.id) m.proposal.status = p.status; }
export function undoEvent(state, id) {
  const event = state.events.find(e => e.id === id);
  if (!event) throw new AppError('Record not found.', 404);
  if (event.voided) return message('assistant', 'This record has already been undone.');
  if (!['catheterization', 'supplies', 'medication', 'vitals', 'bag'].includes(event.kind)) throw new AppError('Change this setting or invitation through the conversation instead.');
  if (event.delta) {
    const item = state.inventory.find(i => i.id === event.delta.itemId);
    if (item.count - event.delta.quantity < 0) throw new AppError('This delivery cannot be undone because some of its stock has been used. Correct the inventory through a new entry.', 409);
    item.count -= event.delta.quantity;
  }
  event.voided = true; event.voidedAt = now();
  state.events.unshift({ id: uid(), kind: 'correction', title: 'Record undone', detail: `Reversed: ${event.title}`, createdAt: now(), actor: state.profile.name, targetId: id });
  return message('assistant', 'Undone. I kept the original entry and correction in your history, and restored any supplies used.');
}
export function view(state) {
  const { draft, proposals, ...visible } = state;
  return visible;
}
