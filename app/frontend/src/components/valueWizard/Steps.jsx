import { PlainMessage } from '../TechnicalDetails';
import { DRIVER_ICONS, countText, likelyLineOf, moneyText, partOf, recordsOf, totalText } from '../../lib/valueWizard.js';
import Ask from './Ask.jsx';
import FormulaLine from './FormulaLine.jsx';
import ValueChart from './ValueChart.jsx';

const opTexts = { '=': 'is', '!=': 'is not', '>': 'is above', '>=': 'is at least', '<': 'is below', '<=': 'is at most', is_not_null: 'is filled' };
const filterText = (f) => (f?.column ? ` where ${f.column} ${opTexts[f.op] || f.op}${f.op === 'is_not_null' ? '' : ` ${f.value}`}` : '');
const dataValueOf = (yearly, driverId, ask) => (yearly ? partOf(yearly, driverId)?.inputs?.find((i) => i.id === ask.id)?.value : undefined);

// REQ-436 step 2: what the use case works on and how value is built. REQ-473: the value is over all records, so there is no grouping choice.
export function StepData({ plan, answers }) {
  return (
    <div data-wizard-page="data" className="space-y-3">
      <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2 text-[13px] text-text-primary">
        <p data-case-noun=""><b>What is a "{plan.case_noun}"?</b> Each row in <code>{plan.table}</code>{filterText(plan.case_filter)} is one {plan.case_noun}. Every value here is counted per {plan.case_noun}, so the numbers come from your data where they can.</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded-lg border border-ok/30 bg-ok-bg px-4 py-2">
          <p className="text-caption font-semibold uppercase tracking-wide text-ok-fg">From your data</p>
          <p data-records-per-year="" className="text-2xl font-extrabold tabular-nums text-ok-fg">{countText(recordsOf(plan, answers))} <span className="text-[12px] font-normal">{plan.case_noun}s a year</span></p>
        </div>
      </div>
      <div aria-label="How value is built" className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="rounded-full border border-ok/30 bg-ok-bg px-2.5 py-0.5 text-ok-fg">{plan.case_noun}s a year (your data)</span>
        <span aria-hidden="true">x</span>
        <span className="rounded-full border border-ok/30 bg-ok-bg px-2.5 py-0.5 text-ok-fg">what each is worth (your data)</span>
        <span aria-hidden="true">x</span>
        <span className="rounded-full border border-warning/40 bg-warning-bg px-2.5 py-0.5 text-warning-fg">your estimate for what changes</span>
        <span aria-hidden="true">=</span>
        <span className="rounded-full border border-border px-2.5 py-0.5 font-semibold text-text-primary">value per year</span>
      </div>
    </div>
  );
}

// REQ-472 (d): step 1, every kind of value with an Include box, then (REQ-474) the AI's likely value. FX-97: the economic trend lives on its own step.
export function StepKinds({ plan, answers, onToggle }) {
  const likely = likelyLineOf(plan.likely_value);
  return (
    <div data-wizard-page="kinds" className="space-y-2">
      <p className="text-[13px] text-text-secondary">Pick the kinds of value this use case creates. Each one you include gets its own page.</p>
      {likely && <p data-likely-value="" className="text-[13px] font-semibold text-text-primary">{likely}</p>}
      <div className="grid grid-cols-2 gap-2">
        {plan.drivers.map((d) => {
          const on = Boolean(answers.drivers[d.id]?.on);
          return (
            <label key={d.id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-start ${on ? 'border-primary-solid ring-1 ring-primary-solid' : 'border-border hover:bg-bg-subtle'}`}>
              <input type="checkbox" aria-label={`Include ${d.label}`} checked={on} onChange={() => onToggle(d.id)} className="mt-1" />
              <span aria-hidden="true" className="text-xl leading-none">{DRIVER_ICONS[d.id] || ''}</span>
              <span className="min-w-0 flex-1"><b className="block text-[13px] text-text-primary">{d.label}</b><span className="block text-[12px] text-text-secondary">{d.why}</span>
                <span className="mt-0.5 block text-caption font-semibold uppercase tracking-wide text-text-secondary">{d.verb}</span></span>
              <span className="shrink-0 text-caption font-semibold text-text-secondary">Include</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// Steps 3: one kind, its asks, its amount and the running total.
export function StepKind({ driver, answers, yearly, onInput, status, error }) {
  const stale = status === 'error';
  const part = stale ? null : partOf(yearly, driver.id);
  const unit = yearly?.total?.unit;
  return (
    <div data-wizard-page={`driver:${driver.id}`} className="space-y-2 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-x-3 lg:gap-y-2 lg:space-y-0">
      <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
        <span aria-hidden="true" className="text-2xl">{DRIVER_ICONS[driver.id] || ''}</span>
        <div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-text-primary">{driver.label}</h3><p className="text-[12px] text-text-secondary">{driver.why}</p></div>
        <div className="rounded-lg border border-border px-3 py-1 text-end"><p className="text-caption uppercase tracking-wide text-text-secondary">{driver.label}</p><p data-kind-amount="" className="text-lg font-extrabold tabular-nums text-text-primary">{part ? moneyText(unit, part.amount) : stale ? 'Not set' : '...'}{part && <span className="text-caption font-normal text-text-secondary"> per year</span>}</p></div>
        <div className="rounded-lg border border-border bg-bg-subtle px-3 py-1 text-end"><p className="text-caption uppercase tracking-wide text-text-secondary">Running total</p><p data-run-total="" className="text-lg font-extrabold tabular-nums text-text-primary">{stale ? 'Not set' : totalText(yearly) || '...'}{!stale && yearly?.total && <span className="text-caption font-normal text-text-secondary"> per year</span>}</p></div>
      </div>
      {status === 'error' && <PlainMessage text={error} role="alert" dir="auto" className="rounded-md border border-error/30 bg-error-bg px-3 py-1.5 text-[12px] text-error-fg lg:col-span-2" />}
      {/* FX-106: at laptop widths the inputs stand in one column and the formula, chart and confidence in the other, so the page fits the body with every input listed. */}
      <div className="min-w-0 space-y-1.5 lg:col-start-2 lg:row-start-2">
        <FormulaLine driver={driver} answers={answers} yearly={yearly} status={status} />
        <ValueChart yearly={stale ? null : yearly} currentId={driver.id} />
      </div>
      <div className="grid grid-cols-1 gap-1.5 lg:col-start-1 lg:row-start-2">
        {driver.asks.map((a) => (
          <Ask key={a.id} ask={a} compact value={answers.drivers[driver.id]?.inputs[a.id]} dataValue={dataValueOf(yearly, driver.id, a)} currency={answers.currency || yearly?.currency}
            onChange={(v) => onInput(driver.id, a.id, v)} />
        ))}
      </div>
    </div>
  );
}
