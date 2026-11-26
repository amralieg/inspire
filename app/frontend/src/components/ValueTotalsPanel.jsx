import { useLayoutEffect, useRef, useState } from 'react';
import { moneyText } from './ValueBox';
import { ValueCheckNote } from './ValueCheckNote';
import ValueDisclaimer from './ValueDisclaimer';
import Badge from './ui/Badge';
import { valueChips } from '../lib/valueLedger';
import { plural as pluralOf } from '../lib/plural';
import { STATUS_LABELS, statusCounts, statusLabelOf } from '../lib/valueLabels';

// REQ-439: a total box, a calculated vs estimated bar, a second bar, and a table. Used for one run and for all runs.
// Amounts are per currency; two currencies show two totals, never one converted number.
const GREEN = 'color-mix(in srgb, var(--color-success) 70%, black)';
const AMBER = 'var(--color-warning)';
const PALETTE = ['var(--color-error-solid)', 'color-mix(in srgb, var(--color-info) 80%, black)', 'color-mix(in srgb, color-mix(in srgb, var(--color-info) 50%, var(--color-error-solid)) 80%, black)', 'color-mix(in srgb, color-mix(in srgb, var(--color-info) 50%, var(--color-success)) 75%, black)', 'color-mix(in srgb, var(--color-warning) 60%, black)'];

// FX-34 (W16 D1/D8): a segment label that does not fit its segment is hidden; the tooltip and the legend under the bar carry it.
// The first render guesses from the text length (the bar is at most 576px wide); after layout the real widths decide.
const BAR_PX = 576;
const CHAR_PX = 6.5;
const guessHidden = (p, total) => `${p.name} ${p.text}`.length * CHAR_PX + 8 > (p.value / total) * BAR_PX;

export function Bar({ parts, label }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const ref = useRef(null);
  const [tooWide, setTooWide] = useState({});
  useLayoutEffect(() => {
    const measure = () => {
      const next = {};
      for (const seg of ref.current?.querySelectorAll('[data-bar-segment]') || []) {
        const text = seg.querySelector('[data-bar-label]');
        if (text && text.scrollWidth > seg.clientWidth) next[seg.getAttribute('data-bar-segment')] = true;
      }
      setTooWide((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [parts, total]);
  return (
    <div className="mt-2">
      <p className="text-caption text-text-secondary">{label}</p>
      <div ref={ref} role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${p.text}`).join(', ')}`} className="mt-0.5 flex h-6 w-full max-w-xl overflow-hidden rounded-md bg-bg-subtle">
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => {
          const hidden = guessHidden(p, total) || Boolean(tooWide[p.name]);
          return (
            <div key={p.name} data-bar-segment={p.name} data-label-hidden={hidden ? 'true' : 'false'} title={`${p.name} ${p.text}`}
              style={{ width: `${(100 * p.value) / total}%`, background: p.color }} className="flex min-w-0 items-center justify-center overflow-hidden px-1 text-caption text-white">
              <span data-bar-label="" className="whitespace-nowrap" style={hidden ? { visibility: 'hidden' } : undefined}>{p.name} {p.text}</span>
            </div>
          );
        })}
      </div>
      <p data-bar-legend={label} className="mt-0.5 flex flex-wrap gap-x-3 text-caption text-text-secondary">
        {parts.map((p) => (
          <span key={p.name} className="inline-flex items-center gap-1"><span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />{`${p.name} ${p.text}`}</span>
        ))}
      </p>
    </div>
  );
}

export function TotalBox({ label, totals, sub }) {
  return (
    <div data-value-total="" className="flex min-w-[9rem] flex-col items-center justify-center rounded-xl border-2 border-primary-solid bg-surface px-4 py-3 text-center">
      <span className="text-caption tracking-wide text-text-primary">{label}</span>
      {totals.length ? totals.map((t) => <span key={t.currency} data-total-amount="" className="text-[22px] font-extrabold tabular-nums text-db-red-fg">{moneyText(t.currency, t.amount)}</span>)
        : <span data-total-amount="" className="text-[22px] font-extrabold text-text-tertiary">None yet</span>}
      <span className="text-caption text-text-secondary">{sub}</span>
      <span className="text-caption text-text-secondary">Per year</span>
    </div>
  );
}

const TEAL = 'color-mix(in srgb, color-mix(in srgb, var(--color-info) 50%, var(--color-success)) 75%, black)';
// FX-34 (W16 D8): the bar shows every share of the total: calculated, estimated and, when there is one, measured.
const split = (totals) => totals.flatMap((t) => {
  const tag = totals.length > 1 ? ` ${t.currency}` : '';
  const part = (name, f, color) => ({ name: `${name}${tag}`, value: Number(t[f]) || 0, text: moneyText(t.currency, Number(t[f]) || 0), color });
  return [part(STATUS_LABELS.calculated, 'calculated', GREEN), part(STATUS_LABELS.estimated, 'estimated', AMBER), ...(Number(t.measured) > 0 ? [part('Measured', 'measured', TEAL)] : [])];
});

const PILL = { calculated: 'bg-success-bg text-success-fg', measured: 'bg-success-bg text-success-fg', estimated: 'bg-warning-bg text-warning-fg', not_estimated: 'bg-warning-bg text-warning-fg' };
const STATUS = { calculated: STATUS_LABELS.calculated.toLowerCase(), measured: 'measured', estimated: STATUS_LABELS.estimated.toLowerCase(), no_data: 'no data', not_estimated: 'not estimated' };

const plural = (n, one, many) => (n === 1 ? one : many);

// REQ-448, REQ-454: what the total leaves out and what it counts once.
function CountNotes({ run }) {
  const out = (run.excluded || []).reduce((s, e) => s + (Number(e.n) || 0), 0);
  const shared = Number(run.n_shared) || 0;
  if (!out && !shared) return null;
  return (
    <div data-value-count-notes="" className="mt-2 text-caption text-text-secondary">
      {out > 0 && <p>{`${out} ${plural(out, 'estimate', 'estimates')} outside $100K to $100M not counted: check the numbers`}</p>}
      {shared > 0 && <p>{`${shared} shared ${plural(shared, 'value', 'values')} counted once`}</p>}
    </div>
  );
}

// One run: run = C6 run block, useCases = C6 use_cases, nameOf(id), onRow(id).
export function RunValuePanel({ run, useCases, nameOf, onRow }) {
  const rows = Object.entries(useCases || {});
  const byVerb = (run.by_verb || []).map((v, k) => ({ name: v.verb, value: Number(v.amount) || 0, text: moneyText(v.currency, v.amount), color: PALETTE[k % PALETTE.length] }));
  return (
    <section aria-label="Business value this run's use cases could realize" data-value-run-panel="" className="mb-4 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-base font-bold text-text-primary">Business value this run&apos;s use cases could realize</h2>
      <p className="text-[12px] text-text-secondary">The sum of every use case&apos;s value in this run. Use cases with no value yet add nothing.</p>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <TotalBox label="BUSINESS VALUE" totals={run.totals || []} sub={statusCounts(run.n_calculated, run.n_estimated)} />
        <div className="min-w-0 flex-1">
          <RunValueKinds value={run} className="text-[12px] text-text-secondary" />
          <Bar parts={split(run.totals || [])} label={`${STATUS_LABELS.calculated}s vs ${STATUS_LABELS.estimated.toLowerCase()}s`} />
          <Bar parts={byVerb} label="By kind of value" />
          <CountNotes run={run} />
          <p className="mt-2 text-caption text-text-secondary">{`${pluralOf(run.n, 'use case')} · ${statusCounts(run.n_calculated, run.n_estimated)} · ${run.n_none} not worked out yet`}</p>
        </div>
      </div>
      <table className="mt-3 w-full text-[12px]">
        <thead><tr className="text-start text-text-secondary"><th className="text-start font-medium">Use case</th><th className="text-start font-medium">Kind</th><th className="text-start font-medium">Status</th><th className="text-end font-medium">Per year</th><th className="text-end font-medium" title="What this use case adds to the run total: a value that shares its pool of money with another adds $0">Counted in</th></tr></thead>
        <tbody>
          {rows.map(([id, u]) => (
            <tr key={id} data-value-row={id} onClick={() => onRow?.(id)} className="cursor-pointer border-t border-border/60 hover:bg-bg-subtle">
              <td className="py-1">{nameOf?.(id) || id}
                {u.overlap && u.overlap.counted === false && <span data-value-shared="" className="block text-caption text-text-secondary">{`Shared with ${nameOf?.(u.overlap.with) || u.overlap.with}, counted once`}</span>}
                {u.overlap && u.overlap.counted === true && <span data-value-shared="" className="block text-caption text-text-secondary">{`Also counted for ${u.overlap.shared_with.length} other ${plural(u.overlap.shared_with.length, 'use case', 'use cases')}`}</span>}
              </td>
              <td className="text-text-secondary">{u.verb || ''}</td>
              <td><span title={u.reason || undefined} className={`rounded-full px-2 py-px text-caption ${PILL[u.status] || 'bg-bg-subtle text-text-secondary'}`}>{STATUS[u.status] || 'not yet'}</span></td>
              <td className="text-end tabular-nums">{u.amount != null ? moneyText(u.currency, u.amount) : 'Not calculated'}
                {u.check && <span className="block"><ValueCheckNote check={u.check} notCounted={u.counted === false} /></span>}
                {u.reason && <span data-value-reason="" className="block text-caption text-text-secondary">{u.reason}</span>}
              </td>
              <td className="text-end tabular-nums">{u.amount != null && Number.isFinite(Number(u.counted_amount))
                ? <span data-value-counted="">{moneyText(u.currency, u.counted_amount)}</span> : ''}</td>
            </tr>
          ))}
          <tr data-value-run-total="" className="border-t-2 border-border font-bold"><td className="py-1">Run total</td><td /><td /><td />
            <td className="text-end tabular-nums"><RunValueTotal value={run} />
              {run.review?.reason && <span data-run-review-reason="" className="block text-caption font-normal text-text-secondary">{run.review.reason}</span>}</td></tr>
        </tbody>
      </table>
      <ValueDisclaimer className="mt-2" />
    </section>
  );
}

// All runs: reply = C6 without session_id: { runs, all, truncated }. REQ-487: the number only, no per-run list.
export function AllRunsValuePanel({ reply }) {
  const all = reply.all || { totals: [] };
  return (
    <section aria-label="Value across runs" data-value-all-panel="" data-value-overall="" className="mb-4 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-base font-bold text-text-primary">Business value across all runs</h2>
      {reply.truncated && <p className="text-[12px] text-text-secondary">{`Showing the newest ${reply.cap || (reply.runs || []).length} runs only.`}</p>}
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <TotalBox label="ALL RUNS" totals={all.totals || []} sub={statusCounts(all.n_calculated ?? 0, all.n_estimated ?? 0)} />
        <div className="min-w-0 flex-1">
          <RunValueKinds value={all} className="text-[12px] text-text-secondary" />
        </div>
      </div>
      <ValueDisclaimer className="mt-2" />
    </section>
  );
}

// FX-34b (REQ-078, REQ-096, REQ-451): what the run value also says: what the MVPs saved, the non-money kinds (hours, counts) and how many
// MVPs it is from. Nothing renders for a run with no measured MVP.
export function RunValueKinds({ value, className = '' }) {
  const saved = valueChips(value?.saved, Infinity).shown;
  const chips = valueChips(value?.kinds, Infinity).shown;
  const mvps = Number(value?.n_mvps) || 0;
  if (!saved.length && !chips.length && !mvps) return null;
  return (
    <span data-value-kinds="" className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {saved.length > 0 && <span>Saved <span data-value-headline="saved" className="font-bold tabular-nums text-success-fg">{saved.map((c) => c.text).join(' + ')}</span></span>}
      {chips.map((c) => <span key={`${c.kind}:${c.unit}`} data-value-chip={c.unit} data-value-kind={c.kind} className="rounded-md border border-border px-1.5 py-0.5 tabular-nums">{c.text}</span>)}
      {mvps > 0 && <span data-value-mvps="">{`from ${pluralOf(mvps, 'MVP')}`}</span>}
    </span>
  );
}

// FX-34 (W16 D2/D3/D9): one line for the value of a run, from the run value the server computes once (valueTotals.runValueOf).
// The Start bars, the run card and the Review header all render it, so they cannot disagree.
export function RunValueTotal({ value, red = false }) {
  const totals = value?.totals || [];
  if (!totals.length) return <Badge data-run-value-state="not-calculated">Not calculated</Badge>;
  // Green when the total is calculated, amber when any of it is only estimated.
  const calculated = Number(value?.n_calculated) > 0 && !(Number(value?.n_estimated) > 0);
  return (
    <span data-run-value-total="" data-run-value-state={calculated ? 'calculated' : 'estimated'} className={red ? 'text-white' : calculated ? 'text-success-fg' : 'text-warning-fg'}>
      {totals.map((t) => moneyText(t.currency, t.amount)).join(' + ')}
      {value?.review && value.review.ai_checked === false && <span data-run-not-ai-checked="" className="ms-1 text-caption font-normal text-text-secondary">Not checked by AI</span>}
    </span>
  );
}

// REQ-488: the run's total in a red-themed box (the ALL RUNS box, smaller). The green/amber dot and word say calculated or estimated.
export function RunValueLine({ value, label = 'Business value at stake', className = '' }) {
  const totals = value?.totals || [];
  const calculated = Number(value?.n_calculated) > 0 && !(Number(value?.n_estimated) > 0);
  const n = value ? statusCounts(value.n_calculated ?? 0, value.n_estimated ?? 0) : '';
  return (
    <div data-run-value="" className={`text-caption text-text-secondary ${className}`}>
      {totals.length > 0 ? (
        <div data-run-value-box="" className="inline-flex min-w-[8rem] flex-col rounded-lg border-2 border-primary-solid bg-primary-solid px-3 py-1.5 text-white">
          <span className="font-semibold uppercase tracking-wide text-white">{label}</span>
          <span className="text-[18px] font-extrabold tabular-nums"><RunValueTotal value={value} red /></span>
          <span className="inline-flex items-center gap-1 text-caption text-white">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full ring-2 ring-white" style={{ background: calculated ? GREEN : AMBER }} />{statusLabelOf(calculated ? 'calculated' : 'estimated').toLowerCase()}
            <span>{`(${n})`}</span>
          </span>
        </div>
      ) : (
        <div data-run-value-box="" className="inline-flex min-w-[8rem] flex-col gap-1 rounded-lg border-2 border-dashed border-primary-solid bg-surface px-3 py-1.5">
          <span className="font-semibold uppercase tracking-wide text-text-primary">{label}</span>
          <RunValueTotal value={value} />
        </div>
      )}
      {totals.length > 0 && <div className="mt-1"><ValueDisclaimer short /></div>}
      <RunValueKinds value={value} className="mt-1" />
    </div>
  );
}
