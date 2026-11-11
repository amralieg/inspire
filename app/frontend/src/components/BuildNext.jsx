import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import ValueEstimateLine from './ValueEstimateLine';
import { AppReadAccess } from './AppReadAccess';
import { PlainMessage } from './TechnicalDetails';
import { buildItems, buildNextOf, moneyText, nextSharingTables } from '../lib/buildNext';
import { appGrantText, specForSibling } from '../lib/implementWizard';

const BUILD_NOW_BUTTON = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white bg-db-red-solid shadow-sm shadow-db-red/20 hover:bg-db-red-solid-hover disabled:opacity-70';
const BUILD_CUSTOM_BUTTON = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-bg-subtle';

function RunValue({ row, onMeasure }) {
  if (row.uc && row.est) return <ValueEstimateLine uc={row.uc} />;
  return (
    <p data-value-estimate="not-calculated" className="text-xs leading-snug text-text-secondary">
      Value at stake: Not calculated
      {onMeasure && (
        <button type="button" data-measure-value={row.id} onClick={() => onMeasure(row.id)}
          className="ms-2 font-medium text-db-red-fg hover:underline glow-focus">Measure</button>
      )}
    </p>
  );
}

export function useBuildRows(apiFetch, inspireDatabase, warehouseId, sessionId) {
  const [state, setState] = useState({ rows: null, liveSpecs: {}, error: '' });
  useEffect(() => {
    if (!sessionId || !inspireDatabase || !warehouseId) return undefined;
    let cancelled = false;
    const q = new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) });
    Promise.all([apiFetch(`/api/inspire/usecases?${q}`), apiFetch(`/api/inspire/implement/history?${q}`)])
      .then(([cases, history]) => {
        if (cancelled) return;
        const latest = history?.latest || [];
        const statusById = Object.fromEntries(latest.map((row) => [String(row.use_case_id ?? ''), row.status]));
        const liveSpecs = Object.fromEntries(latest.map((row) => [String(row.use_case_id ?? ''), row.live_spec_json]));
        setState({ rows: buildItems(cases?.usecases || [], statusById), liveSpecs, error: '' });
      })
      .catch((err) => { if (!cancelled) setState({ rows: null, liveSpecs: {}, error: String(err?.message || err) }); });
    return () => { cancelled = true; };
  }, [apiFetch, inspireDatabase, warehouseId, sessionId]);
  return state;
}

function StakeLine({ progress }) {
  const stake = progress.atStake.map(moneyText).join(' + ');
  return (
    <p data-build-progress="" className="text-[13px] text-text-primary">
      <span className="font-semibold tabular-nums">{progress.live} of {progress.total}</span> use cases live
      {stake && <>, <span className="font-semibold tabular-nums">{stake}</span> at stake covered</>}
    </p>
  );
}

function StartButton({ id, onStart }) {
  return (
    <button type="button" data-start-mvp={id} onClick={() => onStart(id)}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-db-red/40 bg-surface px-3 py-1.5 text-[12px] font-semibold text-text-primary hover:bg-bg-subtle">
      Start use case MVP <ArrowRight size={13} aria-hidden />
    </button>
  );
}

export function BuildNextPanel({ apiFetch, inspireDatabase, warehouseId, sessionId, onStart, onMeasure = null }) {
  const { rows, error } = useBuildRows(apiFetch, inspireDatabase, warehouseId, sessionId);
  const plan = useMemo(() => (rows ? buildNextOf(rows) : null), [rows]);
  if (error) return <p role="alert" data-build-next-error="" className="text-[12px] text-error-fg">Inspire could not load the next use cases: {error}</p>;
  if (!plan || plan.total === 0) return null;
  return (
    <section aria-label="Build next" data-build-next="" className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Build next</h2>
        <StakeLine progress={plan} />
      </div>
      {plan.next.length === 0 ? (
        <p data-build-all-live="" className="text-[12px] text-text-secondary">Every use case in this run has a live MVP.</p>
      ) : (
        <ul className="divide-y divide-border">
          {plan.next.map((row) => (
            <li key={row.id} data-build-next-row={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{row.name || row.id}</p>
                <RunValue row={row} onMeasure={onMeasure} />
              </div>
              {onStart && <StartButton id={row.id} onStart={onStart} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BuildNextStep({ apiFetch, apiPostJson, inspireDatabase, warehouseId, sessionId, notebookPath = '', focusId, live, caseOf, onBuilt, onBuildCustom, onMeasure = null }) {
  const { rows, liveSpecs, error } = useBuildRows(apiFetch, inspireDatabase, warehouseId, sessionId);
  const next = useMemo(() => (rows && live ? nextSharingTables(rows, focusId) : []), [rows, live, focusId]);
  const [builds, setBuilds] = useState({});
  if (!live || error || !next.length) return null;
  const canBuild = Boolean(onBuilt && onBuildCustom);
  const patch = (id, change) => setBuilds((prev) => ({ ...prev, [id]: { ...prev[id], ...change } }));
  const ucOf = (row) => caseOf?.(row.id) || row.uc;

  const buildNow = async (row) => {
    patch(row.id, { busy: true, error: '', refusal: null, grant: null });
    try {
      const data = await apiPostJson('/api/inspire/implement/submit', {
        inspire_database: inspireDatabase,
        warehouse_id: warehouseId,
        session_id: String(sessionId),
        notebook_path: notebookPath,
        spec: specForSibling(liveSpecs[focusId], ucOf(row), { warehouseId, inspireDatabase, sessionId }),
      });
      patch(row.id, { busy: false });
      onBuilt(data);
    } catch (e) {
      const refusal = e.body?.app_unreadable || null;
      patch(row.id, { busy: false, refusal, error: refusal ? '' : e.message });
    }
  };

  const grantReads = async (row) => {
    patch(row.id, { granting: true, grant: null });
    try {
      const q = new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId), use_case_id: row.id });
      const got = await apiPostJson(`/api/inspire/implement/grant-access?${q}&kind=source_tables`, { tables: builds[row.id].refusal.tables });
      patch(row.id, { granting: false, grant: { ...got, text: appGrantText(got) } });
    } catch (e) {
      patch(row.id, { granting: false, grant: { ran: [], failed: [], error: e.message } });
    }
  };

  return (
    <section aria-label="Next use cases on the same data" data-build-next-step="" className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Build next on the same data</h2>
        <p className="mt-0.5 text-[12px] text-text-secondary">These use cases read the same tables as this live MVP.</p>
      </div>
      <ul className="divide-y divide-border">
        {next.map((row) => {
          const build = builds[row.id] || {};
          return (
            <li key={row.id} data-next-step-row={row.id} className="space-y-2 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">{row.name || row.id}</p>
                  <p className="text-[11px] text-text-secondary">Shares {row.shared.join(', ')}</p>
                  <RunValue row={row} onMeasure={onMeasure} />
                </div>
                {canBuild && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" data-build-now={row.id} aria-busy={build.busy ? 'true' : 'false'} disabled={build.busy}
                      onClick={() => buildNow(row)} className={BUILD_NOW_BUTTON}>
                      {build.busy ? <><Loader2 size={13} className="animate-spin" aria-hidden data-build-spinner="" /> Building</> : 'Build Now'}
                    </button>
                    <button type="button" data-build-custom={row.id} onClick={() => onBuildCustom(ucOf(row))} className={BUILD_CUSTOM_BUTTON}>
                      Build custom <ArrowRight size={13} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
              {build.error && <PlainMessage text={`Inspire could not start the build: ${build.error}`} role="alert" className="text-[12px] text-error-fg" />}
              {build.refusal && <AppReadAccess offer={build.refusal} result={build.grant} busy={build.granting} onGrant={() => grantReads(row)} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

