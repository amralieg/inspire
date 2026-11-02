import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { makeApiFetch, makeApiPostJson } from '../lib/apiClient';
import { useGroupingProfile } from '../lib/groupingProfile';
import { GROUP_ALL, RUN_EVERYTHING_LABEL, RUN_SCOPE, isScopeSetting, runScopeFacts } from '../lib/runScope';
import { SETTINGS_ROUTES, settingsViewSaved } from '../lib/useCaseSettings';
import { ScopeSection } from './ScopeSettings';

const NOTE = 'text-[12px] text-text-secondary';

export function RunScopeLine({ facts, all = false }) {
  if (facts?.error) return <p data-run-scope-error="" className={NOTE}>Inspire could not read the scope of the last run: {facts.error}</p>;
  if (!facts || !(all || facts.scoped || facts.note) || !(facts.text || facts.covered)) return null;
  return (
    <div data-run-scope-last="" className="space-y-0.5">
      {facts.text && <p data-run-scope-text="" className="text-[12px] font-medium text-text-primary">Last run: {facts.text}</p>}
      {facts.covered && <p data-run-scope-covered="" className={NOTE}>{facts.covered}</p>}
      {facts.note && <p data-run-scope-note="" className={NOTE}>{facts.note}</p>}
    </div>
  );
}

export default function RunScope({ page, settings }) {
  const { token, databricksHost, inspireDatabase, warehouseId } = settings || {};
  const apiFetch = useMemo(() => makeApiFetch({ token, databricksHost }), [token, databricksHost]);
  const apiPostJson = useMemo(() => makeApiPostJson({ token, databricksHost }), [token, databricksHost]);
  const query = new URLSearchParams({
    inspire_database: inspireDatabase || '', warehouse_id: warehouseId || '', session_id: String(page.session_id || ''), use_case_id: String(page.use_case_id || ''),
  }).toString();
  const [view, setView] = useState(null);
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    Promise.all([apiFetch(`${SETTINGS_ROUTES.read}?${query}`), apiFetch(`${SETTINGS_ROUTES.runs}?${query}`)])
      .then(([got, listed]) => { if (live) { setView(got); setRuns(listed); setError(''); } })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [apiFetch, query, tick]);
  const scopeList = useMemo(() => (Array.isArray(view?.settings) ? view.settings.filter(isScopeSetting) : []), [view]);
  const profile = useGroupingProfile({
    apiPostJson, inspireDatabase, sessionId: page.session_id, useCaseId: page.use_case_id, warehouseId, enabled: scopeList.length > 0,
  });
  const save = useCallback(async (name, value, was, note) => {
    const got = await apiPostJson(`${SETTINGS_ROUTES.save}?${query}`, { name, value, was, note });
    setView((prev) => settingsViewSaved(prev, got));
    return got;
  }, [apiPostJson, query]);
  if (error) return <p role="alert" className="text-[12px] text-error-fg">Inspire could not read the Grouping and First run of this use case: {error}</p>;
  if (!view || !runs) return <p className={NOTE}><Loader2 size={12} className="inline mr-1 animate-spin" aria-hidden /> Reading the Grouping and First run</p>;
  if (!scopeList.length) return null;
  const facts = runScopeFacts(runs.runs);
  const scope = String(scopeList.find((s) => s.name === RUN_SCOPE)?.value ?? '') || GROUP_ALL;
  const canRun = Boolean(view.editable) && view.can_run === true && scopeList.some((s) => s.name === RUN_SCOPE && s.editable !== false);
  const runEverything = async () => {
    setBusy(true);
    setMessage('');
    try {
      const was = String(scopeList.find((s) => s.name === RUN_SCOPE)?.value ?? '');
      if (scope !== GROUP_ALL) await save(RUN_SCOPE, GROUP_ALL, was, RUN_EVERYTHING_LABEL);
      await apiPostJson(`${SETTINGS_ROUTES.run}?${query}`, {});
      setMessage('The run on everything started; schedules now cover every record.');
      setTick((n) => n + 1);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Grouping and First run of this use case" data-run-scope="" className="space-y-3 rounded-lg border border-border p-3">
      <RunScopeLine facts={facts} all />
      {view.why && <p data-settings-why="" className={NOTE}>{view.why}</p>}
      {runs.why && <p data-run-scope-why="" className={NOTE}>{runs.why}</p>}
      <ScopeSection settings={scopeList} editable={view.editable === true} scope={profile} onSave={save} />
      {scope !== GROUP_ALL && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || !canRun} onClick={runEverything}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-db-red-solid disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {RUN_EVERYTHING_LABEL}
          </button>
          {facts?.everything && <span data-run-everything-estimate="" className={NOTE}>{facts.everything}</span>}
        </div>
      )}
      {message && <p role="status" data-run-scope-message="" className="text-[12px] text-text-primary">{message}</p>}
    </section>
  );
}
