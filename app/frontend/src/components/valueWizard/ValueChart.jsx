import { moneyText } from '../../lib/valueWizard.js';

const COLORS = ['bg-db-red', 'bg-ok', 'bg-warning', 'bg-text-secondary', 'bg-error'];

// REQ-495: one bar per part of the yearly total, sized against the biggest part. The amounts are the server's.
export default function ValueChart({ yearly, currentId }) {
  const parts = (yearly?.parts || []).filter((p) => Number.isFinite(Number(p.amount)));
  if (!parts.length) return null;
  const max = Math.max(...parts.map((p) => Math.abs(Number(p.amount))), 1);
  return (
    <section data-value-chart="" aria-label="What makes the yearly total" className="min-w-0 space-y-0.5 rounded-lg border border-border px-3 py-1.5">
      <h4 className="text-[12px] font-semibold text-text-primary">What makes the yearly total</h4>
      {parts.map((p, k) => (
        <div key={p.id} data-chart-bar={p.id} className="flex items-center gap-2 text-[12px]">
          <span className={`w-28 shrink-0 truncate ${p.id === currentId ? 'font-bold text-text-primary' : 'text-text-secondary'}`} title={p.label}>{p.label}</span>
          <span className="h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-bg-subtle">
            <span className={`block h-full ${COLORS[k % COLORS.length]}`} style={{ width: `${Math.max(2, (100 * Math.abs(Number(p.amount))) / max)}%` }} />
          </span>
          <span className="w-16 shrink-0 text-end font-semibold tabular-nums text-text-primary">{moneyText(yearly?.total?.unit, p.amount)}</span>
        </div>
      ))}
    </section>
  );
}
