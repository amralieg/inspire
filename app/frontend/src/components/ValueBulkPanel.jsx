import { Loader2 } from 'lucide-react';
import ModalDialog from './ModalDialog';
import { PlainMessage } from './TechnicalDetails';
import { bulkCounts, useValueBulkRun } from '../lib/valueBulkRun';
import { reviewLineOf, totalText } from '../lib/valueWizard.js';
import { bulkSummary, preSkipNote, rangeNote } from '../lib/valueBulk.js';

const btn = 'rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-50';
// A failed or skipped row carries a sentence: it wraps on its own line under the name instead of squeezing it.
const wide = (state, check) => state === 'failed' || state === 'skipped' || (state === 'done' && Boolean(check));
const LABELS = { waiting: 'Waiting', working: 'Working', stopped: 'Stopped' };

// REQ-441, REQ-512: the toolbar above the rows while one or more are ticked: the same three actions the row carries, for the whole selection.
// Calculate value runs the bulk run; Build MVP and Generate docs open their wizard for the ticked use cases (a queue, "1 of N", for the MVP wizard).
export function ValueBulkBar({ shown, selected, onSelectAll, onClear, onCalculate, onGenerate = null, onBuild = null, busy = false }) {
  if (selected < 1) return null;
  const all = shown > 0 && selected === shown;
  const ghost = 'rounded-md px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 hover:text-white';
  const action = 'rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20';
  return (
    <div role="toolbar" aria-label="Actions for the selected use cases" data-value-bulk-bar="" className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-black py-2 pe-2 ps-4 text-xs text-white shadow-lg">
      <span className="me-2 font-semibold tabular-nums">{selected} selected</span>
      {onBuild && <button type="button" onClick={onBuild} className={action}>Build MVP for {selected}</button>}
      {onGenerate && <button type="button" onClick={onGenerate} className={action}>Generate docs for {selected}</button>}
      <button type="button" onClick={onCalculate} disabled={busy} title={busy ? 'A value calculation is running. Wait for it to finish or stop it first.' : undefined}
        className="rounded-md bg-primary-solid px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-solid-hover disabled:cursor-not-allowed disabled:opacity-50">
        Calculate value for {selected}
      </button>
      <span className="ms-auto flex items-center gap-1">
        {!all && <button type="button" onClick={() => onSelectAll(true)} className={ghost}>Select all</button>}
        <button type="button" onClick={onClear} className={ghost}>Clear</button>
      </span>
    </div>
  );
}

// REQ-441/443: the progress panel, a view of the app-level run (lib/valueBulkRun). Four run at once; Stop starts no new one.
// "Run in background", X and Esc hide it while the run goes on; only Stop stops it. When the run is finished, Close removes it.
// FX-55: Edit hands the use case id to the page, which opens the same value editor the card's pencil opens, shown or filtered out.
export default function ValueBulkPanel({ onEdit }) {
  const { run, stop, retry, hide, dismiss } = useValueBulkRun();
  if (!run) return null;
  const { rows, items, running } = run;
  const close = running ? hide : dismiss;
  const nameOf = (id) => items.find((it) => it.id === id)?.name || id;

  // busy-ok: the title names the dialog; each row being worked on spins below
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
            <span dir="auto" data-bulk-name="" title={nameOf(r.id)} className="min-w-[8rem] max-w-full flex-1 basis-40 truncate text-text-primary">{nameOf(r.id)}</span>
            <span data-bulk-reason="" className={`min-w-0 max-w-full break-words text-text-secondary ${wide(r.state, r.check) ? 'basis-full' : 'sm:text-end'}`}>
              {r.state === 'done' && !r.check && <span className="font-semibold text-text-primary">{totalText(r.yearly) || 'Done'} per year</span>}
              {r.state === 'done' && r.check && (
                <span className="inline-flex items-center gap-2">
                  <span dir="auto" data-bulk-check="" className="text-warning-fg">{rangeNote(r.yearly?.total?.unit || r.yearly?.currency, r.check.amount)}</span>
                  <button type="button" onClick={() => { hide(); onEdit?.(r.id); }} className={btn}>Edit</button>
                </span>
              )}
              {r.state === 'failed' && (
                <span className="inline-flex items-center gap-2">
                  <PlainMessage as="span" dir="auto" text={`Failed: ${r.message}`} className="text-error-fg" />
                  <button type="button" onClick={() => retry(r.id)} className={btn}>Retry</button>
                </span>
              )}
              {r.state === 'skipped' && <span>Skipped: {r.reason}</span>}
              {r.state === 'working' && <Loader2 size={14} className="me-1 inline motion-safe:animate-spin" aria-hidden />}
              {LABELS[r.state] || ''}
            </span>
            {r.state === 'done' && reviewLineOf(r.review) && <span dir="auto" data-value-review="" className="basis-full text-[12px] text-text-secondary">{reviewLineOf(r.review)}</span>}
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
      <span data-bulk-bg-text="" aria-live="polite" className="font-semibold text-text-primary">{run.running && <Loader2 size={14} className="me-1.5 inline motion-safe:animate-spin" aria-hidden />}{run.running ? 'Calculating value' : 'Value calculated'}: {bulkSummary(run.rows, run.items)}</span>
      <div role="progressbar" aria-label="Value calculation progress" aria-valuemin={0} aria-valuenow={done} aria-valuemax={total}
        className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-bg-subtle">
        <div className="h-full bg-primary-solid text-white" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
      </div>
      <button type="button" onClick={show} className={btn}>Open</button>
      {run.running ? <button type="button" onClick={stop} className={btn}>Stop</button> : <button type="button" onClick={dismiss} className={btn}>Dismiss</button>}
    </div>
  );
}
