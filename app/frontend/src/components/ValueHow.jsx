import { useState } from 'react';
import ValueDisclaimer from './ValueDisclaimer';
import { moneyText } from './ValueBox';

// REQ-438: "How we got this number": each part of the value as its inputs joined by ×, green for data and amber for an estimate.
const stop = (e) => e.stopPropagation();
const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

function inputText(i, unit) {
  const v = Number(i.value);
  const body = i.kind === 'money' ? moneyText(unit, v) : i.kind === 'pct' ? `${num(v)}%` : i.kind === 'hours' ? `${num(v)} h` : num(v);
  return `${body} ${i.label || ''}`.trim();
}

const CHIP = { data: 'border-success/40 bg-success-bg text-success-fg', estimate: 'border-warning/40 bg-warning-bg text-warning-fg' };

export default function ValueHow({ yearly, onOpen }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(yearly?.parts) || !yearly.parts.length) return null;
  const unit = yearly.total?.unit || yearly.currency;
  const g = yearly.groups;
  const who = yearly.calculated
    ? `reviewed and accepted by ${yearly.saved_by || 'a person'}${yearly.saved_at ? ` at ${new Date(yearly.saved_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}${yearly.version ? ` (version ${yearly.version})` : ''}`
    : "Inspire's first estimate; nobody has checked the numbers yet";
  return (
    <div className="mt-1.5" onClick={stop} onKeyDown={stop}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-caption font-semibold text-db-red-fg hover:underline underline-offset-2">
        {`ⓘ How we got this number ${open ? '▴' : '▾'}`}
      </button>
      {open && (
        <div data-value-how="" className="mt-1.5 space-y-1.5 rounded-lg border border-border bg-bg-subtle px-3 py-2 text-caption text-text-secondary">
          {yearly.parts.map((p) => (
            <div key={p.id} data-how-part={p.id} className="flex flex-wrap items-center gap-1">
              <span className="font-semibold text-text-primary">{p.label}:</span>
              {(p.inputs || []).map((i, k) => (
                <span key={i.id || k} className="inline-flex items-center gap-1">
                  {k > 0 && <span aria-hidden="true">×</span>}
                  <span data-chip={i.source === 'data' ? 'data' : 'estimate'} title={i.source === 'data' ? 'Read from your data' : 'An estimate'}
                    className={`rounded-full border px-2 py-px ${CHIP[i.source === 'data' ? 'data' : 'estimate']}`}>{inputText(i, unit)}</span>
                </span>
              ))}
              <span className="font-semibold text-text-primary">{`= ${moneyText(unit, p.amount)}`}</span>
            </div>
          ))}
          <p>
            {`Counted per ${yearly.case_noun || 'record'}${g?.grouping_label ? `, ${String(g.grouping_label).toLowerCase()}` : ''}`}
            {g ? ` · ${g.covered} of ${g.of} groups covered` : ''}
            {yearly.attribution_pct != null ? ` · ${yearly.attribution_pct}% credited to this use case` : ''}
            {` · ${who}.`}
          </p>
          <p className="flex flex-wrap items-center gap-x-2">
            <ValueDisclaimer short />
            {onOpen && <button type="button" onClick={onOpen} className="font-semibold text-db-red-fg hover:underline underline-offset-2">Open the full calculation</button>}
          </p>
        </div>
      )}
    </div>
  );
}
