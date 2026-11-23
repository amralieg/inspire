import ValueDisclaimer from './ValueDisclaimer';
import { useEffect, useMemo, useState } from 'react';
import CalculateValueDialog from './CalculateValueDialog';
import ValueBox from './ValueBox';
import MeasureSettings from './valueWizard/MeasureSettings.jsx';
import { tableOfUseCase, useCalculatedValues } from '../lib/calculatedValue';
import { trackingIdOf } from '../lib/useCaseFields';
import { useValueRead } from '../lib/useValueLedger';
import { valueQuery } from '../lib/valueLedger';
import { makeApiPutJson } from '../lib/apiClient';

// REQ-440: the use case value inside the Build MVP Measure step. One saved value per use case, shared with the card and the run totals:
// the same value box, the same Calculate value dialog, the same reads (answers and totals). No formula here; the numbers are the server's.
const btn = 'rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle';

export default function MvpValuePanel({ uc, sessionId, settings, apiFetch, apiPostJson, measure }) {
  const id = trackingIdOf(uc);
  const { inspireDatabase, warehouseId } = settings;
  const apiPutJson = useMemo(() => makeApiPutJson({ token: settings.token, databricksHost: settings.databricksHost }), [settings.token, settings.databricksHost]);
  const [tick, setTick] = useState(0);
  const [calc, setCalc] = useState(false);
  useEffect(() => { if (measure?.open) setCalc(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const calculated = useCalculatedValues({ apiFetch, apiPostJson, apiPutJson, inspireDatabase, warehouseId, sessionId });
  const values = useMemo(() => ({
    ...calculated,
    run: async (...a) => { const got = await calculated.run(...a); setTick((n) => n + 1); return got; },
    undo: async (...a) => { const got = await calculated.undo(...a); setTick((n) => n + 1); return got; },
  }), [calculated]);
  const totals = useValueRead(apiFetch, `/api/inspire/value/totals?${valueQuery(inspireDatabase, warehouseId, { session_id: String(sessionId) })}`, tick);
  const summary = totals?.use_cases?.[id] || null;
  if (!totals) return null;
  const saved = calculated.byId[id] || null;
  const status = summary?.status || (saved ? (saved.yearly?.calculated ? 'calculated' : 'estimated') : 'none');
  // FX-52 (D51): Inspire's own estimate, an out-of-date one or none at all is not a value the person calculated: ask them to.
  const none = !saved && ['none', 'estimated', 'not_estimated'].includes(status);
  const editable = !none && (status === 'calculated' || status === 'estimated');
  return (
    <section data-mvp-value="" aria-label="Value of this use case" className="max-w-full rounded-xl border border-border bg-surface px-4 pb-5 pt-3">
      <h3 className="text-sm font-semibold text-text-primary">Value of this use case</h3>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        {!none && <ValueBox yearly={saved?.yearly || null} summary={summary} status={status} onEdit={editable ? () => setCalc(true) : undefined} />}
        {none && <ValueBox canCalculate onCalculate={() => setCalc(true)} status="none" />}
        {none && <p data-value-none="" className="min-w-0 flex-1 text-[12px] text-text-secondary">No value yet</p>}
        {editable && <button type="button" className={btn} onClick={() => setCalc(true)}>Edit</button>}
        {status === 'measured' && <p className="min-w-0 flex-1 text-[12px] text-text-secondary">This amount is measured by the MVP, so it cannot be edited here.</p>}
      </div>
      {!none && <ValueDisclaimer className="mt-2" />}
      {status === 'measured' && measure && <div className="mt-3"><MeasureSettings measure={measure} /></div>}
      {calc && (
        <CalculateValueDialog uc={uc} table={tableOfUseCase(uc)} apiPostJson={apiPostJson} apiFetch={apiFetch} inspireDatabase={inspireDatabase} warehouseId={warehouseId}
          sessionId={sessionId} saved={saved?.answers || null} version={saved?.version || null} values={values} measure={measure} onClose={() => setCalc(false)} />
      )}
    </section>
  );
}
