import { useEffect, useState } from 'react';
import { figureText, isBad, sliderRange } from '../../lib/valueWizard.js';

// REQ-436: a slider and a number box of one width, synced both ways. A typed value above the range grows the slider.
const WIDTH = 'w-28';

export function Controls({ ask, value, onChange, range }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft((d) => (Number(d) === Number(value) && d !== '' ? d : String(value))); }, [value]);
  const r = range || sliderRange(ask.kind, ask.default, value);
  const bad = isBad(ask, draft);
  const type = (text) => {
    setDraft(text);
    if (!isBad(ask, text)) onChange(Number(text));
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <input type="range" aria-label={`${ask.label} slider`} min={r.min} max={Math.max(r.max, Number(value) || 0)} step={r.step} value={Number(value) || 0}
        onChange={(e) => type(e.target.value)} className={`${WIDTH} m-0 accent-[var(--color-db-red-solid,#c4161c)]`} />
      <input type="number" aria-label={ask.label} min={0} step="any" value={draft} aria-invalid={bad} onChange={(e) => type(e.target.value)}
        className={`${WIDTH} rounded-md border px-2 py-1 text-end text-sm tabular-nums ${bad ? 'border-error bg-error-bg' : 'border-border'}`} />
    </div>
  );
}

// One ask of a kind: its question and why on the left; a green figure from the data, or the slider and number box of an estimate.
export default function Ask({ ask, value, onChange, dataValue, currency, compact = false }) {
  const fromData = ask.source === 'data';
  return (
    <div data-ask={ask.id} className={`grid items-center gap-x-3 gap-y-0.5 rounded-lg border border-border ${compact ? 'grid-cols-[1fr_auto] px-2.5 py-1.5' : 'grid-cols-[1fr_auto] px-3 py-2'}`}>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-text-primary">{ask.label}</p>
        <p className="text-[12px] text-text-secondary">{fromData ? 'Read from your data.' : ask.why}</p>
      </div>
      {fromData ? (
        <span data-from-data="" className="rounded-md border border-ok/30 bg-ok-bg px-2 py-1 text-sm font-semibold tabular-nums text-ok-fg">{figureText(ask.kind, dataValue, currency) || '...'}</span>
      ) : (
        <span data-estimate="" className="rounded-md"><Controls ask={ask} value={value} onChange={onChange} /></span>
      )}
    </div>
  );
}
