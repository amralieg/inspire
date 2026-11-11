import { plural } from '../lib/plural';
import { valueChips } from '../lib/valueLedger';

const CHIP_TONE = {
  'at stake': 'border-db-red/30 bg-surface text-db-red-fg',
  saved: 'border-success/35 bg-success-bg text-success-fg',
};

function ChipGroup({ label, entries }) {
  const { shown, more } = valueChips(entries);
  return (
    <span data-value-group={label} className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">{label}</span>
      {shown.length === 0 && <span className="text-[11px] text-text-secondary">none yet</span>}
      {shown.map((chip) => (
        <span
          key={`${chip.kind}:${chip.unit}`}
          data-value-chip={chip.unit}
          data-value-kind={chip.kind}
          className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none ${CHIP_TONE[label]}`}
        >
          {chip.text}
        </span>
      ))}
      {more > 0 && <span data-value-more="" className="text-[11px] font-semibold text-text-secondary">+{more}</span>}
    </span>
  );
}

export default function ValueBadge({ atStake, saved, measured = true, mvps = null, className = '' }) {
  if (!measured) {
    return <p data-value-state="not-measured" className={`text-xs leading-snug text-text-tertiary ${className}`}>Not measured yet</p>;
  }
  return (
    <div data-value-badge="" className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-db-red/25 bg-db-red-50 px-2.5 py-1.5 ${className}`}>
      <ChipGroup label="at stake" entries={atStake} />
      <span aria-hidden className="text-text-tertiary">·</span>
      <ChipGroup label="saved" entries={saved} />
      {mvps != null && <span data-value-mvps="" className="text-[11px] text-text-secondary">from {plural(mvps, 'MVP')}</span>}
    </div>
  );
}

export function OverallValue({ value }) {
  if (!value || !(Number(value.runs) > 0)) return null;
  return (
    <section aria-label="Value across runs" data-value-overall="" className="rounded-xl border border-db-red/25 bg-db-red-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">Value across runs</p>
      <div className="mt-2">
        <ValueBadge atStake={value.at_stake} saved={value.saved} />
      </div>
      <p className="mt-2 text-[11px] text-text-secondary">
        across {plural(value.runs, 'run')}, {plural(value.businesses, 'business', 'businesses')} · saved is as reported by owners
      </p>
    </section>
  );
}
