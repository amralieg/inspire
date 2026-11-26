import { useState } from 'react';
import TermsHeading from '../value/TermsHeading';
import { driversOn, figureText, moneyText, partOf, totalText } from '../../lib/valueWizard.js';
import { VALUE_DISCLAIMER, statusLabel } from '../../lib/valueLabels';

// REQ-544, step 5: the terms, a read-only line per ticked kind with the total, the Accept tick and "Accept and save" (the one PUT). After the
// save the same page shows the total and its status, and the children (range note, history with undo). Numbers are edited on the earlier steps.
export default function StepSave({ plan, answers, yearly, calculated, saved = false, busy = false, onAccept, children }) {
  const [accepted, setAccepted] = useState(false);
  const [include, setInclude] = useState(answers.story?.include_in_docs !== false);
  const unit = yearly?.total?.unit;
  return (
    <div data-wizard-page={saved ? 'save' : 'terms'} className="space-y-1.5">
      <div data-save-total="" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-subtle px-4 py-1">
        <div><p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">{yearly?.verb || 'Value'}</p>
          <p className="text-2xl font-extrabold tabular-nums text-text-primary">{totalText(yearly) || '...'}</p></div>
        <p className="text-[12px] text-text-secondary">Per year<br /><span className={`text-[12px] font-semibold ${calculated ? 'text-ok-fg' : 'text-warning-fg'}`}>{statusLabel(calculated)}</span></p>
      </div>
      <div data-accept-summary="" className="rounded-lg border border-border px-3 py-1 text-[12px] leading-[1.15] text-text-primary">
        <p className="text-[12px] font-semibold">Every kind in this value</p>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-0">
          {driversOn(plan, answers).map((d) => {
            const part = partOf(yearly, d.id);
            return (
              <li key={d.id} data-kind-amount-row={d.id}>
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
          {!saved && (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-text-primary">
              <input type="checkbox" data-value-accept="" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="h-4 w-4" />
              I have read and accept these terms
            </label>
          )}
        </div>
        <p data-value-disclaimer="" role="note" className="text-[12px] leading-snug text-text-primary">{VALUE_DISCLAIMER}</p>
      </div>
      {!saved && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text-primary">
            <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} className="h-4 w-4" />
            Include this story in generated docs
          </label>
          <button type="button" disabled={!accepted || busy} onClick={() => onAccept({ include })} aria-describedby={accepted ? undefined : 'story-tick-hint'}
            className="ms-auto rounded-lg bg-primary-solid px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Accept and save</button>
          {!accepted && <p id="story-tick-hint" className="w-full text-xs text-text-secondary">Tick accept to proceed</p>}
        </div>
      )}
      {children}
    </div>
  );
}
