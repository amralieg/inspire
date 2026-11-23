import { useState } from 'react';
import { ATTRIBUTION } from '../../lib/valueDrivers.js';
import { moneyText } from '../../lib/valueWizard.js';
import { DEFAULT_RAMP } from '../../lib/valueStory.js';
import { Controls } from '../valueWizard/Ask.jsx';

const SHARE = { id: ATTRIBUTION.id, label: 'Share caused by this use case', kind: 'pct', default: ATTRIBUTION.default };
const LEVELS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const INPUT = 'w-28 rounded-md border border-border px-2 py-1 text-end text-sm tabular-nums';
export const paybackText = (n) => (Number.isFinite(Number(n)) && n != null ? `${n} ${Number(n) === 1 ? 'month' : 'months'}` : 'Not within 3 years');

function Projection({ projection, currency }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(projection?.years || []).map((y) => (
        <div key={y.year} data-projection-year={y.year} className="rounded-lg border border-border px-3 py-2">
          <p className="text-[12px] font-semibold text-text-secondary">Year {y.year}</p>
          <p className="text-lg font-extrabold tabular-nums text-text-primary">{moneyText(currency, y.likely)}</p>
          <p className="text-[12px] text-text-secondary">{moneyText(currency, y.low)} to {moneyText(currency, y.high)}</p>
        </div>
      ))}
    </div>
  );
}

// A cost box keeps its own typing; an empty box takes the cost away. economics is the answers.economics object, sent whole to onEconomics.
function CostBox({ label, value, onChange }) {
  const [draft, setDraft] = useState(value ? String(value) : '');
  return (
    <label className="flex items-center justify-between gap-3 text-[13px] font-semibold text-text-primary">
      {label}
      <input type="number" min={0} step="any" aria-label={label} value={draft} className={INPUT}
        onChange={(e) => { setDraft(e.target.value); onChange(e.target.value === '' || Number(e.target.value) < 0 ? null : Number(e.target.value)); }} />
    </label>
  );
}

// REQ-507 L6, pages economics:ramp and economics:cost. The amounts come from the server's yearly.projection (projection prop).
export default function StepEconomics({ page, answers, currency, projection, onEconomics, onCredit, onConfidence }) {
  const economics = answers.economics || {};
  const ramp = economics.ramp_pct || DEFAULT_RAMP;
  const set = (patch) => {
    const next = { ...economics, ramp_pct: ramp, ...patch };
    for (const k of ['build_cost', 'run_cost_per_year']) if (next[k] == null) delete next[k];
    onEconomics(next);
  };
  if (page === 'ramp') {
    return (
      <div data-wizard-page="economics:ramp" className="space-y-3">
        <p className="text-[13px] text-text-secondary">How much of the value you capture in each of the first 3 years.</p>
        <div className="space-y-1.5">
          {ramp.map((r, i) => (
            <label key={i} className="flex items-center justify-between gap-3 text-[13px] font-semibold text-text-primary">
              Year {i + 1} share captured (%)
              <input type="number" min={0} max={100} step="any" aria-label={`Year ${i + 1} share captured (%)`} value={r} className={INPUT}
                onChange={(e) => set({ ramp_pct: ramp.map((v, j) => (j === i ? (e.target.value === '' ? 0 : Math.min(100, Math.max(0, Number(e.target.value)))) : v)) })} />
            </label>
          ))}
        </div>
        <Projection projection={projection} currency={currency} />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-subtle px-4 py-1">
          <p className="text-[13px] font-semibold text-text-primary">{SHARE.label}</p>
          <Controls row ask={SHARE} value={answers.attribution_pct ?? SHARE.default} onChange={onCredit} currency={currency} />
        </div>
      </div>
    );
  }
  const gross = !projection || projection.gross_only;
  return (
    <div data-wizard-page="economics:cost" className="space-y-3">
      <div className="space-y-1.5">
        <CostBox label="Build cost (one-off)" value={economics.build_cost} onChange={(v) => set({ build_cost: v })} />
        <CostBox label="Run cost per year" value={economics.run_cost_per_year} onChange={(v) => set({ run_cost_per_year: v })} />
      </div>
      {projection && (gross ? (
        <p data-gross-3y="" className="rounded-lg border border-border px-3 py-2 text-[13px] text-text-primary">
          Gross value over 3 years: <span className="font-semibold">{moneyText(currency, projection.gross_3y)}</span>. No cost is entered, so this is gross, not net.
        </p>
      ) : (
        <dl className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border px-3 py-2"><dt className="text-[12px] text-text-secondary">Payback</dt>
            <dd data-payback="" className="text-lg font-extrabold tabular-nums">{paybackText(projection.payback_months)}</dd></div>
          <div className="rounded-lg border border-border px-3 py-2"><dt className="text-[12px] text-text-secondary">Net over 3 years</dt>
            <dd data-net-3y="" className="text-lg font-extrabold tabular-nums">{moneyText(currency, projection.net_3y)}</dd></div>
          <div className="rounded-lg border border-border px-3 py-2"><dt className="text-[12px] text-text-secondary">Return on cost</dt>
            <dd data-roi="" className="text-lg font-extrabold tabular-nums">{projection.roi_3y == null ? 'n/a' : `${Math.round(Number(projection.roi_3y) * 100)}%`}</dd></div>
        </dl>
      ))}
      <div role="radiogroup" aria-label="How confident are you in this value?" className="flex flex-wrap items-center gap-4">
        <span className="text-[13px] font-semibold text-text-primary">How confident are you in this value?</span>
        {LEVELS.map(([id, label]) => (
          <label key={id} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-text-primary">
            <input type="radio" name="value-confidence" checked={answers.confidence === id} onChange={() => onConfidence(id)} />{label}
          </label>
        ))}
      </div>
    </div>
  );
}
