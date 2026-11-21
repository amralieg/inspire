import { totalTextOf } from '../lib/valueDrivers';
// REQ-435: the saved versions of one use case's value answers, newest first, with Undo. The server owns the list; nothing is computed here.
const whenOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); };

export default function ValueHistory({ history = [], busy = false, onUndo }) {
  if (!history.length) return null;
  return (
    <section aria-label="History" className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">History</h3>
        {history.length > 1 && (
          <button type="button" disabled={busy} onClick={onUndo} className="rounded-md border border-border px-2 py-1 text-[12px] text-text-secondary hover:bg-bg-subtle disabled:opacity-50">Undo</button>
        )}
      </div>
      <ul className="divide-y divide-border rounded-md border border-border text-[12px]">
        {history.map((h) => (
          <li key={h.version} data-history-row="" className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
            <span className="w-8 font-semibold tabular-nums text-text-primary">{h.version}</span>
            <span className="text-text-secondary">{whenOf(h.saved_at)}</span>
            <span className="min-w-0 flex-1 break-all text-text-secondary">{h.saved_by}</span>
            <span className="font-semibold tabular-nums text-text-primary">{totalTextOf(h.yearly)}</span>
            {h.note && <span className="w-full text-text-tertiary">{h.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
