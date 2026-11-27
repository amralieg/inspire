import ValueDisclaimer from './ValueDisclaimer';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import ValueEstimateLine from './ValueEstimateLine';
import { moneyText as boxMoneyText } from './ValueBox';
import { AppReadAccess } from './AppReadAccess';
import { PlainMessage } from './TechnicalDetails';
import { raisePermissions } from '../lib/permissionBus';
import { buildItems, buildNextOf, moneyText, nextSharingTables, valuedLine } from '../lib/buildNext';
import { trackBuildSubmit } from '../lib/implementControl';
import { appGrantText, moneyRuleColumns, preflightParams, primaryTableOf, specForSibling } from '../lib/implementWizard';
import { joinSentences } from '../lib/sentences';
import { STATUS_LABELS } from '../lib/valueLabels';

const BUILD_NOW_BUTTON = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white bg-primary-solid shadow-sm shadow-db-red/20 hover:bg-primary-solid-hover disabled:opacity-70';
const BUILD_CUSTOM_BUTTON = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-bg-subtle';

// REQ-078: a sibling shows its own estimate from its domain's money rule, or asks for a rule (the same route and line as Review).
// FX-34 (REQ-448, W16 D12): a use case the value totals already value shows that amount, the one its card shows.
const VALUED = { calculated: STATUS_LABELS.calculated, estimated: STATUS_LABELS.estimated, measured: 'measured' };
export function RunValue({ row, onMeasure }) {
  const v = row.value;
  if (valuedLine(v)) {
    return (
      <p data-value-estimate="value" className="truncate text-xs leading-snug text-text-secondary">
        {`${v.verb || 'Value at stake'}: `}<span data-value-line-amount="" className="font-semibold tabular-nums text-text-primary">{boxMoneyText(v.currency, v.amount)}</span>{` a year (${VALUED[v.status]}) `}<ValueDisclaimer short />
      </p>
    );
  }
  if (row.estimate) return <ValueEstimateLine estimate={row.estimate} onSetRule={onMeasure ? () => onMeasure(row.id) : undefined} oneLine />;
  if (row.uc && row.est) return <ValueEstimateLine uc={row.uc} oneLine />;
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

// REQ-560: the demo replays the value reads it recorded; a recording that lacks them shows no estimate instead of an error (showcase).
// REQ-497 FX-103: refreshKey moves when a value is saved, so the row reads the saved status again (Reviewed calculation after Accept and save).
// D-uae-06: `listed` is the use case list the page shows; the count and the rows come from it, so the header never counts a different pass.
export function useBuildRows(apiFetch, inspireDatabase, warehouseId, sessionId, showcase = false, listed = null, refreshKey = 0) {
  const [state, setState] = useState({ got: null, error: '' });
  useEffect(() => {
    if (!sessionId || !inspireDatabase || !warehouseId) return undefined;
    let cancelled = false;
    const q = new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) });
    const estimates = showcase ? apiFetch(`/api/inspire/value/estimates?${q}`).catch(() => ({ use_cases: {} })) : apiFetch(`/api/inspire/value/estimates?${q}`);
    const totals = apiFetch(`/api/inspire/value/totals?${q}`).catch(() => ({ use_cases: {} }));
    Promise.all([apiFetch(`/api/inspire/usecases?${q}`), apiFetch(`/api/inspire/implement/history?${q}`), estimates, totals])
      .then(([cases, history, estimates, totals]) => {
        if (!cancelled) setState({ got: { cases, history, estimates, totals }, error: '' });
      })
      .catch((err) => { if (!cancelled) setState({ got: null, error: String(err?.message || err) }); });
    return () => { cancelled = true; };
  }, [apiFetch, inspireDatabase, warehouseId, sessionId, showcase, refreshKey]);
  // FX-63c: the rows follow the list the page shows without a second read, so a new list identity never refetches.
  // An absent list (null or undefined) falls back to the run's own use cases; an empty one is shown as empty.
  const { got, error } = state;
  const rows = useMemo(() => {
    if (!got) return null;
    const latest = got.history?.latest || [];
    const statusById = Object.fromEntries(latest.map((row) => [String(row.use_case_id ?? ''), row.status]));
    const byUseCase = got.estimates?.use_cases || {};
    const valued = got.totals?.use_cases || {};
    return buildItems(listed ?? got.cases?.usecases ?? [], statusById).map((row) => ({ ...row, estimate: byUseCase[String(row.id)] ?? null, value: valued[String(row.id)] ?? null }));
  }, [got, listed]);
  const liveSpecs = useMemo(() => Object.fromEntries((got?.history?.latest || []).map((row) => [String(row.use_case_id ?? ''), row.live_spec_json])), [got]);
  return { rows, liveSpecs, error };
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
      Start use case MVP <ArrowRight size={14} aria-hidden />
    </button>
  );
}

export function BuildNextPanel({ apiFetch, inspireDatabase, warehouseId, sessionId, onStart, onMeasure = null, showcase = false, useCases = null, refreshKey = 0 }) {
  const { rows, error } = useBuildRows(apiFetch, inspireDatabase, warehouseId, sessionId, showcase, useCases, refreshKey);
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
              <div className="min-w-0 flex-1 basis-56">
                <p dir="auto" className="break-words text-sm font-medium text-text-primary">{row.name || row.id}</p>
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

export function BuildNextStep({ apiFetch, apiPostJson, inspireDatabase, warehouseId, sessionId, notebookPath = '', focusId, live, caseOf, onBuilt, onBuildCustom, onQueued = null, onMeasure = null, onOpen = null, showcase = false, refreshKey = 0 }) {
  const { rows, liveSpecs, error } = useBuildRows(apiFetch, inspireDatabase, warehouseId, sessionId, showcase, null, refreshKey);
  const next = useMemo(() => (rows && live ? nextSharingTables(rows, focusId) : []), [rows, live, focusId]);
  // C24 (REQ-078): a built use case nudges to the next highest-value unbuilt one, picked by the one ranking (buildNextOf).
  const another = useMemo(() => (rows && live ? buildNextOf(rows) : null), [rows, live]);
  const [builds, setBuilds] = useState({});
  if (!live || error) return null;
  const nudge = onOpen && another?.unbuilt > 0 && another.next[0] ? (
    <section aria-label="Build another" data-build-another="" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-sm text-text-primary">{`Build another: ${another.unbuilt} more use case${another.unbuilt === 1 ? '' : 's'} in this run ${another.unbuilt === 1 ? 'is' : 'are'} ready to build`}</p>
      <button type="button" data-build-another-open={another.next[0].id} onClick={() => onOpen(another.next[0].id)} className={BUILD_CUSTOM_BUTTON}>
        {`Open ${another.next[0].name || another.next[0].id}`} <ArrowRight size={14} aria-hidden />
      </button>
    </section>
  ) : null;
  if (!next.length) return nudge;
  const canBuild = Boolean(onBuilt && onBuildCustom);
  const canBuildNow = Boolean(liveSpecs[focusId]);
  const patch = (id, change) => setBuilds((prev) => ({ ...prev, [id]: { ...prev[id], ...change } }));
  const ucOf = (row) => caseOf?.(row.id) || row.uc;

  const scope = () => new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) });

  const sourceColumnsOf = async (row) => {
    const table = primaryTableOf(ucOf(row)) || row.tables[0] || '';
    if (!table || !moneyRuleColumns(liveSpecs[focusId]?.money).length) return [];
    const got = await apiFetch(`/api/inspire/implement/columns?${scope()}&table=${encodeURIComponent(table)}`);
    return (got?.columns || []).map((column) => column.column_name);
  };

  const buildNow = async (row) => {
    patch(row.id, { busy: true, error: '', refusal: null });
    try {
      const context = await apiFetch(`/api/inspire/implement/context?${scope()}&use_case_id=${encodeURIComponent(focusId)}`);
      const sourceColumns = await sourceColumnsOf(row);
      const spec = specForSibling(liveSpecs[focusId], ucOf(row), { warehouseId, inspireDatabase, sessionId, businessName: context?.business_name || '', sourceColumns });
      const pre = await apiPostJson(`/api/inspire/implement/preflight?${scope()}&use_case_id=${encodeURIComponent(spec.use_case_id)}&${preflightParams(spec)}`, { spec }, { raise: false });
      if (pre.app_unreadable) {
        patch(row.id, { busy: false, refusal: pre.app_unreadable });
        return;
      }
      const blocked = Object.values(pre.checks || {}).filter((check) => check?.ok === false).map((check) => check.detail).filter(Boolean);
      if (blocked.length) {
        const permissions = Object.values(pre.checks || {}).map((check) => check?.permission).filter(Boolean);
        patch(row.id, { busy: false, error: joinSentences(...blocked), permissions });
        if (permissions.length) raisePermissions(permissions);
        return;
      }
      const data = await trackBuildSubmit(spec, () => apiPostJson('/api/inspire/implement/submit', {
        inspire_database: inspireDatabase,
        warehouse_id: warehouseId,
        session_id: String(sessionId),
        notebook_path: notebookPath,
        spec,
      }), onQueued);
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
      const got = await apiPostJson(`/api/inspire/implement/grant-access?${scope()}&use_case_id=${encodeURIComponent(row.id)}&kind=source_tables`,
        { tables: builds[row.id].refusal.tables });
      patch(row.id, { granting: false, grant: { ...got, text: appGrantText(got) } });
      if (!got.failed?.length && !got.app_unreadable) await buildNow(row);
    } catch (e) {
      patch(row.id, { granting: false, grant: { ran: [], failed: [], error: e.message } });
    }
  };

  return (
    <>
    {nudge}
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
                <div className="min-w-0 flex-1 basis-56">
                  <p dir="auto" className="break-words text-sm font-medium text-text-primary">{row.name || row.id}</p>
                  <p className="text-caption text-text-secondary">Shares {row.shared.join(', ')}</p>
                  <RunValue row={row} onMeasure={onMeasure} />
                </div>
                {canBuild && (
                  <div className="flex flex-wrap items-center gap-2">
                    {canBuildNow && (
                      <button type="button" data-build-now={row.id} aria-busy={build.busy ? 'true' : 'false'} disabled={build.busy}
                        onClick={() => buildNow(row)} className={BUILD_NOW_BUTTON}>
                        {build.busy ? <><Loader2 size={14} className="animate-spin" aria-hidden data-build-spinner="" /> Building</> : 'Build Now'}
                      </button>
                    )}
                    <button type="button" data-build-custom={row.id} onClick={() => onBuildCustom(ucOf(row))} className={BUILD_CUSTOM_BUTTON}>
                      Build custom <ArrowRight size={14} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
              {build.error && <PlainMessage text={`Inspire could not start the build: ${build.error}`} role="alert" className="text-[12px] text-error-fg" />}
              {build.permissions?.length > 0 && (
                <button type="button" data-see-grant="" onClick={() => raisePermissions(build.permissions, {}, { explicit: true })}
                  className="self-start rounded-lg border border-border bg-surface px-2.5 py-1 text-caption font-semibold text-text-primary hover:bg-bg-subtle">
                  See the grant
                </button>
              )}
              {build.refusal && <AppReadAccess offer={build.refusal} result={build.grant} busy={build.granting} onGrant={() => grantReads(row)} />}
            </li>
          );
        })}
      </ul>
    </section>
    </>
  );
}

