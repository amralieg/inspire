import { VALUE_LABELS, statusLabel, yearlyHeadline } from '../lib/valueLabels';
import { DATA_TAG, DRIVER_TAG, totalTextOf } from '../lib/valueDrivers';
import { valueChips } from '../lib/valueLedger.js';
import ValueDisclaimer from './ValueDisclaimer';

// REQ-435: what a value is made of, one row per part with where it comes from. An answer with no parts (data only, full share)
// shows the plain value line the card shows.
const amountText = (p) => valueChips([{ kind: 'money', unit: p.unit, amount: p.amount }], 1).shown[0]?.text || '';

export default function ValueSplit({ yearly }) {
  if (!yearly) return null;
  if (!Array.isArray(yearly.parts)) {
    const head = yearlyHeadline(yearly);
    return (
      <section data-value-line="" aria-label="Value" className="space-y-1 rounded-md border border-border px-3 py-2">
        <p className="text-sm text-text-primary"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">{yearly.verb}</span>{' '}
          <span className="font-bold tabular-nums">{head?.text}</span> <span className="text-text-secondary">{yearly.period || VALUE_LABELS.perYear}</span></p>
        <ValueDisclaimer />
      </section>
    );
  }
  return (
    <section data-value-split="" aria-label="What the value is made of" className="space-y-1.5 rounded-md border border-border px-3 py-2">
      <ul className="divide-y divide-border">
        {yearly.parts.map((p) => (
          <li key={p.id} data-split-row="" className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1 text-text-primary">{p.label}</span>
            <span className="font-semibold tabular-nums text-text-primary">{amountText(p)}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-secondary">{p.source === 'data' ? DATA_TAG : DRIVER_TAG}</span>
          </li>
        ))}
      </ul>
      <p data-split-share="" className="text-[12px] text-text-secondary">{`Share of this value the use case earns: ${yearly.attribution_pct ?? 100}%`}</p>
      <p data-split-total="" className="flex justify-between text-sm font-bold text-text-primary"><span>{`Total per year (${statusLabel(yearly.calculated)})`}</span><span className="tabular-nums">{totalTextOf(yearly)}</span></p>
      <ValueDisclaimer />
    </section>
  );
}
