import { useEffect, useRef, useState } from 'react';
import ModalDialog from './ModalDialog';
import { runBulk } from '../lib/valueBulk.js';
import { totalText } from '../lib/valueWizard.js';

const btn = 'rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-50';
const LABELS = { waiting: 'Waiting', working: 'Working', stopped: 'Stopped' };

// REQ-441: the bar above the cards: Select all (the cards shown) and "Calculate value for N".
export function ValueBulkBar({ shown, selected, onSelectAll, onCalculate }) {
  const all = shown > 0 && selected === shown;
  return (
    <div data-value-bulk-bar="" className="mb-2 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
      <label className="inline-flex items-center gap-2">
        <input type="checkbox" checked={all} onChange={(e) => onSelectAll(e.target.checked)} />
        <span>Select all</span>
      </label>
      {selected >= 1 && (
        <button type="button" onClick={onCalculate} className="rounded-md bg-db-red-solid hover:bg-db-red-solid-hover px-3 py-1.5 text-xs font-semibold text-white">
          Calculate value for {selected}
        </button>
      )}
    </div>
  );
}

// REQ-441: the progress panel. items: [{ id, name, table, skip? }]; worker does one use case. Four run at once; Stop starts no new one.
export default function ValueBulkPanel({ items, worker, onClose }) {
  const [rows, setRows] = useState(() => items.map((it) => (it.skip ? { id: it.id, state: 'skipped', reason: it.skip } : { id: it.id, state: 'waiting' })));
  const [running, setRunning] = useState(true);
  const ctl = useRef(new AbortController());
  const started = useRef(false);
  const merge = (next) => setRows((prev) => prev.map((r) => next.find((n) => n.id === r.id) || r));

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runBulk({ items, worker, onUpdate: merge, signal: ctl.current.signal }).then(() => setRunning(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = (id) => {
    const item = items.find((it) => it.id === id);
    setRunning(true);
    runBulk({ items: [item], worker, onUpdate: merge }).then(() => setRunning(false));
  };
  const close = () => { ctl.current.abort(); onClose(); };
  const todo = rows.filter((r) => r.state !== 'skipped');
  const done = rows.filter((r) => r.state === 'done').length;
  const nameOf = (id) => items.find((it) => it.id === id)?.name || id;

  return (
    <ModalDialog titleId="value-bulk-title" title="Calculating value" onClose={close} widthClass="max-w-xl"
      footer={running ? <button type="button" onClick={() => ctl.current.abort()} className={btn}>Stop</button> : <button type="button" onClick={close} className={btn}>Close</button>}>
      <p data-bulk-progress="" aria-live="polite" className="text-sm font-semibold text-text-primary">{done} of {todo.length} done</p>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} data-bulk-row={r.id} data-bulk-state={r.state} className="flex items-baseline gap-3 py-2 text-sm">
            <span dir="auto" className="min-w-0 flex-1 break-words text-text-primary">{nameOf(r.id)}</span>
            <span className="shrink-0 text-end text-text-secondary">
              {r.state === 'done' && <span className="font-semibold text-text-primary">{totalText(r.yearly) || 'Done'} per year</span>}
              {r.state === 'failed' && (
                <span className="inline-flex items-center gap-2">
                  <span dir="auto" className="text-error-fg">Failed: {r.message}</span>
                  <button type="button" onClick={() => retry(r.id)} className={btn}>Retry</button>
                </span>
              )}
              {r.state === 'skipped' && <span>Skipped: {r.reason}</span>}
              {LABELS[r.state] || ''}
            </span>
          </li>
        ))}
      </ul>
    </ModalDialog>
  );
}
