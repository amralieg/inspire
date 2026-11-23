// REQ-507 L4: the Filter step. A plain-English phrase (5 examples) is checked by the server, which echoes what it understood, the SQL and one
// chip per predicate. A chip edit is structure: it re-posts {filters, window} with no phrase. With the model down a structured builder shows.
import { useState } from 'react';
import { FILTER_EXAMPLES, FILTER_ROUTE, predicateText, unmatchedLine, withoutPredicate } from '../../lib/valueScope.js';

const btn = 'inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-semibold hover:bg-bg-subtle disabled:opacity-50';
const OPS = ['=', '!=', 'in', 'not in', '>', '>=', '<', '<=', 'between', 'is null', 'is not null'];
const NO_VALUE = ['is null', 'is not null'];

export default function StepFilter({ facts, scope, onScope, post }) {
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState(null);
  const [row, setRow] = useState({ column: '', op: '=', value: '' });

  const run = async (body) => {
    setBusy(true); setError('');
    try {
      const out = await post(FILTER_ROUTE, body);
      setReply(out);
      if (out?.scope) onScope({ ...out.scope, choice: 'filter' });
      return out;
    } catch (e) { setError(e?.message || 'Could not check that filter.'); return null; } finally { setBusy(false); }
  };
  const windowOf = (s) => s?.window || null;
  const check = () => phrase.trim() && run({ phrase: phrase.trim(), date_column: facts?.date_column || null, window: windowOf(scope) });
  const remove = (i) => {
    const left = withoutPredicate(scope, i);
    onScope({ ...left, choice: 'filter' });
    return run({ date_column: facts?.date_column || null, filters: left.filters, window: windowOf(left) });
  };
  const addRow = () => {
    if (!row.column.trim()) return;
    const values = NO_VALUE.includes(row.op) ? [] : row.value.split(row.op === 'between' ? /\s+and\s+|,/i : ',').map((v) => v.trim()).filter(Boolean);
    const filters = [...(scope?.filters || []), { column: row.column.trim(), op: row.op, values }];
    setRow({ column: '', op: '=', value: '' });
    return run({ date_column: facts?.date_column || null, filters, window: windowOf(scope) });
  };

  const filters = scope?.filters || [];
  const unmatched = reply?.unmatched || [];
  return (
    <div data-wizard-page="filter" className="space-y-3">
      <div className="flex flex-wrap gap-1.5" aria-label="Examples">
        {FILTER_EXAMPLES.map((ex) => <button key={ex} type="button" data-filter-example="" className={btn} onClick={() => setPhrase(ex)}>{ex}</button>)}
      </div>
      <label className="flex flex-col gap-1 text-[12px] text-text-secondary">Describe the rows to keep
        <textarea rows={2} value={phrase} dir="auto" onChange={(e) => setPhrase(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary" />
      </label>
      <button type="button" className={btn} disabled={busy || !phrase.trim()} onClick={check}>Check filter</button>
      {error && <p role="alert" className="text-[12px] text-error-fg">{error}</p>}
      {reply?.echo && <p data-filter-echo="" dir="auto" className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm">{reply.echo}</p>}
      {unmatched.length > 0 && (
        <ul data-filter-unmatched="" className="space-y-1 text-[12px] text-warning-fg">{unmatched.map((u, i) => <li key={i} dir="auto">{unmatchedLine(u)}</li>)}</ul>
      )}
      {filters.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {filters.map((f, i) => {
            const text = predicateText(f);
            return (
              <li key={`${text}-${i}`} data-predicate="" className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-subtle ps-3 pe-1 text-[12px]">
                {text}
                <button type="button" aria-label={`Remove ${text}`} disabled={busy} onClick={() => remove(i)} className="h-6 w-6 rounded-full hover:bg-surface">×</button>
              </li>
            );
          })}
        </ul>
      )}
      {reply?.sql && <details data-filter-sql=""><summary className="cursor-pointer text-[12px] text-text-secondary">SQL used to count</summary><pre className="overflow-x-auto text-[11px]">{reply.sql}</pre></details>}
      {reply?.builder && (
        <div data-filter-builder="" className="flex flex-wrap items-end gap-2 rounded-md border border-border px-3 py-2">
          <p className="w-full text-[12px] text-text-secondary">{reply.reason ? `The AI model is not available (${reply.reason}). Build the filter here.` : 'Build the filter here.'}</p>
          <label className="flex flex-col gap-1 text-[12px]">Column<input value={row.column} onChange={(e) => setRow({ ...row, column: e.target.value })} className="h-8 rounded-md border border-border bg-surface px-2 text-sm" /></label>
          <label className="flex flex-col gap-1 text-[12px]">Operator
            <select value={row.op} onChange={(e) => setRow({ ...row, op: e.target.value })} className="h-8 rounded-md border border-border bg-surface px-2 text-sm">{OPS.map((o) => <option key={o}>{o}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-[12px]">Value<input value={row.value} disabled={NO_VALUE.includes(row.op)} onChange={(e) => setRow({ ...row, value: e.target.value })} className="h-8 rounded-md border border-border bg-surface px-2 text-sm" /></label>
          <button type="button" className={btn} disabled={busy || !row.column.trim()} onClick={addRow}>Add condition</button>
        </div>
      )}
    </div>
  );
}
