import { useLayoutEffect, useRef, useState } from 'react';
import { moneyText } from './ValueBox';
import { ValueCheckNote } from './ValueCheckNote';
import ValueDisclaimer from './ValueDisclaimer';

// REQ-439: a total box, a calculated vs estimated bar, a second bar, and a table. Used for one run and for all runs.
// Amounts are per currency; two currencies show two totals, never one converted number.
const GREEN = '#15803d';
const AMBER = '#f59e0b';
const PALETTE = ['#c4161c', '#2563eb', '#7c3aed', '#0d9488', '#b45309'];

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
      <p className="text-[11px] text-text-secondary">{label}</p>
      <div ref={ref} role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${p.text}`).join(', ')}`} className="mt-0.5 flex h-6 w-full max-w-xl overflow-hidden rounded-md bg-bg-subtle">
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => {
          const hidden = guessHidden(p, total) || Boolean(tooWide[p.name]);
          return (
            <div key={p.name} data-bar-segment={p.name} data-label-hidden={hidden ? 'true' : 'false'} title={`${p.name} ${p.text}`}
              style={{ width: `${(100 * p.value) / total}%`, background: p.color }} className="flex min-w-0 items-center justify-center overflow-hidden px-1 text-[10px] text-white">
              <span data-bar-label="" className="whitespace-nowrap" style={hidden ? { visibility: 'hidden' } : undefined}>{p.name} {p.text}</span>
            </div>
          );
        })}
      </div>
      <p data-bar-legend={label} className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-text-secondary">
        {parts.map((p) => (
          <span key={p.name} className="inline-flex items-center gap-1"><span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />{`${p.name} ${p.text}`}</span>
        ))}
      </p>
    </div>
  );
}

export function TotalBox({ label, totals, sub }) {
  return (
    <div data-value-total="" className="flex min-w-[9rem] flex-col items-center justify-center rounded-xl border-2 border-db-red-solid bg-surface px-4 py-3 text-center">
      <span className="text-[11px] tracking-wide text-text-primary">{label}</span>
      {totals.length ? totals.map((t) => <span key={t.currency} data-total-amount="" className="text-[22px] font-extrabold tabular-nums text-db-red-fg">{moneyText(t.currency, t.amount)}</span>)
        : <span data-total-amount="" className="text-[22px] font-extrabold text-text-tertiary">None yet</span>}
      <span className="text-[10px] text-text-secondary">{sub}</span>
      <span className="text-[10px] text-text-secondary">Per year</span>
    </div>
  );
}

const TEAL = '#0d9488';
// FX-34 (W16 D8): the bar shows every share of the total: calculated, estimated and, when there is one, measured.
const split = (totals) => totals.flatMap((t) => {
  const tag = totals.length > 1 ? ` ${t.currency}` : '';
  const part = (name, f, color) => ({ name: `${name}${tag}`, value: Number(t[f]) || 0, text: moneyText(t.currency, Number(t[f]) || 0), color });
  return [part('Calculated', 'calculated', GREEN), part('Estimated', 'estimated', AMBER), ...(Number(t.measured) > 0 ? [part('Measured', 'measured', TEAL)] : [])];
});

const PILL = { calculated: 'bg-success-bg text-success-fg', measured: 'bg-success-bg text-success-fg', estimated: 'bg-warning-bg text-warning-fg', not_estimated: 'bg-warning-bg text-warning-fg' };
const STATUS = { calculated: 'calculated', measured: 'measured', estimated: 'estimated', no_data: 'no data', not_estimated: 'not estimated' };

const plural = (n, one, many) => (n === 1 ? one : many);

// REQ-448, REQ-454: what the total leaves out and what it counts once.
function CountNotes({ run }) {
  const out = (run.excluded || []).reduce((s, e) => s + (Number(e.n) || 0), 0);
  const shared = Number(run.n_shared) || 0;
  if (!out && !shared) return null;
  return (
    <div data-value-count-notes="" className="mt-2 text-[11px] text-text-secondary">
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
    <section aria-label="Value of this run" data-value-run-panel="" className="mb-4 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-base font-bold text-text-primary">Value of this run</h2>
      <p className="text-[12px] text-text-secondary">The sum of every use case&apos;s value in this run. Use cases with no value yet add nothing.</p>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <TotalBox label="RUN VALUE" totals={run.totals || []} sub={`${run.n_calculated} calculated · ${run.n_estimated} estimated`} />
        <div className="min-w-0 flex-1">
          <Bar parts={split(run.totals || [])} label="Calculated vs estimated" />
          <Bar parts={byVerb} label="By kind of value" />
          <CountNotes run={run} />
          <p className="mt-2 text-[11px] text-text-secondary">{`${run.n} use cases · ${run.n_calculated} calculated · ${run.n_estimated} estimated · ${run.n_none} not worked out yet`}</p>
        </div>
      </div>
      <table className="mt-3 w-full text-[12px]">
        <thead><tr className="text-start text-text-secondary"><th className="text-start font-medium">Use case</th><th className="text-start font-medium">Kind</th><th className="text-start font-medium">Status</th><th className="text-end font-medium">Per year</th><th className="text-end font-medium" title="What this use case adds to the run total: a value that shares its pool of money with another adds $0">Counted in</th></tr></thead>
        <tbody>
          {rows.map(([id, u]) => (
            <tr key={id} data-value-row={id} onClick={() => onRow?.(id)} className="cursor-pointer border-t border-border/60 hover:bg-bg-subtle">
              <td className="py-1">{nameOf?.(id) || id}
                {u.overlap && u.overlap.counted === false && <span data-value-shared="" className="block text-[10px] text-text-secondary">{`Shared with ${nameOf?.(u.overlap.with) || u.overlap.with}, counted once`}</span>}
                {u.overlap && u.overlap.counted === true && <span data-value-shared="" className="block text-[10px] text-text-secondary">{`Also counted for ${u.overlap.shared_with.length} other ${plural(u.overlap.shared_with.length, 'use case', 'use cases')}`}</span>}
              </td>
              <td className="text-text-secondary">{u.verb || ''}</td>
              <td><span title={u.reason || undefined} className={`rounded-full px-2 py-px text-[10px] ${PILL[u.status] || 'bg-bg-subtle text-text-secondary'}`}>{STATUS[u.status] || 'not yet'}</span></td>
              <td className="text-end tabular-nums">{u.amount != null ? moneyText(u.currency, u.amount) : 'Not calculated'}
                {u.check && <span className="block"><ValueCheckNote check={u.check} notCounted={u.counted === false} /></span>}
                {u.reason && <span data-value-reason="" className="block text-[10px] text-text-secondary">{u.reason}</span>}
              </td>
              <td className="text-end tabular-nums">{u.amount != null && Number.isFinite(Number(u.counted_amount))
                ? <span data-value-counted="">{moneyText(u.currency, u.counted_amount)}</span> : ''}</td>
            </tr>
          ))}
          <tr data-value-run-total="" className="border-t-2 border-border font-bold"><td className="py-1">Run total</td><td /><td /><td />
            <td className="text-end tabular-nums">{(run.totals || []).map((t) => moneyText(t.currency, t.amount)).join(' + ') || 'Not calculated'}</td></tr>
        </tbody>
      </table>
      <ValueDisclaimer className="mt-2" />
    </section>
  );
}

// All runs: reply = C6 without session_id: { runs, all, truncated }.
export function AllRunsValuePanel({ reply }) {
  const runs = reply.runs || [];
  const all = reply.all || { totals: [] };
  const byRun = runs.map((r, k) => ({ name: r.name || r.session_id, value: (r.totals || []).reduce((s, t) => s + (Number(t.amount) || 0), 0), text: (r.totals || []).map((t) => moneyText(t.currency, t.amount)).join(' + '), color: PALETTE[k % PALETTE.length] }));
  const cell = (r, f) => (r.totals || []).map((t) => moneyText(t.currency, t[f])).join(' + ') || 'Not calculated';
  return (
    <section aria-label="Value across runs" data-value-all-panel="" data-value-overall="" className="mb-4 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-base font-bold text-text-primary">Value across all runs</h2>
      <p className="text-[12px] text-text-secondary">Each run&apos;s total, and one total for everything Inspire found.{reply.truncated ? ` Showing the newest ${reply.cap || runs.length} runs only.` : ''}</p>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <TotalBox label="ALL RUNS" totals={all.totals || []} sub={`${all.n_calculated ?? 0} calculated · ${all.n_estimated ?? 0} estimated`} />
        <div className="min-w-0 flex-1">
          <Bar parts={split(all.totals || [])} label="Calculated vs estimated" />
          {all.totals?.length <= 1 && <Bar parts={byRun} label="By run" />}
        </div>
      </div>
      <table className="mt-3 w-full text-[12px]">
        <thead><tr><th className="text-start font-medium">Run</th><th className="text-end font-medium">Use cases</th><th className="text-end font-medium">Calculated</th><th className="text-end font-medium">Estimated</th><th className="text-end font-medium">Run total</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.session_id} data-all-runs-row={r.session_id} className="border-t border-border/60">
              <td className="py-1">{r.name || r.session_id}</td><td className="text-end tabular-nums">{r.n}</td>
              <td className="text-end tabular-nums">{cell(r, 'calculated')}</td><td className="text-end tabular-nums">{cell(r, 'estimated')}</td>
              <td className="text-end font-semibold tabular-nums"><RunValueTotal value={r.run_value || r} /></td>
            </tr>
          ))}
          <tr className="border-t-2 border-border font-bold"><td className="py-1">All runs</td><td /><td /><td />
            <td className="text-end tabular-nums">{(all.totals || []).map((t) => moneyText(t.currency, t.amount)).join(' + ') || 'Not calculated'}</td></tr>
        </tbody>
      </table>
      <ValueDisclaimer className="mt-2" />
    </section>
  );
}

// FX-34 (W16 D2/D3/D9): one line for the value of a run, from the run value the server computes once (valueTotals.runValueOf).
// The Start bars, the run card and the Review header all render it, so they cannot disagree.
export function RunValueTotal({ value }) {
  const totals = value?.totals || [];
  if (!totals.length) return <span data-run-value-state="not-calculated">Not calculated</span>;
  return <span data-run-value-total="">{totals.map((t) => moneyText(t.currency, t.amount)).join(' + ')}</span>;
}

export function RunValueLine({ value, label = 'Value of this run', className = '' }) {
  const n = value ? `${value.n_calculated ?? 0} calculated · ${value.n_estimated ?? 0} estimated` : '';
  return (
    <p data-run-value="" className={`text-[11px] text-text-secondary ${className}`}>
      <span className="font-semibold uppercase tracking-wide">{label}: </span>
      <span className="font-bold tabular-nums text-text-primary"><RunValueTotal value={value} /></span>
      {value?.totals?.length ? <><span>{` (${n}) `}</span><ValueDisclaimer short /></> : null}
    </p>
  );
}
