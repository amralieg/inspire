import { PlainMessage } from '../TechnicalDetails';
import { DRIVER_ICONS, countText, moneyText, partOf, recordsOf, totalText } from '../../lib/valueWizard.js';
import Ask from './Ask.jsx';

const opTexts = { '=': 'is', '!=': 'is not', '>': 'is above', '>=': 'is at least', '<': 'is below', '<=': 'is at most', is_not_null: 'is filled' };
const filterText = (f) => (f?.column ? ` where ${f.column} ${opTexts[f.op] || f.op}${f.op === 'is_not_null' ? '' : ` ${f.value}`}` : '');
const dataValueOf = (yearly, driverId, ask) => (yearly ? partOf(yearly, driverId)?.inputs?.find((i) => i.id === ask.id)?.value : undefined);

// REQ-436 step 1: what the use case works on, the grouping, and how value is built.
export function StepData({ plan, answers, onGrouping }) {
  return (
    <div data-wizard-page="data" className="space-y-3">
      <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2 text-[13px] text-text-primary">
        <p data-case-noun=""><b>What is a "{plan.case_noun}"?</b> Each row in <code>{plan.table}</code>{filterText(plan.case_filter)} is one {plan.case_noun}. Every value here is counted per {plan.case_noun}, so the numbers come from your data where they can.</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded-lg border border-ok/30 bg-ok-bg px-4 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ok-fg">From your data</p>
          <p data-records-per-year="" className="text-2xl font-extrabold tabular-nums text-ok-fg">{countText(recordsOf(plan, answers))} <span className="text-[12px] font-normal">{plan.case_noun}s a year</span></p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-text-primary">How should the numbers be grouped?</p>
          <div role="radiogroup" aria-label="Grouping" className="mt-1 flex flex-wrap gap-2">
            {plan.groupings.map((g) => {
              const on = g.column === plan.grouping;
              return (
                <button key={g.column} type="button" role="radio" aria-checked={on} onClick={() => !on && onGrouping(g.column)}
                  className={`rounded-lg border px-3 py-1 text-[13px] ${on ? 'border-db-red-solid ring-1 ring-db-red-solid' : 'border-border hover:bg-bg-subtle'}`}>{g.label}</button>
              );
            })}
          </div>
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

// Step 2: the five kinds of value, each on or off.
export function StepKinds({ plan, answers, onToggle }) {
  return (
    <div data-wizard-page="kinds" className="space-y-2">
      <p className="text-[13px] text-text-secondary">Pick the kinds of value this use case creates. Each one you keep gets its own page.</p>
      <div className="grid grid-cols-2 gap-2">
        {plan.drivers.map((d) => {
          const on = Boolean(answers.drivers[d.id]?.on);
          return (
            <button key={d.id} type="button" role="checkbox" aria-checked={on} onClick={() => onToggle(d.id)}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-start ${on ? 'border-db-red-solid ring-1 ring-db-red-solid' : 'border-border hover:bg-bg-subtle'}`}>
              <span aria-hidden="true" className="text-xl leading-none">{DRIVER_ICONS[d.id] || ''}</span>
              <span className="min-w-0 flex-1"><b className="block text-[13px] text-text-primary">{d.label}</b><span className="block text-[12px] text-text-secondary">{d.why}</span>
                <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{d.verb}</span></span>
              <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${on ? 'border-db-red-solid bg-db-red-solid text-white' : 'border-border'}`}>{on ? '✓' : ''}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Steps 3: one kind, its asks, its amount and the running total.
export function StepKind({ plan, driver, answers, yearly, onInput, status, error }) {
  const part = partOf(yearly, driver.id);
  const unit = yearly?.total?.unit;
  return (
    <div data-wizard-page={`driver:${driver.id}`} className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className="text-2xl">{DRIVER_ICONS[driver.id] || ''}</span>
        <div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-text-primary">{driver.label}</h3><p className="text-[12px] text-text-secondary">{driver.why}</p></div>
        <div className="rounded-lg border border-border px-3 py-1 text-end"><p className="text-[10px] uppercase tracking-wide text-text-secondary">{driver.label}</p><p data-kind-amount="" className="text-lg font-extrabold tabular-nums text-text-primary">{part ? moneyText(unit, part.amount) : '...'}</p></div>
        <div className="rounded-lg border border-border bg-bg-subtle px-3 py-1 text-end"><p className="text-[10px] uppercase tracking-wide text-text-secondary">Running total</p><p data-run-total="" className="text-lg font-extrabold tabular-nums text-text-primary">{totalText(yearly) || '...'}</p></div>
      </div>
      {status === 'error' && <PlainMessage text={error} role="alert" dir="auto" className="rounded-md border border-error/30 bg-error-bg px-3 py-1.5 text-[12px] text-error-fg" />}
      <div className="grid grid-cols-2 gap-2">
        {driver.asks.map((a) => (
          <Ask key={a.id} ask={a} value={answers.drivers[driver.id]?.inputs[a.id]} dataValue={dataValueOf(yearly, driver.id, a)} currency={yearly?.currency}
            onChange={(v) => onInput(driver.id, a.id, v)} />
        ))}
      </div>
    </div>
  );
}

// Step 4: which groups count.
export function StepGroups({ plan, answers, onToggleGroup }) {
  const out = new Set(answers.excluded_groups);
  return (
    <div data-wizard-page="groups" className="space-y-2">
      <p className="text-[13px] text-text-secondary">{plan.groups.length > 1 ? `Tick the groups to count (${plan.groupings.find((g) => g.column === plan.grouping)?.label || plan.grouping}).` : 'Your data has one group, so there is nothing to pick here.'}</p>
      <div className="flex flex-wrap gap-2">
        {plan.groups.map((g) => (
          <label key={g.g} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-[13px] ${out.has(g.g) ? 'border-border bg-bg-subtle text-text-secondary' : 'border-db-red-solid'}`}>
            <input type="checkbox" checked={!out.has(g.g)} onChange={() => onToggleGroup(g.g)} />{g.g}<span className="text-[11px] text-text-secondary">{countText(g.records_per_year)} a year</span>
          </label>
        ))}
      </div>
    </div>
  );
}
