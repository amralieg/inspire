import { favoriteKeyOf, trackingIdOf } from './useCaseFields.js';

export const ARCHIVE_STORAGE_KEY = 'inspire_archived_use_cases_v1';
export const ARCHIVE_VIEWS = [
  { id: 'active', label: 'Active' },
  { id: 'archived', label: 'Archived' },
];

export function archiveKeyOf(sessionId, uc) {
  const sid = String(sessionId ?? '').trim();
  const id = trackingIdOf(uc) || favoriteKeyOf(uc);
  return sid && id ? `${sid}|${id}` : '';
}

export function loadArchiveMap(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(ARCHIVE_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function toggledArchive(map, key, storage = globalThis.localStorage) {
  if (!key) return map;
  const next = { ...map };
  if (next[key]) delete next[key];
  else next[key] = true;
  try {
    storage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(next));
  } catch { /* quota / private mode */ }
  return next;
}

export function inArchiveView(view, archived) {
  return view === 'archived' ? Boolean(archived) : !archived;
}
