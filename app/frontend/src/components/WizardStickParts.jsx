import {
  CAPACITY_BLURB,
  CAPACITY_LABEL,
  DIGEST_BLURB,
  DIGEST_LABEL,
  DIGEST_NOBODY,
  alertReaches,
  capacityDiffers,
  capacityInput,
  capacityNote,
  capacityProblems,
  capacitySummaryText,
  clearsOn,
  digestOn,
  grainText,
} from '../lib/implementWizard';
import { CLEARS_HINT, CLEARS_LABEL } from '../lib/useCaseAlerts';

export function TeamCapacity({ spec, suggestion, inputClass, onType, onSuggest }) {
  const problem = capacityProblems(spec)[0] || '';
  const value = capacityInput(spec);
  return (
    <fieldset className="space-y-2" aria-label="Team capacity">
      <legend className="text-sm font-semibold text-text-primary">Team capacity</legend>
      <label className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
        {CAPACITY_LABEL}
        <input
          type="text"
          inputMode="numeric"
          aria-label={CAPACITY_LABEL}
          className={`${inputClass} w-28`}
          value={value}
          placeholder="No cap"
          onChange={(e) => onType(e.target.value)}
        />
      </label>
      <p className="text-[11px] text-text-secondary">{CAPACITY_BLURB}</p>
      <p className="text-[11px] text-text-tertiary" data-capacity-basis="">
        {capacityNote(spec, suggestion)}{suggestion.basis}
      </p>
      {capacityDiffers(spec, suggestion) && (
        <button type="button" className="text-[11px] text-db-red-fg" onClick={onSuggest}>
          {suggestion.act_now == null ? 'Use Inspire\u2019s suggestion: no cap'
            : `Use Inspire\u2019s suggestion: ${suggestion.act_now.toLocaleString('en-US')}`}
        </button>
      )}
      {problem
        ? <p className="text-[11px] text-error-fg">{problem}</p>
        : <p className="text-[11px] text-text-secondary" data-capacity-summary="">{capacitySummaryText(spec)}</p>}
    </fieldset>
  );
}

export function RowSubjectCheck({ check, options, chosen, inputClass, onPick }) {
  const text = grainText(check);
  if (!text && !options.length) return null;
  const warn = check.state === 'mismatch' && !check.row.chosen;
  const picks = chosen && !options.some((o) => o.ref === chosen) ? [{ ref: chosen }, ...options] : options;
  return (
    <section
      aria-label="What one row means"
      data-grain={check.state}
      className={`space-y-2 rounded-lg border px-3 py-2.5 ${warn ? 'border-warning/40 bg-warning-bg' : 'border-border'}`}
    >
      <h3 className="text-sm font-semibold text-text-primary">What one row of the result means</h3>
      {text && <p role="status" className={`text-[12px] ${warn ? 'text-warning-fg' : 'text-text-secondary'}`}>{text}</p>}
      {check.state === 'mismatch' && (
        <div className="flex flex-wrap gap-3 text-[11px]">
          {check.suggest && (
            <button type="button" className="text-db-red-fg font-medium" onClick={() => onPick(check.suggest.ref)}>
              Group by {check.suggest.column}
            </button>
          )}
          {!check.row.chosen && (
            <button type="button" className="text-text-secondary hover:text-text-primary" onClick={() => onPick(check.row.ref)}>
              Keep one row per {check.rowNoun}
            </button>
          )}
        </div>
      )}
      <label className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
        Entity key
        <select aria-label="Entity key" className={`${inputClass} w-auto`} value={chosen || ''} onChange={(e) => onPick(e.target.value)}>
          <option value="">Inspire&apos;s choice</option>
          {picks.map((o) => <option key={o.ref} value={o.ref}>{o.ref}</option>)}
        </select>
      </label>
      <p className="text-[11px] text-text-tertiary">Your pick is saved with the MVP, and Genie builds one row of the result per value of it.</p>
    </section>
  );
}

function AlertEmailChoice({ outputs, label, blurb, on, onChange, className }) {
  const reached = alertReaches(outputs);
  return (
    <label className={`${className} flex items-start gap-2 text-[11px] text-text-secondary`}>
      <input type="checkbox" className="mt-0.5" checked={on(outputs)} disabled={!reached} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium text-text-primary">{label}</span>. {reached ? blurb : DIGEST_NOBODY}
      </span>
    </label>
  );
}

export function DigestChoice({ outputs, onChange }) {
  return <AlertEmailChoice className="pl-7" outputs={outputs} label={DIGEST_LABEL} blurb={DIGEST_BLURB} on={digestOn} onChange={onChange} />;
}

export function ClearsChoice({ outputs, onChange }) {
  return <AlertEmailChoice className="" outputs={outputs} label={CLEARS_LABEL} blurb={CLEARS_HINT} on={clearsOn} onChange={onChange} />;
}
