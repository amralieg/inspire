import { totalTextOf } from '../lib/valueDrivers';
// REQ-435: the saved versions of one use case's value answers, newest first, with Undo. The server owns the list; nothing is computed here.
const whenOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); };

export default function ValueHistory({ history = [], busy = false, onUndo }) {
  if (!history.length) return null;
  return (
    <section aria-label="History" className="flex items-start gap-2">
      <div className="flex shrink-0 items-center gap-2 py-0.5">
        <h3 className="text-[13px] font-semibold text-text-primary">History</h3>
        {history.length > 1 && (
          <button type="button" disabled={busy} onClick={onUndo} className="rounded-md border border-border px-2 py-0.5 text-[12px] text-text-secondary hover:bg-bg-subtle disabled:opacity-50">Undo</button>
        )}
      </div>
      <ul className="grid min-w-0 flex-1 max-h-[4.5rem] grid-cols-2 gap-px overflow-y-auto rounded-md border border-border bg-border text-[12px]">
        {history.map((h) => (
          <li key={h.version} data-history-row="" title={h.note || undefined} className="flex min-w-0 items-center gap-x-2 bg-surface px-2 py-0.5">
            <span className="w-5 shrink-0 font-semibold tabular-nums text-text-primary">{h.version}</span>
            <span className="shrink-0 text-text-secondary">{whenOf(h.saved_at)}</span>
            <span className="min-w-0 flex-1 truncate text-text-secondary">{h.saved_by}</span>
            <span className="shrink-0 font-semibold tabular-nums text-text-primary">{totalTextOf(h.yearly)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
