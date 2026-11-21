import { moneyText } from './ValueBox';
import { ValueCheckNote } from './ValueCheckNote';

// REQ-439: a total box, a calculated vs estimated bar, a second bar, and a table. Used for one run and for all runs.
// Amounts are per currency; two currencies show two totals, never one converted number.
const GREEN = '#15803d';
const AMBER = '#f59e0b';
const PALETTE = ['#c4161c', '#2563eb', '#7c3aed', '#0d9488', '#b45309'];

export function Bar({ parts, label }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="mt-2">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <div role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${p.text}`).join(', ')}`} className="mt-0.5 flex h-6 w-full max-w-xl overflow-hidden rounded-md bg-bg-subtle">
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.name} title={`${p.name} ${p.text}`} style={{ width: `${(100 * p.value) / total}%`, background: p.color }} className="flex items-center justify-center overflow-hidden px-1 text-[10px] text-white">{p.name} {p.text}</div>
        ))}
      </div>
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

const split = (totals) => totals.flatMap((t) => [
  { name: `Calculated ${totals.length > 1 ? t.currency : ''}`.trim(), value: Number(t.calculated) || 0, text: moneyText(t.currency, t.calculated), color: GREEN },
  { name: `Estimated ${totals.length > 1 ? t.currency : ''}`.trim(), value: Number(t.estimated) || 0, text: moneyText(t.currency, t.estimated), color: AMBER },
]);

const PILL = { calculated: 'bg-success-bg text-success-fg', measured: 'bg-success-bg text-success-fg', estimated: 'bg-warning-bg text-warning-fg' };

const plural = (n, one, many) => (n === 1 ? one : many);

// REQ-448, REQ-454: what the total leaves out and what it counts once.
function CountNotes({ run }) {
  const out = (run.excluded || []).reduce((s, e) => s + (Number(e.n) || 0), 0);
  const shared = Number(run.n_shared) || 0;
  if (!out && !shared) return null;
  return (
    <div data-value-count-notes="" className="mt-2 text-[11px] text-text-secondary">
      {out > 0 && <p>{`${out} ${plural(out, 'estimate', 'estimates')} outside $100K–$100M not counted: check the numbers`}</p>}
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
        <thead><tr className="text-start text-text-secondary"><th className="text-start font-medium">Use case</th><th className="text-start font-medium">Kind</th><th className="text-start font-medium">Status</th><th className="text-end font-medium">Per year</th></tr></thead>
        <tbody>
          {rows.map(([id, u]) => (
            <tr key={id} data-value-row={id} onClick={() => onRow?.(id)} className="cursor-pointer border-t border-border/60 hover:bg-bg-subtle">
              <td className="py-1">{nameOf?.(id) || id}
                {u.overlap && u.overlap.counted === false && <span data-value-shared="" className="block text-[10px] text-text-secondary">{`Shared with ${nameOf?.(u.overlap.with) || u.overlap.with}, counted once`}</span>}
                {u.overlap && u.overlap.counted === true && <span data-value-shared="" className="block text-[10px] text-text-secondary">{`Also counted for ${u.overlap.shared_with.length} other ${plural(u.overlap.shared_with.length, 'use case', 'use cases')}`}</span>}
              </td>
              <td className="text-text-secondary">{u.verb || ''}</td>
              <td><span className={`rounded-full px-2 py-px text-[10px] ${PILL[u.status] || 'bg-bg-subtle text-text-secondary'}`}>{u.status === 'calculated' ? 'calculated' : u.status === 'measured' ? 'measured' : u.status === 'estimated' ? 'estimated' : u.status === 'no_data' ? 'no data' : 'not yet'}</span></td>
              <td className="text-end tabular-nums">{u.amount != null ? moneyText(u.currency, u.amount) : 'Not calculated'}
                {u.check && <span className="block"><ValueCheckNote check={u.check} notCounted={u.counted === false} /></span>}
              </td>
            </tr>
          ))}
          <tr data-value-run-total="" className="border-t-2 border-border font-bold"><td className="py-1">Run total</td><td /><td />
            <td className="text-end tabular-nums">{(run.totals || []).map((t) => moneyText(t.currency, t.amount)).join(' + ') || 'Not calculated'}</td></tr>
        </tbody>
      </table>
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
    <section aria-label="Value at stake, every run" data-value-all-panel="" className="mb-4 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-base font-bold text-text-primary">Value across all runs</h2>
      <p className="text-[12px] text-text-secondary">Each run&apos;s total, and one total for everything Inspire found.{reply.truncated ? ' Showing the newest runs only.' : ''}</p>
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
              <td className="text-end font-semibold tabular-nums">{(r.totals || []).map((t) => moneyText(t.currency, t.amount)).join(' + ') || 'Not calculated'}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border font-bold"><td className="py-1">All runs</td><td /><td /><td />
            <td className="text-end tabular-nums">{(all.totals || []).map((t) => moneyText(t.currency, t.amount)).join(' + ') || 'Not calculated'}</td></tr>
        </tbody>
      </table>
    </section>
  );
}
