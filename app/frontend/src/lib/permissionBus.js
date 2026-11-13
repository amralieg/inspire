// One channel from every failed request to the App-level Permission Required dialog.
// A raise with no subscriber is kept and replayed to the first subscriber, so a grant that fails before the host mounts is not lost.
// A grant list (its GRANT statements, sorted) opens the dialog once per session: a re-check, a poll or a reload that returns the same grants
// merges into the open dialog or stays closed. A new grant opens it. An explicit action (explicit: true) always opens.
const subscribers = new Set();
const shown = new Set();
let pending = null;

// The identity of a grant list is its content, so the same grants in another order, or as a new object, are the same list.
export function grantListKey(permissions) {
  if (!Array.isArray(permissions) || !permissions.length) return '';
  return JSON.stringify(permissions.map((p) => JSON.stringify([...(p?.statements || [])].sort())).sort());
}

export function subscribePermissions(fn) {
  subscribers.add(fn);
  if (pending) {
    const { permissions, extra } = pending;
    pending = null;
    fn(permissions, extra);
  }
  return () => subscribers.delete(fn);
}

export function raisePermissions(permissions, extra = {}, { explicit = false } = {}) {
  if (!Array.isArray(permissions) || !permissions.length) return;
  const key = grantListKey(permissions);
  const seen = shown.has(key);
  shown.add(key);
  if (seen && !explicit) return;
  if (!subscribers.size) {
    pending = { permissions, extra };
    return;
  }
  subscribers.forEach((fn) => fn(permissions, extra));
}
