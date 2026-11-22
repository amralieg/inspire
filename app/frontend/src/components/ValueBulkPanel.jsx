import ModalDialog from './ModalDialog';
import { PlainMessage } from './TechnicalDetails';
import { bulkCounts, useValueBulkRun } from '../lib/valueBulkRun';
import { totalText } from '../lib/valueWizard.js';
import { bulkSummary, preSkipNote } from '../lib/valueBulk.js';

const btn = 'rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-50';
const LABELS = { waiting: 'Waiting', working: 'Working', stopped: 'Stopped' };

// REQ-441: the bar above the cards: Select all (the cards shown) and "Calculate value for N".
export function ValueBulkBar({ shown, selected, onSelectAll, onCalculate, busy = false }) {
  const all = shown > 0 && selected === shown;
  return (
    <div data-value-bulk-bar="" className="mb-2 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
      <label className="inline-flex items-center gap-2">
        <input type="checkbox" checked={all} onChange={(e) => onSelectAll(e.target.checked)} />
        <span>Select all</span>
      </label>
      {selected >= 1 && (
        <button type="button" onClick={onCalculate} disabled={busy} title={busy ? 'A value calculation is running. Wait for it to finish or stop it first.' : undefined}
          className="rounded-md bg-db-red-solid hover:bg-db-red-solid-hover px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed">
          Calculate value for {selected}
        </button>
      )}
    </div>
  );
}

// REQ-441/443: the progress panel, a view of the app-level run (lib/valueBulkRun). Four run at once; Stop starts no new one.
// "Run in background", X and Esc hide it while the run goes on; only Stop stops it. When the run is finished, Close removes it.
export default function ValueBulkPanel() {
  const { run, stop, retry, hide, dismiss } = useValueBulkRun();
  if (!run) return null;
  const { rows, items, running } = run;
  const close = running ? hide : dismiss;
  const nameOf = (id) => items.find((it) => it.id === id)?.name || id;

  return (
    <ModalDialog titleId="value-bulk-title" title="Calculating value" onClose={close} widthClass="max-w-xl"
      footer={running ? (
        <>
          <button type="button" onClick={hide} className={btn}>Run in background</button>
          <button type="button" onClick={stop} className={btn}>Stop</button>
        </>
      ) : <button type="button" onClick={close} className={btn}>Close</button>}>
      <p data-bulk-progress="" aria-live="polite" className="text-sm font-semibold text-text-primary">{bulkSummary(rows, items)}</p>
      {preSkipNote(items) && <p data-bulk-skipped="" className="text-xs text-text-secondary">{preSkipNote(items)}</p>}
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} data-bulk-row={r.id} data-bulk-state={r.state} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
            <span dir="auto" className="min-w-[8rem] flex-1 basis-40 break-words text-text-primary">{nameOf(r.id)}</span>
            <span className="min-w-0 max-w-full break-words text-text-secondary sm:text-end">
              {r.state === 'done' && <span className="font-semibold text-text-primary">{totalText(r.yearly) || 'Done'} per year</span>}
              {r.state === 'failed' && (
                <span className="inline-flex items-center gap-2">
                  <PlainMessage as="span" dir="auto" text={`Failed: ${r.message}`} className="text-error-fg" />
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

// REQ-443: the bar above the cards while the run's dialog is hidden: live count, Open the dialog, Stop; Dismiss once finished.
export function ValueBulkProgress() {
  const { run, stop, show, dismiss } = useValueBulkRun();
  if (!run || run.open) return null;
  const { done, total } = bulkCounts(run);
  return (
    <div data-bulk-bg="" className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary">
      <span data-bulk-bg-text="" aria-live="polite" className="font-semibold text-text-primary">{run.running ? 'Calculating value' : 'Value calculated'}: {bulkSummary(run.rows, run.items)}</span>
      <div role="progressbar" aria-label="Value calculation progress" aria-valuemin={0} aria-valuenow={done} aria-valuemax={total}
        className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-bg-subtle">
        <div className="h-full bg-db-red-solid text-white" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
      </div>
      <button type="button" onClick={show} className={btn}>Open</button>
      {run.running ? <button type="button" onClick={stop} className={btn}>Stop</button> : <button type="button" onClick={dismiss} className={btn}>Dismiss</button>}
    </div>
  );
}
