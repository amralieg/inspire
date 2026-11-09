export const WIZARD_DRAFT_PREFIX = 'inspire_wizard_draft:';
export const WIZARD_DRAFT_VERSION = 1;
export const DRAFT_BACK_NOTE = 'Your picks from before the page reloaded are back.';
export const DRAFT_START_OVER = 'Start over';

function storageOf(storage) {
  if (storage !== undefined) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

const workspaceOf = (host) => String(host || (typeof window !== 'undefined' ? window.location?.host : '') || '').trim().toLowerCase().replace(/\/+$/, '');

export function wizardDraftKey({ host = '', inspireDatabase = '', sessionId = '', useCaseId = '' } = {}) {
  const id = String(useCaseId || '').trim();
  if (!id) return '';
  return `${WIZARD_DRAFT_PREFIX}${JSON.stringify([workspaceOf(host), String(inspireDatabase || '').toLowerCase(), String(sessionId ?? ''), id])}`;
}

export const START_DRAFT_PREFIX = 'inspire_start_draft:';
export const START_DRAFT_STAMP = 'start:1';
export const START_DRAFT_STEP = 'launch';

export function startDraftKey({ host = '' } = {}) {
  const workspace = workspaceOf(host);
  return workspace ? `${START_DRAFT_PREFIX}${JSON.stringify([workspace])}` : '';
}

function hashOf(raw) {
  let h = 5381;
  for (let i = 0; i < raw.length; i += 1) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function draftStampOf(useCase, latest) {
  return hashOf(JSON.stringify([useCase || null, latest ? [latest.spec_version ?? null, latest.created_at ?? null, latest.status ?? null] : null]));
}

export function readWizardDraft(key, stamp, storage) {
  const store = storageOf(storage);
  if (!key || !store) return null;
  let raw = null;
  let saved = null;
  try {
    raw = store.getItem(key);
    saved = JSON.parse(raw || 'null');
  } catch {
    saved = null;
  }
  const fits = saved && typeof saved === 'object' && saved.version === WIZARD_DRAFT_VERSION && saved.stamp === stamp && saved.spec && typeof saved.spec === 'object' && typeof saved.step === 'string';
  if (fits) return { spec: saved.spec, step: saved.step, visited: Array.isArray(saved.visited) ? saved.visited.map(String) : [] };
  if (raw) clearWizardDraft(key, store);
  return null;
}

export function writeWizardDraft(key, { stamp, spec, step, visited = [] }, storage) {
  const store = storageOf(storage);
  if (!key || !store) return false;
  try {
    store.setItem(key, JSON.stringify({ version: WIZARD_DRAFT_VERSION, stamp, spec, step, visited }));
    return true;
  } catch {
    return false;
  }
}

export function clearWizardDraft(key, storage) {
  const store = storageOf(storage);
  if (!key || !store) return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
