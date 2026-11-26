// One channel from every failed request to the App-level Permission Required dialog.
// A raise with no subscriber is kept and replayed to the first subscriber, so a grant that fails before the host mounts is not lost.
// A grant list (its GRANT statements, sorted) opens the dialog once per session: a re-check, a poll or a reload that returns the same grants
// merges into the open dialog or stays closed. A new grant opens it. An explicit action (explicit: true) always opens.
// Every GRANT statement the dialog has shown this session: a raise opens the dialog only for a statement it has not shown yet.
// The memory lives in sessionStorage when the browser has it, so a reload or a new page load in the same tab does not reopen a list the
// person already saw. Without storage (tests, private modes that refuse it) it falls back to this module's memory.
const SHOWN_KEY = 'inspire.permissionStatementsShown';
const memory = new Set();
let pending = null;

function storageOrNull() {
  try { return globalThis.sessionStorage || null; } catch { return null; }
}

function isShown(statement) {
  if (memory.has(statement)) return true;
  const storage = storageOrNull();
  if (!storage) return false;
  try {
    const saved = JSON.parse(storage.getItem(SHOWN_KEY) || '[]');
    return Array.isArray(saved) && saved.includes(statement);
  } catch { return false; }
}

function markShown(statements) {
  statements.forEach((s) => memory.add(s));
  const storage = storageOrNull();
  if (!storage) return;
  try {
    const saved = new Set(JSON.parse(storage.getItem(SHOWN_KEY) || '[]'));
    statements.forEach((s) => saved.add(s));
    storage.setItem(SHOWN_KEY, JSON.stringify([...saved]));
  } catch { /* storage refused: the in-module memory still holds */ }
}

// The identity of a grant list is its content, so the same grants in another order, or as a new object, are the same list.
export function grantListKey(permissions) {
  if (!Array.isArray(permissions) || !permissions.length) return '';
  return JSON.stringify(permissions.map((p) => JSON.stringify([...(p?.statements || [])].sort())).sort());
}

// REQ-216, REQ-131: an optional grant (the App reads Delta until an admin runs it) stays in the dialog with its Copy button, labelled optional.
// It never gates a build: the submit does not depend on the dialog being open or closed.
export function grantAsk(p) {
  if (p?.optional) return 'Optional: pages load faster once your admin runs this.';
  return p?.principal ? `For ${p.principal}` : 'For your admin';
}

// REQ-300: Copy carries only the GRANT statements, each ending with a semicolon, across every grantee. A reason or a non-grant step never
// goes into the copy.
// AUTO-4: the folder Share and CLI steps copy on their own (Copy steps), never with the GRANT statements.
export function copyStepsText(permissions) {
  return (permissions || []).flatMap((p) => p?.steps || []).join('\n');
}

export function copyText(permissions) {
  return (permissions || []).flatMap((p) => (p?.statements || []).map((s) => (String(s).endsWith(';') ? s : `${s};`))).join('\n');
}

// RC6-B-10: the missing grant of one catalog is its own statements only, never the statements of the other partial catalogs.
// The shared why and principal of the list stay. A catalog whose statements are not in the list gets none: never every other catalog's (c23).
export function grantOfCatalog(permissions, catalog) {
  const own = new Set(catalog?.partial?.missing || []);
  if (!own.size) return permissions;
  const keep = (permissions || []).map((p) => ({ ...p, statements: (p?.statements || []).filter((s) => own.has(s)) })).filter((p) => p.statements.length);
  return keep;
}

// One host shows the dialog. A host mounted later takes over, so two mounted hosts never stack two dialogs for one raise.
let activeHost = null;
export function subscribePermissions(fn) {
  activeHost = fn;
  if (pending) {
    const { permissions, extra } = pending;
    pending = null;
    fn(permissions, extra);
  }
  return () => { if (activeHost === fn) activeHost = null; };
}

// REQ-239: an optional entry with no GRANT statement is still a grant. It is keyed by its identity (its id, or principal + securable +
// privilege + why), so the once-per-list memory remembers it the same way it remembers a statement.
function entryKey(p) {
  if (p?.id != null && p.id !== '') return `entry:id:${p.id}`;
  return `entry:${JSON.stringify([p?.principal ?? '', p?.securable ?? '', p?.privilege ?? '', p?.why ?? ''])}`;
}

function grantKeys(permissions) {
  return permissions.flatMap((p) => (p?.statements?.length ? p.statements : [entryKey(p)]));
}

export function raisePermissions(permissions, extra = {}, { explicit = false } = {}) {
  if (!Array.isArray(permissions) || !permissions.length) return;
  const keys = grantKeys(permissions);
  const seen = keys.length > 0 && keys.every(isShown);
  markShown(keys);
  if (seen && !explicit) {
    // The same grants again: never reopen. An open dialog for them takes this raise's extras (Try again, Start) through a quiet notice.
    if (activeHost) activeHost(permissions, extra, { quiet: true });
    return;
  }
  if (!activeHost) {
    pending = { permissions, extra };
    return;
  }
  activeHost(permissions, extra);
}
