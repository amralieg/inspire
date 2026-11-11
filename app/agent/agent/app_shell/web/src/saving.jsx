import { useSyncExternalStore } from 'react';

export const SLOW_MS = 10000;
export const SAVING = 'Saving…';
export const STILL_SAVING = 'Still saving…';
const IDLE = { key: '', rows: [], slow: false };
let now = IDLE;
const heard = new Set();
const tell = (next) => { now = next; heard.forEach((f) => f()); };
const listen = (f) => { heard.add(f); return () => heard.delete(f); };
const read = () => now;

export async function runWrite(key, fn, { rows = [], inside = false } = {}) {
  if (now.key) return inside ? fn() : undefined;
  const mine = String(key);
  tell({ key: mine, rows: (rows || []).map(String), slow: false });
  const timer = setTimeout(() => { if (now.key === mine) tell({ ...now, slow: true }); }, SLOW_MS);
  try {
    return await fn();
  } finally {
    clearTimeout(timer);
    if (now.key === mine) tell(IDLE);
  }
}

export function useWrite() {
  const state = useSyncExternalStore(listen, read, read);
  return {
    busy: !!state.key, slow: state.slow,
    mine: (key) => !!state.key && state.key === String(key),
    holds: (key) => !!state.key && key != null && state.rows.includes(String(key)),
  };
}

export const savingLabel = (slow) => (slow ? STILL_SAVING : SAVING);

export function Saving({ slow }) {
  return <><span className="saving-ring" aria-hidden="true" />{savingLabel(slow)}</>;
}

export const missingWhy = (parts) => {
  const list = parts.filter(Boolean);
  return list.length ? `Add ${list.join(' and ')} to save.` : '';
};

export function SaveButton({ write, disabled, why = '', children, className = 'btn', type = 'button', ...rest }) {
  const gate = useWrite();
  const mine = gate.mine(write);
  const off = !!disabled || gate.busy;
  const reason = disabled && !gate.busy ? why : '';
  return (
    <>
      <button type={type} className={className} {...rest} disabled={off} title={reason || undefined} aria-busy={mine || undefined} data-saving={mine ? '' : undefined}>
        {mine ? <Saving slow={gate.slow} /> : children}
      </button>
      {reason && <small className="save-why" data-save-missing>{reason}</small>}
    </>
  );
}
