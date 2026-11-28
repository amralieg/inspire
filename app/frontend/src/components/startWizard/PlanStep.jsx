// c33 (REQ-577): Plan step (5a sorting, 5b review): POST /api/inspire/plan/sort, writes draft.plan.
// Props (lib/startWizard.js): draft, setDraft, settings, apiFetch, onReady, registerStart, launchParams, onEditStep.
import { useCallback, useEffect, useRef, useState } from 'react';
import { PLAN_STAGES, planFinding } from '../../lib/startWizard';
import { sortTables } from '../../lib/wizPlanClient';
import { PlainMessage } from '../TechnicalDetails';

const STAGE_MS = 4000;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function Progress({ business }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStage((n) => Math.min(n + 1, PLAN_STAGES.length - 1)), STAGE_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <div role="status" className="space-y-2">
      <p className="text-sm font-medium text-text-primary">{planFinding(business)}</p>
      <ul className="space-y-1 text-sm">
        {PLAN_STAGES.map((line, i) => (
          <li key={line} className={i <= stage ? 'text-text-primary' : 'text-text-secondary'}>{i < stage ? 'Done: ' : i === stage ? 'Now: ' : ''}{line}</li>
        ))}
      </ul>
    </div>
  );
}

export default function PlanStep({ draft, setDraft, settings, apiFetch, onReady }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const asked = useRef(0);
  const started = useRef(false);
  const plan = draft?.plan || null;
  const catalogs = Array.isArray(draft?.catalogs) ? draft.catalogs : [];
  const business = draft?.businessName || '';

  const sort = useCallback(async () => {
    const mine = ++asked.current;
    setLoading(true);
    setError('');
    try {
      const got = await sortTables(apiFetch, { warehouseId: settings?.warehouseId, catalogs, businessName: business, auth: settings });
      if (mine !== asked.current) return;
      setDraft({ plan: got });
    } catch (err) {
      if (mine !== asked.current) return;
      setError(err.message || 'The plan could not be built. Try again.');
    } finally {
      if (mine === asked.current) setLoading(false);
    }
  }, [apiFetch, settings, catalogs.join('\u0000'), business, setDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Back keeps a plan made for the same catalogs; other catalogs need a new sort.
    if (plan && sameList(plan.catalogs || [], catalogs)) return;
    sort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onReady?.(Boolean(plan) && !loading && !error); }, [onReady, plan, loading, error]);

  const move = (index, delta) => {
    const runs = [...plan.runs];
    const to = index + delta;
    if (to < 0 || to >= runs.length) return;
    [runs[index], runs[to]] = [runs[to], runs[index]];
    setDraft({ plan: { ...plan, runs: runs.map((r, i) => ({ ...r, run_no: i + 1 })) } });
  };

  const tableCount = plan ? plan.runs.reduce((n, r) => n + r.tables.length, 0) : 0;
  const leftOut = plan ? (plan.left_out || []).reduce((n, g) => n + (g.count ?? g.tables?.length ?? 0), 0) : 0;

  return (
    <section data-wiz-step="plan" className="space-y-4">
      {loading && <Progress business={business} />}
      {!loading && error && (
        <div role="alert" className="space-y-2">
          <PlainMessage text={error} className="text-sm text-error-fg" />
          <button type="button" onClick={sort} className="rounded-lg border border-border px-3 py-1.5 text-sm">Sort again</button>
        </div>
      )}
      {!loading && !error && plan && (
        <>
          <h2 className="text-lg font-semibold text-text-primary">Your plan: {plural(plan.runs.length, 'run')}</h2>
          <ol className="space-y-3">
            {plan.runs.map((run, i) => (
              <li key={`${run.run_no}-${run.name}`} data-plan-run={run.run_no} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{run.run_no}. {run.name}</p>
                    <p className="text-sm text-text-secondary">{plural(run.tables.length, 'table')}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded-lg border border-border px-2 py-1 text-sm disabled:opacity-40">Move up</button>
                    <button type="button" disabled={i === plan.runs.length - 1} onClick={() => move(i, 1)} className="rounded-lg border border-border px-2 py-1 text-sm disabled:opacity-40">Move down</button>
                  </div>
                </div>
                {run.why && <p className="mt-2 text-sm text-text-secondary">{run.why}</p>}
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-text-secondary">Show tables</summary>
                  <ul className="mt-1 space-y-0.5">{run.tables.map((t) => <li key={t.table}>{t.table}{t.why ? `: ${t.why}` : ''}</li>)}</ul>
                </details>
              </li>
            ))}
          </ol>
          {leftOut > 0 && (
            <div>
              <p className="text-sm font-semibold text-text-primary">Left out: {plural(leftOut, 'table')}</p>
              <ul className="mt-1 text-sm text-text-secondary">
                {plan.left_out.map((g) => (
                  <li key={g.reason}>{g.label}: {g.count ?? g.tables?.length ?? 0}{g.example ? `, for example ${g.example}` : ''}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm text-text-primary">{plural(plan.runs.length, 'run')}, {plural(tableCount, 'table')}. Run 1 starts first.</p>
          <button type="button" onClick={sort} className="rounded-lg border border-border px-3 py-1.5 text-sm">Sort again</button>
        </>
      )}
    </section>
  );
}
