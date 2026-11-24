import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { valueChips } from '../lib/valueLedger';
import { VALUE_DISCLAIMER, statusLabel, threeDigits } from '../lib/valueLabels';
import { ValueCheckNote } from './ValueCheckNote.jsx';

// REQ-438: the value box beside the Inspire score box on a card. Same size as the score box. States: none, estimated, calculated,
// out of date (stale), no data. Pure display: the numbers come from the server (answers, totals), never from a formula here.
const stop = (e) => e.stopPropagation();
export const BOX = 'relative flex h-[6.25rem] w-[8.5rem] shrink-0 flex-col items-center justify-center rounded-xl border-2 text-center leading-tight';

// REQ-516: the Review row's compact box, the same size for the score and the value.
export const ROW_BOX = 'relative flex h-[5.25rem] w-[7.5rem] shrink-0 flex-col items-center justify-center rounded-xl border-2 text-center leading-tight';

// REQ-432: an amount carries three significant digits at most ($405,556 reads $406K).
export const moneyText = (unit, amount) => valueChips([{ kind: 'money', unit: unit || 'USD', amount: threeDigits(Number(amount)) }]).shown[0]?.text || '';

// What the box shows, from the best source: the saved shape-2 value, then an old-shape value, then the totals row.
export function boxModel({ yearly = null, summary = null, status = '' } = {}) {
  const st = status || summary?.status || '';
  if (st === 'no_data') return { state: 'no_data' };
  // FX-34 (REQ-448, W16 D5/D18): an estimate saved before Inspire planned each use case on its own data is never shown as current.
  // A value calculated since (the saved yearly says so) wins over the totals read that has not caught up yet.
  if (st === 'not_estimated' && !yearly?.calculated) return { state: 'not_estimated', reason: summary?.reason || '' };
  const pick = (verb, unit, amount, calculated, stale = false) => ({ state: stale ? 'stale' : calculated ? 'calculated' : 'estimated', verb, unit, amount: Number(amount), calculated, stale });
  // REQ-440: the MVP's measured money wins over a saved or estimated value.
  if (st === 'measured' && summary && Number.isFinite(Number(summary.amount))) return { state: 'measured', verb: summary.verb, unit: summary.currency, amount: Number(summary.amount), calculated: false, stale: false };
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
  calculated: ['✓ REVIEWED', 'border-success/40 bg-success-bg text-success-fg'],
  estimated: ['PROVISIONAL', 'border-warning/40 bg-warning-bg text-warning-fg'],
  measured: ['MEASURED', 'border-success/40 bg-success-bg text-success-fg'],
  stale: ['DATA CHANGED', 'border-warning/40 bg-warning-bg text-warning-fg'],
};

// inset (REQ-511 A6 row): the edit pencil and the status pill sit inside the box, so nothing leaves it and the row keeps its height.
export default function ValueBox({ yearly = null, summary = null, status = '', canCalculate = false, onCalculate, onEdit, readOnly = false, inset = false }) {
  const m = boxModel({ yearly, summary, status });
  const SZ = inset ? ROW_BOX : BOX;
  const amount = useCountUp(m.amount ?? 0);
  const last = useRef(m.amount);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (last.current !== m.amount && last.current != null && m.amount != null) { setPulse(true); const t = setTimeout(() => setPulse(false), 1400); last.current = m.amount; return () => clearTimeout(t); }
    last.current = m.amount;
    return undefined;
  }, [m.amount]);
  if (m.state === 'no_data') {
    return <div data-value-box="" data-value-box-state="no_data" className={`${SZ} border-border bg-bg-subtle text-text-tertiary`}><span className="px-2 text-[11px]">No data to count</span></div>;
  }
  if (m.state === 'not_estimated') {
    const why = m.reason || 'This use case has no estimate of its own yet.';
    if (!canCalculate || readOnly) {
      return <div data-value-box="" data-value-box-state="not_estimated" title={why} className={`${SZ} border-border bg-bg-subtle text-text-secondary`}><span className="px-2 text-[11px]">Not estimated</span></div>;
    }
    return (
      <button type="button" data-value-box="" data-value-box-state="not_estimated" data-value-calculate="" title={why} onClick={(e) => { e.stopPropagation(); onCalculate?.(); }} onKeyDown={stop}
        className={`${SZ} cursor-pointer border-dashed border-warning/60 bg-surface hover:bg-warning-bg`}>
        <span className="text-[11px] font-semibold text-text-primary">Not estimated</span>
        <span className="text-[11px] font-semibold text-db-red-fg">Calculate again</span>
      </button>
    );
  }
  if (m.state === 'none') {
    if (!canCalculate || readOnly) return null;
    return (
      <button type="button" data-value-box="" data-value-box-state="none" data-value-calculate="" onClick={(e) => { e.stopPropagation(); onCalculate?.(); }} onKeyDown={stop}
        className={`${SZ} cursor-pointer border-dashed border-db-red/40 bg-surface hover:bg-db-red-50`}>
        <span className="text-[22px] leading-none text-db-red-fg">+</span>
        <span className="text-[11px] font-semibold text-db-red-fg">Calculate value</span>
        <span className="text-[10px] text-text-secondary">at stake</span>
      </button>
    );
  }
  const grow = /GROW/i.test(m.verb || '');
  // REQ-516: in the Review row the box is filled with the primary token and the figure is white (dark mode keeps the light red so white stays above 4.5:1).
  const fill = inset ? 'border-db-red-solid bg-db-red-solid text-white dark:border-[#D42A15] dark:bg-[#D42A15]' : `${grow ? 'border-success' : 'border-db-red-solid'} bg-surface`;
  const amt = inset ? 'text-white' : grow ? 'text-success-fg' : 'text-db-red-fg';
  const sub = inset ? 'text-white' : 'text-text-secondary';
  const [tag, tagCls] = TAGS[m.state];
  const text = moneyText(m.unit, amount);
  const note = <ValueCheckNote check={yearly?.check} notCounted={!m.calculated && m.state !== 'measured'} />;
  const box = (
    <div data-value-box="" data-value-box-state={m.state} data-value-yearly="" title={VALUE_DISCLAIMER} onClick={stop} onKeyDown={stop}
      className={`${SZ} ${fill} ${inset ? 'pb-3' : ''} ${pulse ? 'animate-pulse' : ''}`}>
      <span data-value-verb="" className={`${inset ? 'whitespace-nowrap text-[8.5px] font-semibold uppercase tracking-normal' : 'text-[11px] tracking-wide'} ${inset ? '' : 'text-text-primary'}`}>{m.verb}</span>
      <span data-value-amount="" className={`${inset ? 'text-[20px] leading-6' : 'text-[22px]'} font-extrabold tabular-nums ${amt}`}>{text}</span>
      <span data-value-qualifier="" className={inset ? 'sr-only' : 'text-[10px] text-text-secondary'}>{m.state === 'measured' ? '(measured)' : statusLabel(m.calculated)}</span>
      <span data-value-period="" className={`text-[10px] ${sub}`}>Per year</span>
      {!readOnly && onEdit && m.state !== 'measured' && (
        <button type="button" data-value-edit="" aria-label="Edit value" title="Edit value" onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className={`absolute ${inset ? 'end-0.5 top-0.5 h-[16px] w-[16px]' : '-end-2.5 -top-2.5 h-[26px] w-[26px]'} flex items-center justify-center rounded-full border border-border bg-surface text-text-secondary shadow hover:border-db-red-solid hover:text-db-red-fg`}>
          <Pencil size={inset ? 9 : 13} />
        </button>
      )}
      <span data-value-tag="" className={`absolute ${inset ? 'bottom-1' : '-bottom-2.5'} rounded-full border px-2 py-px text-[9px] font-bold tracking-wide ${tagCls}`}>{tag}</span>
    </div>
  );
  // FX-38b (W16 D25): the note sits under the box, past the pill that overhangs its bottom edge, so it never covers the pill or leaves the box.
  if (!yearly?.check?.outside) return box;
  // REQ-511: in the row the pill sits inside the box, so the note goes one small gap below it and the row keeps the warning.
  if (inset) return <div className="flex flex-col items-center gap-3">{box}{note}</div>;
  return <div className="flex w-[8.5rem] shrink-0 flex-col items-center gap-3.5">{box}{note}</div>;
}
