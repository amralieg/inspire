import { useState } from 'react';
import { ATTRIBUTION } from '../../lib/valueDrivers.js';
import TermsHeading from '../value/TermsHeading';
import { DRIVER_ICONS, driversOn, figureText, moneyText, partOf, totalText } from '../../lib/valueWizard.js';
import { VALUE_DISCLAIMER, statusLabel } from '../../lib/valueLabels';
import Ask, { Controls } from './Ask.jsx';
import FormulaLine from './FormulaLine.jsx';

const CREDIT = { id: ATTRIBUTION.id, label: ATTRIBUTION.label, kind: 'pct', default: ATTRIBUTION.default };

// REQ-437, step 5: the total on top, five tiles side by side, one editor under them, then the credit. REQ-473: value is over all records, no groups.
export default function StepSave({ plan, answers, yearly, calculated, onToggleDriver, onInput, onCredit, status, accepted = false, onAccept, children }) {
  const [open, setOpen] = useState(null);
  const unit = yearly?.total?.unit;
  const opened = plan.drivers.find((d) => d.id === open);
  return (
    <div data-wizard-page="save" className="space-y-1">
      <div data-save-total="" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-subtle px-4 py-1">
        <div><p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{yearly?.verb || 'Value'}</p>
          <p className="text-2xl font-extrabold tabular-nums text-text-primary">{totalText(yearly) || '...'}</p></div>
        <p className="text-[12px] text-text-secondary">Per year<br /><span className={`text-[12px] font-semibold ${calculated ? 'text-ok-fg' : 'text-warning-fg'}`}>{statusLabel(calculated)}</span></p>
        <div className="ms-auto flex items-center gap-3">
          <p className="text-[13px] font-semibold text-text-primary">{ATTRIBUTION.label}</p>
          <Controls row ask={CREDIT} value={answers.attribution_pct} onChange={onCredit} currency={answers.currency} />
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {plan.drivers.map((d) => {
          const on = Boolean(answers.drivers[d.id]?.on);
          const part = partOf(yearly, d.id);
          return (
            <div key={d.id} data-tile={d.id} className={`flex min-h-[64px] flex-col gap-0 rounded-lg border px-2.5 py-0.5 ${open === d.id ? 'border-primary-solid ring-1 ring-db-red-solid' : 'border-border'} ${on ? '' : 'bg-bg-subtle text-text-tertiary'}`}>
              <div className="flex items-start gap-1.5">
                <input type="checkbox" aria-label={`Include ${d.label}`} checked={on} onChange={() => onToggleDriver(d.id)} className="mt-0.5" />
                <span aria-hidden="true">{DRIVER_ICONS[d.id] || ''}</span>
                <span className="min-w-0 flex-1 text-[12px] font-semibold leading-[1.15]">{d.label}</span>
              </div>
              <p className="mt-auto text-base font-extrabold tabular-nums">{on ? (part ? <>{moneyText(unit, part.amount)}<span className="text-[10px] font-normal text-text-secondary"> a year</span></> : '...') : 'off'}</p>
              <button type="button" disabled={!on} onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={open === d.id}
                className="text-start text-[12px] font-semibold leading-tight text-db-red-solid disabled:opacity-40">Edit numbers</button>
            </div>
          );
        })}
      </div>
      {opened && answers.drivers[opened.id]?.on && (
        <div data-editor={opened.id} className="space-y-1.5 rounded-lg border border-primary-solid px-3 py-2">
          <p className="text-[13px] font-semibold text-text-primary">{opened.label}</p>
          <FormulaLine driver={opened} answers={answers} yearly={yearly} status={status} />
          <div className="grid grid-cols-2 gap-1.5">
            {opened.asks.map((a) => (
              <Ask key={a.id} ask={a} compact value={answers.drivers[opened.id].inputs[a.id]} currency={answers.currency || yearly?.currency}
                dataValue={partOf(yearly, opened.id)?.inputs?.find((i) => i.id === a.id)?.value} onChange={(v) => onInput(opened.id, a.id, v)} />
            ))}
          </div>
        </div>
      )}
      <div data-accept-summary="" className="rounded-lg border border-border px-3 py-1 text-[12px] leading-[1.15] text-text-primary">
        <p className="text-[12px] font-semibold">Every number in this value</p>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-0">
          {driversOn(plan, answers).map((d) => {
            const part = partOf(yearly, d.id);
            return (
              <li key={d.id}>
                <span className="font-semibold">{d.label}</span>: {part ? `${moneyText(unit, part.amount)} a year` : '...'}
                {(part?.inputs || []).length > 0 && <span className="text-text-secondary"> ({part.inputs.map((i) => `${i.label} ${figureText(i.kind, i.value, answers.currency || yearly?.currency)}`).join('; ')})</span>}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <p>Share caused by this use case: <span className="font-semibold">{Number(answers.attribution_pct ?? 100)}%</span>
            {answers.confidence && <span className="ms-4">Confidence: <span className="font-semibold capitalize">{answers.confidence}</span></span>}</p>
          <p className="font-semibold">{yearly?.verb || 'Value'} per year: {totalText(yearly) || '...'} ({statusLabel(calculated)})</p>
        </div>
      </div>
      <div data-accept-terms="" className="rounded-lg border-2 border-warning bg-warning-bg px-3 py-1">
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <TermsHeading />
          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-text-primary">
            <input type="checkbox" checked={accepted} onChange={(e) => onAccept?.(e.target.checked)} className="h-4 w-4" />
            I have read and accept these terms
          </label>
        </div>
        <p data-value-disclaimer="" role="note" className="text-[12px] leading-snug text-text-primary">{VALUE_DISCLAIMER}</p>
      </div>
      {children}
    </div>
  );
}
