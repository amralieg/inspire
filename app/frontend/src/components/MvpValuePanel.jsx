import { useMemo, useState } from 'react';
import CalculateValueDialog from './CalculateValueDialog';
import ValueBox from './ValueBox';
import { tableOfUseCase, useCalculatedValues } from '../lib/calculatedValue';
import { trackingIdOf } from '../lib/useCaseFields';
import { useValueRead } from '../lib/useValueLedger';
import { makeApiPutJson } from '../lib/apiClient';

// REQ-440: the use case value inside the Build MVP Measure step. One saved value per use case, shared with the card and the run totals:
// the same value box, the same Calculate value dialog, the same reads (answers and totals). No formula here; the numbers are the server's.
const btn = 'rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle';
const primary = 'rounded-md bg-db-red-solid hover:bg-db-red-solid-hover px-3 py-1.5 text-sm font-semibold text-white';

export default function MvpValuePanel({ uc, sessionId, settings, apiFetch, apiPostJson }) {
  const id = trackingIdOf(uc);
  const { inspireDatabase, warehouseId } = settings;
  const apiPutJson = useMemo(() => makeApiPutJson({ token: settings.token, databricksHost: settings.databricksHost }), [settings.token, settings.databricksHost]);
  const [tick, setTick] = useState(0);
  const [choice, setChoice] = useState('open');
  const [calc, setCalc] = useState(false);
  const calculated = useCalculatedValues({ apiFetch, apiPostJson, apiPutJson, inspireDatabase, warehouseId, sessionId });
  const values = useMemo(() => ({
    ...calculated,
    run: async (...a) => { const got = await calculated.run(...a); setTick((n) => n + 1); return got; },
    undo: async (...a) => { const got = await calculated.undo(...a); setTick((n) => n + 1); return got; },
  }), [calculated]);
  const totals = useValueRead(apiFetch, `/api/inspire/value/totals?session_id=${encodeURIComponent(String(sessionId))}`, tick);
  const summary = totals?.use_cases?.[id] || null;
  if (!totals) return null;
  const saved = calculated.byId[id] || null;
  const status = summary?.status || (saved ? (saved.yearly?.calculated ? 'calculated' : 'estimated') : 'none');
  const editable = status === 'calculated' || status === 'estimated';
  const none = status === 'none';
  return (
    <section data-mvp-value="" aria-label="Value of this use case" className="max-w-full rounded-xl border border-border bg-surface px-4 pb-5 pt-3">
      <h3 className="text-sm font-semibold text-text-primary">Value of this use case</h3>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        {!none && <ValueBox yearly={saved?.yearly || null} summary={summary} status={status} />}
        {none && choice === 'skipped' && <p data-mvp-value-skipped="" className="text-[12px] text-text-secondary">{"Inspire's estimate is used for this use case."}</p>}
        {none && choice !== 'skipped' && (
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[12px] text-text-secondary">No value worked out yet. Calculate one from your data, or let Inspire&apos;s estimate stand.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} onClick={() => setCalc(true)}>Calculate now</button>
              <button type="button" className={btn} onClick={() => setChoice('skipped')}>{"Skip, use Inspire's estimate"}</button>
            </div>
          </div>
        )}
        {editable && choice === 'open' && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => setChoice('kept')}>Keep</button>
            <button type="button" className={primary} onClick={() => setCalc(true)}>Edit</button>
          </div>
        )}
        {status === 'measured' && <p className="min-w-0 flex-1 text-[12px] text-text-secondary">This amount is measured by the MVP, so it cannot be edited here.</p>}
      </div>
      {calc && (
        <CalculateValueDialog uc={uc} table={tableOfUseCase(uc)} apiPostJson={apiPostJson} inspireDatabase={inspireDatabase} warehouseId={warehouseId}
          sessionId={sessionId} saved={saved?.answers || null} version={saved?.version || null} values={values} onClose={() => { setCalc(false); setChoice('open'); }} />
      )}
    </section>
  );
}
