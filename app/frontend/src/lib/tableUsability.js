// REQ-180 (fail closed): a table whose type the backend could not read is shown as not usable, with its plain reason, and is
// never picked. The backend says so with usable:false and unusable_reason on a table row, and with an unusable list on swaps.

export const UNUSABLE_TYPE_FALLBACK = "Inspire could not read this table's type, so it cannot be used here. Pick another table you can read.";

// A type check the workspace could not answer twice (the backend's type_check: 'busy'): not a verdict on the table. It cannot be
// picked until it is checked again, and it is never shown as not usable.
export const TYPE_CHECK_BUSY_FALLBACK = "Inspire could not check this table's type right now. Try again.";

/** True when a row's type check is busy: the table is listed, and Try again checks it. */
export function typeCheckBusyOf(row) {
  return Boolean(row && row.type_check === 'busy');
}

/** The reason a listed table cannot be picked right now, or '' when it can be. A busy check and usable:false both block a pick. */
export function unusableReasonOf(row) {
  if (typeCheckBusyOf(row)) return String(row.unusable_reason || TYPE_CHECK_BUSY_FALLBACK);
  // SEC-01 (W4): a table the person or Inspire cannot read is shown with who must ask for access, not hidden.
  if (row && row.pickable === false) {
    return row.request === 'inspire' ? 'Inspire cannot read this table yet. Request access for Inspire.' : 'You cannot read this table. Request access.';
  }
  if (!row || row.usable !== false) return '';
  return String(row.unusable_reason || UNUSABLE_TYPE_FALLBACK);
}

/** The one plain line for the tables a schema listing left out past its cap, or '' when none were left out. */
export function leftOutLine(left) {
  const count = Number(left?.count) || 0;
  if (!count) return '';
  const schema = String(left.schema || 'this schema');
  return `${count} ${count === 1 ? 'table' : 'tables'} in ${schema} ${count === 1 ? 'was' : 'were'} left out of this list: Inspire lists at most 1000 tables from one schema.`;
}

/** The backend's swap candidates whose type check is busy, as swap rows that cannot be chosen right now. */
export function busySwapRows(list) {
  return (list || []).map((u) => ({ table: u.table, type_check: 'busy', unusable_reason: u.reason || TYPE_CHECK_BUSY_FALLBACK, matched: 0, total: 0, copy: false }));
}

/** The backend's unusable swap candidates as swap rows that cannot be chosen. */
export function unusableSwapRows(list) {
  return (list || []).map((u) => ({ table: u.table, usable: false, unusable_reason: u.reason || UNUSABLE_TYPE_FALLBACK, matched: 0, total: 0, copy: false }));
}
