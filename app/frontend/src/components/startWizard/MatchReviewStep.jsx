// REQ-578, REQ-579: Match path, Review and start. Shows the business, the use cases and the data; the registered start POSTs match/start
// (15_operation 'Match Use Cases', 19_match_phase 'match') and resolves { sessionId, runId }; the shell then opens the Monitor.
// Props (lib/startWizard.js): draft, setDraft, settings, apiFetch, onReady, registerStart, launchParams, onEditStep.
import { useEffect, useRef } from 'react';
import { postOf, startMatch } from '../../lib/matchClient';

const link = 'text-sm text-db-red-fg underline underline-offset-2';
const dataOf = (params) => String((params && params['01_uc_metadata']) || '').split(',').map((t) => t.trim()).filter(Boolean);

export default function MatchReviewStep({ draft, settings, onReady, registerStart, launchParams, onEditStep }) {
  const live = useRef({});
  live.current = { draft, settings, launchParams };
  const cases = draft.useCases || [];
  const tables = dataOf(launchParams ? launchParams() : {});

  useEffect(() => { onReady?.(true); }, [onReady]);
  useEffect(() => {
    registerStart?.(async () => {
      const { draft: d, settings: s, launchParams: params } = live.current;
      const got = await startMatch(postOf(s), {
        business_name: String(d.businessName || '').trim(), inspire_database: s.inspireDatabase, warehouse_id: s.warehouseId,
        use_cases: (d.useCases || []).map((u) => ({ input_no: u.input_no, name: u.name, description: u.description || '' })),
        params: params ? params() : {},
      });
      return { sessionId: String(got.session_id), runId: got.run_id, ...(got.warnings ? { warnings: got.warnings } : {}) };
    });
    return () => registerStart?.(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section data-wiz-step="matchReview" className="space-y-5">
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="text-xs uppercase tracking-wide text-text-secondary">Business</p>
        <p className="text-base font-medium text-text-primary">{draft.businessName}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text-primary">{cases.length === 1 ? '1 use case' : `${cases.length} use cases`}</p>
          <button type="button" data-wiz-edit="usecases" className={link} onClick={() => onEditStep?.('usecases')}>Change use cases</button>
        </div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-text-primary">
          {cases.map((u) => <li key={u.input_no}>{u.name}{u.description ? <span className="text-text-secondary">: {u.description}</span> : null}</li>)}
        </ol>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text-primary">Data to match against</p>
          <button type="button" data-wiz-edit="data" className={link} onClick={() => onEditStep?.('data')}>Change data</button>
        </div>
        {tables.length ? (
          <ul className="mt-2 space-y-0.5 text-sm text-text-primary">{tables.map((t) => <li key={t} className="font-mono">{t}</li>)}</ul>
        ) : <p className="mt-2 text-sm text-text-secondary">No data picked yet.</p>}
      </div>
      <p className="text-sm text-text-secondary">Starting this opens a run. Each use case shows on the Monitor with its match status, and the review is on the run's Results page.</p>
    </section>
  );
}
