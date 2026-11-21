import { useState } from 'react';
import { ATTRIBUTION } from '../../lib/valueDrivers.js';
import { DRIVER_ICONS, countText, moneyText, partOf, totalText } from '../../lib/valueWizard.js';
import ValueDisclaimer from '../ValueDisclaimer.jsx';
import Ask, { Controls } from './Ask.jsx';

const CREDIT = { id: ATTRIBUTION.id, label: ATTRIBUTION.label, kind: 'pct', default: ATTRIBUTION.default };

// REQ-437, step 5: the total on top, five tiles side by side, one editor under them, then groups and credit side by side.
export default function StepSave({ plan, answers, yearly, calculated, onToggleDriver, onInput, onToggleGroup, onCredit, children }) {
  const [open, setOpen] = useState(null);
  const unit = yearly?.total?.unit;
  const out = new Set(answers.excluded_groups);
  const opened = plan.drivers.find((d) => d.id === open);
  return (
    <div data-wizard-page="save" className="space-y-2.5">
      <div data-save-total="" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-subtle px-4 py-2">
        <div><p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{yearly?.verb || 'Value'}</p>
          <p className="text-2xl font-extrabold tabular-nums text-text-primary">{totalText(yearly) || '...'} <span className={`text-[12px] font-semibold ${calculated ? 'text-ok-fg' : 'text-warning-fg'}`}>{calculated ? '(calculated)' : '(estimated)'}</span></p></div>
        <p className="text-[12px] text-text-secondary">Per year{yearly?.groups ? `, ${yearly.groups.covered} of ${yearly.groups.of} groups` : ''}</p>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {plan.drivers.map((d) => {
          const on = Boolean(answers.drivers[d.id]?.on);
          const part = partOf(yearly, d.id);
          return (
            <div key={d.id} data-tile={d.id} className={`flex min-h-[104px] flex-col gap-1 rounded-lg border px-2.5 py-2 ${open === d.id ? 'border-db-red-solid ring-1 ring-db-red-solid' : 'border-border'} ${on ? '' : 'bg-bg-subtle text-text-tertiary'}`}>
              <div className="flex items-start gap-1.5">
                <input type="checkbox" aria-label={`Include ${d.label}`} checked={on} onChange={() => onToggleDriver(d.id)} className="mt-0.5" />
                <span aria-hidden="true">{DRIVER_ICONS[d.id] || ''}</span>
                <span className="min-w-0 flex-1 text-[12px] font-semibold leading-tight">{d.label}</span>
              </div>
              <p className="mt-auto text-base font-extrabold tabular-nums">{on ? (part ? <>{moneyText(unit, part.amount)}<span className="text-[10px] font-normal text-text-secondary"> a year</span></> : '...') : 'off'}</p>
              <button type="button" disabled={!on} onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={open === d.id}
                className="text-start text-[12px] font-semibold text-db-red-solid disabled:opacity-40">Edit numbers</button>
            </div>
          );
        })}
      </div>
      {opened && answers.drivers[opened.id]?.on && (
        <div data-editor={opened.id} className="space-y-1.5 rounded-lg border border-db-red-solid px-3 py-2">
          <p className="text-[13px] font-semibold text-text-primary">{opened.label}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {opened.asks.map((a) => (
              <Ask key={a.id} ask={a} compact value={answers.drivers[opened.id].inputs[a.id]} currency={answers.currency || yearly?.currency}
                dataValue={partOf(yearly, opened.id)?.inputs?.find((i) => i.id === a.id)?.value} onChange={(v) => onInput(opened.id, a.id, v)} />
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1 text-[13px] font-semibold text-text-primary">Groups</p>
          <div className="flex flex-wrap gap-1.5">
            {plan.groups.map((g) => (
              <label key={g.g} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] ${out.has(g.g) ? 'border-border bg-bg-subtle text-text-secondary' : 'border-db-red-solid'}`}>
                <input type="checkbox" checked={!out.has(g.g)} onChange={() => onToggleGroup(g.g)} />{g.g}<span className="text-[10px] text-text-secondary">{countText(g.records_per_year)}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[13px] font-semibold text-text-primary">{ATTRIBUTION.label}</p>
          <Controls ask={CREDIT} value={answers.attribution_pct} onChange={onCredit} currency={answers.currency} />
        </div>
      </div>
      <ValueDisclaimer />
      {children}
    </div>
  );
}
