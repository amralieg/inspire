import { plural } from '../lib/plural';
import { valueChips } from '../lib/valueLedger';
import { EstimateTotals } from './ValueEstimateLine';

const isCount = (entry) => entry?.kind === 'count';
const amountsOf = (entries) => (Array.isArray(entries) ? entries : []).filter((entry) => !isCount(entry));
const countsOf = (entries) => (Array.isArray(entries) ? entries : []).filter(isCount);

export default function ValueBadge({ atStake, saved, measured = true, mvps = null, className = '' }) {
  if (!measured) {
    return <p data-value-state="not-measured" className={`text-xs leading-snug text-text-secondary ${className}`}>Not measured yet</p>;
  }
  const stake = valueChips(amountsOf(atStake), Infinity).shown;
  const saves = valueChips(amountsOf(saved), Infinity).shown;
  const counts = [...valueChips(countsOf(atStake), Infinity).shown, ...valueChips(countsOf(saved), Infinity).shown].map((chip) => chip.text);
  const meta = [...(mvps != null ? [`from ${plural(mvps, 'MVP')}`] : []), ...counts].join(' · ');
  const secondary = [
    ...stake.slice(1).map((chip) => ({ ...chip, side: 'at stake' })),
    ...saves.slice(1).map((chip) => ({ ...chip, side: 'saved' })),
  ];
  const headStake = stake[0];
  const headSaved = saves[0];
  return (
    <div data-value-badge="" className={`rounded-xl border border-border bg-surface px-3.5 py-3 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div data-value-side="at stake">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary">At stake</p>
          <p data-value-headline="at stake" className={`mt-0.5 text-2xl font-bold tabular-nums leading-none ${headStake ? 'text-warning-fg' : 'text-text-secondary'}`}>
            {headStake ? headStake.text : 'none yet'}
          </p>
        </div>
        <div data-value-side="saved">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary">Saved</p>
          <p data-value-headline="saved" className={`mt-0.5 text-xl font-bold tabular-nums leading-none ${headSaved ? 'text-success-fg' : 'text-text-secondary'}`}>
            {headSaved ? headSaved.text : 'none saved yet'}
          </p>
        </div>
      </div>
      {secondary.length > 0 && (
        <ul data-value-secondary="" aria-label="Other amounts" className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-text-secondary">
          {secondary.map((chip) => (
            <li key={`${chip.side}:${chip.kind}:${chip.unit}`} data-value-chip={chip.unit} data-value-kind={chip.kind} data-value-side={chip.side}
              className="rounded-md border border-border px-1.5 py-0.5 tabular-nums">
              {chip.side === 'saved' ? `${chip.text} saved` : chip.text}
            </li>
          ))}
        </ul>
      )}
      {meta && <p data-value-mvps="" className="mt-2 text-[11px] text-text-secondary">{meta}</p>}
    </div>
  );
}

export function OverallValue({ value, estimated = null, estimateCap = null }) {
  if (!value || !(Number(value.runs) > 0)) return null;
  return (
    <section aria-label="Value across runs" data-value-overall="" className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">Value across runs</p>
      <div className="mt-2">
        <ValueBadge atStake={value.at_stake} saved={value.saved} />
      </div>
      <p className="mt-2 text-[11px] text-text-secondary">
        across {plural(value.runs, 'run')}, {plural(value.businesses, 'business', 'businesses')} · saved is as reported by owners
      </p>
      {estimated && <EstimateTotals totals={estimated} className="mt-1" />}
      {estimated && estimateCap && <p data-estimate-cap="" className="mt-1 text-[11px] text-text-tertiary">{`Estimate covers the latest ${estimateCap} runs`}</p>}
    </section>
  );
}
