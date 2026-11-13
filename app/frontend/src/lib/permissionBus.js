// One channel from every failed request to the App-level Permission Required dialog.
// A raise with no subscriber is kept and replayed to the first subscriber, so a grant that fails before the host mounts is not lost.
// Identical grant lists merge their extras (for example Try again) into the open dialog instead of opening a second one.
const subscribers = new Set();
let pending = null;

export function subscribePermissions(fn) {
  subscribers.add(fn);
  if (pending) {
    const { permissions, extra } = pending;
    pending = null;
    fn(permissions, extra);
  }
  return () => subscribers.delete(fn);
}

export function raisePermissions(permissions, extra = {}) {
  if (!Array.isArray(permissions) || !permissions.length) return;
  if (!subscribers.size) {
    pending = { permissions, extra };
    return;
  }
  subscribers.forEach((fn) => fn(permissions, extra));
}
