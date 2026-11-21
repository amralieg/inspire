import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { valueChips } from '../lib/valueLedger';
import { VALUE_DISCLAIMER } from '../lib/valueLabels';

// REQ-438: the value box beside the Inspire score box on a card. Same size as the score box. States: none, estimated, calculated,
// out of date (stale), no data. Pure display: the numbers come from the server (answers, totals), never from a formula here.
const stop = (e) => e.stopPropagation();
export const BOX = 'relative flex h-[6.25rem] w-[8.5rem] shrink-0 flex-col items-center justify-center rounded-xl border-2 text-center leading-tight';

export const moneyText = (unit, amount) => valueChips([{ kind: 'money', unit: unit || 'USD', amount: Number(amount) }]).shown[0]?.text || '';

// What the box shows, from the best source: the saved shape-2 value, then an old-shape value, then the totals row.
export function boxModel({ yearly = null, summary = null, status = '' } = {}) {
  const st = status || summary?.status || '';
  if (st === 'no_data') return { state: 'no_data' };
  const pick = (verb, unit, amount, calculated, stale = false) => ({ state: stale ? 'stale' : calculated ? 'calculated' : 'estimated', verb, unit, amount: Number(amount), calculated, stale });
  if (yearly?.total && Number.isFinite(Number(yearly.total.amount))) {
    return pick(yearly.verb, yearly.total.unit, yearly.total.amount, Boolean(yearly.calculated), Boolean(yearly.stale));
  }
  const first = Array.isArray(yearly?.entries) ? valueChips(yearly.entries, 1).shown[0] : null;
  if (first) return pick(yearly.verb, first.unit, first.amount, false);
  if (summary && (st === 'calculated' || st === 'estimated') && Number.isFinite(Number(summary.amount))) {
    return pick(summary.verb, summary.currency, summary.amount, st === 'calculated');
  }
  return { state: 'none' };
}

// The amount counts up to a new figure over half a second (no motion when the person asks for less).
function useCountUp(target) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (from.current === target) return undefined;
    const start = from.current;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { from.current = target; setShown(target); return undefined; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 500);
      setShown(start + (target - start) * k);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target]);
  return shown;
}

const TAGS = {
  calculated: ['✓ CHECKED', 'border-success/40 bg-success-bg text-success-fg'],
  estimated: ['ESTIMATE', 'border-warning/40 bg-warning-bg text-warning-fg'],
  stale: ['DATA CHANGED', 'border-warning/40 bg-warning-bg text-warning-fg'],
};

export default function ValueBox({ yearly = null, summary = null, status = '', canCalculate = false, onCalculate, onEdit, readOnly = false }) {
  const m = boxModel({ yearly, summary, status });
  const amount = useCountUp(m.amount ?? 0);
  const last = useRef(m.amount);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (last.current !== m.amount && last.current != null && m.amount != null) { setPulse(true); const t = setTimeout(() => setPulse(false), 1400); last.current = m.amount; return () => clearTimeout(t); }
    last.current = m.amount;
    return undefined;
  }, [m.amount]);
  if (m.state === 'no_data') {
    return <div data-value-box="" data-value-state="no_data" className={`${BOX} border-border bg-bg-subtle text-text-tertiary`}><span className="px-2 text-[11px]">No data to count</span></div>;
  }
  if (m.state === 'none') {
    if (!canCalculate || readOnly) return null;
    return (
      <button type="button" data-value-box="" data-value-state="none" data-value-calculate="" onClick={(e) => { e.stopPropagation(); onCalculate?.(); }} onKeyDown={stop}
        className={`${BOX} cursor-pointer border-dashed border-db-red/40 bg-surface hover:bg-db-red-50`}>
        <span className="text-[22px] leading-none text-db-red-fg">+</span>
        <span className="text-[11px] font-semibold text-db-red-fg">Calculate value</span>
        <span className="text-[10px] text-text-secondary">at stake</span>
      </button>
    );
  }
  const grow = /GROW/i.test(m.verb || '');
  const edge = grow ? 'border-success' : 'border-db-red-solid';
  const amt = grow ? 'text-success-fg' : 'text-db-red-fg';
  const [tag, tagCls] = TAGS[m.state];
  const text = moneyText(m.unit, amount);
  return (
    <div data-value-box="" data-value-state={m.state} data-value-yearly="" title={VALUE_DISCLAIMER} onClick={stop} onKeyDown={stop}
      className={`${BOX} ${edge} bg-surface ${pulse ? 'animate-pulse' : ''}`}>
      <span data-value-verb="" className="text-[11px] tracking-wide text-text-primary">{m.verb}</span>
      <span data-value-amount="" className={`text-[22px] font-extrabold tabular-nums ${amt}`}>{text}</span>
      <span data-value-qualifier="" className="text-[10px] text-text-secondary">{m.calculated ? '(calculated)' : '(estimated)'}</span>
      <span data-value-period="" className="text-[10px] text-text-secondary">Per year</span>
      {!readOnly && onEdit && (
        <button type="button" data-value-edit="" aria-label="Edit value" title="Edit value" onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="absolute -right-2.5 -top-2.5 flex h-[26px] w-[26px] items-center justify-center rounded-full border border-border bg-surface text-text-secondary shadow hover:border-db-red-solid hover:text-db-red-fg">
          <Pencil size={13} />
        </button>
      )}
      <span data-value-tag="" className={`absolute -bottom-2.5 rounded-full border px-2 py-px text-[9px] font-bold tracking-wide ${tagCls}`}>{tag}</span>
    </div>
  );
}
