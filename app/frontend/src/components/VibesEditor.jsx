import { useId, useLayoutEffect, useRef } from 'react';
import { VIBES_MAX, VIBE_PREVIOUS_DEFAULT, partOf, vibesLabel, vibesLength, vibesProblem } from '../lib/implementWizard';
import { bestVibePrevious } from '../lib/recommended';
import Recommended from './Recommended';

const PLACEHOLDERS = {
  mvp: 'For example: put the rows to act on first on the App, answer in euros in the Genie Agent, and count returns by week',
  notebook: 'For example: score the baseline and every model on the same held-out rows, and print each one\'s hit rate',
  dashboard: 'For example: put the weekly trend first and show the 20 rows to act on today',
  genie_space: 'For example: answer in plain words and always say which rows you counted',
  app: 'For example: one page, with the decision list on the left and the row detail on the right',
  alert: 'For example: only email me when a row to act on is new since the last run',
  app_page: 'For example: put the rows to act on first and add a filter by region',
  dashboard_chart: 'For example: make it a weekly bar chart and label each bar with its count',
  ai_reasoning: 'For example: explain each decision in one sentence that names the two columns behind it',
  value_formula: 'For example: price each row at its open order value times the chance it is lost',
};

const EXAMPLE_MAX_ROWS = 8;
export const VIBES_ROWS = 8;

function heightOfText(el, text) {
  const probe = el.cloneNode(false);
  probe.removeAttribute('id');
  probe.value = text;
  probe.rows = 1;
  Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', height: 'auto', minHeight: '0', width: `${el.offsetWidth}px` });
  el.parentNode.appendChild(probe);
  const need = probe.scrollHeight + probe.offsetHeight - probe.clientHeight;
  probe.value = '';
  probe.rows = EXAMPLE_MAX_ROWS;
  const most = probe.offsetHeight;
  probe.remove();
  return Math.min(need, most);
}

export function VibePrevious({ built, choices, value: picked, onPick }) {
  if (!choices.length) return null;
  const value = picked || VIBE_PREVIOUS_DEFAULT;
  return (
    <fieldset data-vibe-previous="" data-choice="vibe-previous" className="space-y-2">
      <legend className="text-[13px] font-semibold text-text-primary">What happens to v{built}?</legend>
      {choices.map((choice) => (
        <label key={choice.id}
          className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12px] cursor-pointer ${value === choice.id ? 'border-db-red/40 bg-bg-subtle' : 'border-border'}`}>
          <input type="radio" name="vibe-previous" value={choice.id} checked={value === choice.id} onChange={() => onPick(choice.id)} className="mt-0.5" />
          <span className="min-w-0">
            <span className="block font-semibold text-text-primary">{choice.label}</span>
            <span className="block text-text-secondary">{choice.text}</span>
            <Recommended best={bestVibePrevious(built)} id={choice.id} />
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export default function VibesEditor({ id, value, onChange, autoFocus = false, label = '', heading = '', disabled = false, placeholder = '', minPx = 0 }) {
  const hint = useId();
  const box = useId();
  const ref = useRef(null);
  const problem = vibesProblem(id, value, label);
  const example = placeholder || PLACEHOLDERS[partOf(id)?.kind || id];
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !example) return undefined;
    let frame = 0;
    const fit = () => {
      if (el.offsetWidth) el.style.minHeight = `${Math.max(minPx, heightOfText(el, example))}px`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    watch.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [example, minPx]);
  return (
    <div className="space-y-1">
      {heading && <label htmlFor={box} className="block text-[13px] font-semibold text-text-primary">{heading}</label>}
      <textarea dir="auto"
        ref={ref}
        id={box}
        aria-label={heading ? undefined : label ? `Vibes for the ${label}` : vibesLabel(id)}
        aria-describedby={hint}
        aria-invalid={problem ? 'true' : undefined}
        autoFocus={autoFocus}
        disabled={disabled}
        rows={VIBES_ROWS}
        value={value}
        placeholder={example}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-2.5 py-2 text-sm leading-snug border rounded-md bg-surface text-text-primary glow-focus resize-y max-h-[60vh] disabled:opacity-60 ${problem ? 'border-error' : 'border-border'}`}
      />
      <div className="flex items-start justify-between gap-3 text-[11px]">
        <p id={hint} className="text-error-fg">{problem}</p>
        <span data-vibes-count="" className={`shrink-0 tabular-nums ${problem ? 'font-semibold text-error-fg' : 'text-text-secondary'}`}>
          {vibesLength(value).toLocaleString('en-US')}/{VIBES_MAX.toLocaleString('en-US')}
        </span>
      </div>
    </div>
  );
}
