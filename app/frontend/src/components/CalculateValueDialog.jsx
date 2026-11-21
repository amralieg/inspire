import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlainMessage } from './TechnicalDetails';
import ModalDialog from './ModalDialog';
import ValueHistory from './ValueHistory';
import StepSave from './valueWizard/StepSave.jsx';
import { StepData, StepGroups, StepKind, StepKinds } from './valueWizard/Steps.jsx';
import usePreview from './valueWizard/usePreview.js';
import { trackingIdOf } from '../lib/useCaseFields';
import { VALUE_LABELS } from '../lib/valueLabels';
import { CASE_PLAN_ROUTE, FALLBACK_NOTICE, answersKey, bodyOf, carryAnswers, driversOn, initialAnswers } from '../lib/valueWizard.js';

const messageOf = (err) => String(err?.message || err || 'The value could not be saved.');
const STEPS = ['Your data', 'Kinds of value', 'Each value', 'By group', 'Save'];
const btn = 'rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-50';
const primary = 'rounded-md bg-db-red-solid hover:bg-db-red-solid-hover px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50';

// REQ-436/437: the Calculate value wizard. The AI reads the data into a case plan (POST case-plan); every amount on screen is the server's
// reply to POST preview; Save sends the answers (shape 2, calculated true) with the plan. `values` saves, reads history and undoes.
export default function CalculateValueDialog({ uc, table, apiPostJson, inspireDatabase, warehouseId, sessionId, saved = null, version = null, values, onClose }) {
  const useCaseId = trackingIdOf(uc);
  const [planState, setPlanState] = useState({ status: 'loading', plan: null, error: '' });
  const [groupBy, setGroupBy] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [answers, setAnswers] = useState(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [savedKey, setSavedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const asked = useRef({ key: '', promise: null });

  useEffect(() => {
    let live = true;
    setPlanState((s) => ({ ...s, status: 'loading', error: '' }));
    const ask = `${groupBy}|${attempt}`;
    // One request per ask, even when the effect runs twice (React strict mode).
    if (asked.current.key !== ask) {
      asked.current = { key: ask, promise: apiPostJson(CASE_PLAN_ROUTE, { inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId),
        use_case_id: useCaseId, table, ...(groupBy ? { group_by: groupBy } : {}) }) };
    }
    asked.current.promise
      .then((got) => {
        if (!live) return;
        if (!got?.plan) throw new Error('Inspire got no plan back for this use case.');
        setPlanState({ status: 'ready', plan: got.plan, error: '' });
        setAnswers((prev) => {
          const next = prev ? carryAnswers(got.plan, prev) : initialAnswers(got.plan, saved);
          if (!prev && saved?.shape === 2 && saved.calculated) setSavedKey(answersKey(next));
          return next;
        });
      })
      .catch((err) => { if (live) setPlanState({ status: 'error', plan: null, error: messageOf(err) }); });
    return () => { live = false; };
  }, [groupBy, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = planState.plan;
  const preview = usePreview(plan && answers ? plan : null, answers, apiPostJson);
  const loadHistory = useCallback(() => values.history(useCaseId).then(setHistory, () => setHistory([])), [values, useCaseId]);
  useEffect(() => { if (version) loadHistory(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = useMemo(() => (plan && answers ? ['data', 'kinds', ...driversOn(plan, answers).map((d) => `driver:${d.id}`), 'groups', 'save'] : ['data']), [plan, answers]);
  const page = pages[Math.min(pageIdx, pages.length - 1)];
  const calculated = Boolean(answers) && savedKey === answersKey(answers);

  const edit = (fn) => { setError(''); setAnswers((a) => fn(a)); };
  const setInput = (id, ask, v) => edit((a) => ({ ...a, drivers: { ...a.drivers, [id]: { ...a.drivers[id], inputs: { ...a.drivers[id].inputs, [ask]: v } } } }));
  const toggleDriver = (id) => edit((a) => ({ ...a, drivers: { ...a.drivers, [id]: { ...a.drivers[id], on: !a.drivers[id].on } } }));
  const toggleGroup = (g) => edit((a) => ({ ...a, excluded_groups: a.excluded_groups.includes(g) ? a.excluded_groups.filter((x) => x !== g) : [...a.excluded_groups, g] }));
  const setCredit = (v) => edit((a) => ({ ...a, attribution_pct: v }));
  const chooseGrouping = (column) => { setGroupBy(column); setSavedKey(''); };

  const save = async () => {
    setBusy(true); setError('');
    try {
      const sent = bodyOf(plan, answers, true).answers;
      await values.run(useCaseId, table, { ...sent, plan: bodyOf(plan, answers).plan });
      setSavedKey(answersKey(answers));
      loadHistory();
    } catch (err) {
      setError(messageOf(err));
    } finally { setBusy(false); }
  };
  const undo = async () => {
    setBusy(true); setError('');
    try {
      const got = await values.undo(useCaseId);
      if (got.answers?.shape === 2 && plan) { setAnswers(initialAnswers(plan, got.answers)); setSavedKey(got.answers.calculated ? answersKey(initialAnswers(plan, got.answers)) : ''); }
      loadHistory();
    } catch (err) {
      setError(messageOf(err));
    } finally { setBusy(false); }
  };

  const mainStep = page === 'data' ? 0 : page === 'kinds' ? 1 : page === 'groups' ? 3 : page === 'save' ? 4 : 2;
  const driver = plan?.drivers.find((d) => page === `driver:${d.id}`);
  const last = page === 'save';
  const anyOn = plan && answers ? driversOn(plan, answers).length > 0 : false;
  const body = () => {
    if (planState.status === 'loading' && !plan) return <p role="status" data-wizard-loading="" className="py-8 text-center text-sm text-text-secondary">Reading your data to plan the value.</p>;
    if (planState.status === 'error') {
      return (
        <div className="space-y-3 py-6 text-center">
          <PlainMessage text={planState.error} role="alert" dir="auto" className="rounded-md border border-error/30 bg-error-bg px-3 py-2 text-[12px] text-error-fg" />
          <button type="button" className={btn} onClick={() => setAttempt((n) => n + 1)}>{VALUE_LABELS.retry}</button>
        </div>
      );
    }
    if (!plan || !answers) return null;
    const yearly = preview.yearly;
    return (
      <>
        {!plan.model && <p role="note" data-fallback-notice="" className="rounded-md border border-warning/40 bg-warning-bg px-3 py-1.5 text-[12px] text-warning-fg">{FALLBACK_NOTICE}</p>}
        {page === 'data' && <StepData plan={plan} answers={answers} onGrouping={chooseGrouping} />}
        {page === 'kinds' && <StepKinds plan={plan} answers={answers} onToggle={toggleDriver} />}
        {driver && <StepKind plan={plan} driver={driver} answers={answers} yearly={yearly} onInput={setInput} status={preview.status} error={preview.error} />}
        {page === 'groups' && <StepGroups plan={plan} answers={answers} onToggleGroup={toggleGroup} />}
        {last && (
          <StepSave plan={plan} answers={answers} yearly={yearly} calculated={calculated} onToggleDriver={toggleDriver} onInput={setInput} onToggleGroup={toggleGroup} onCredit={setCredit}>
            {preview.status === 'error' && <p role="status" className="text-[12px] text-error-fg">{preview.error}</p>}
            <ValueHistory history={history} busy={busy} onUndo={undo} />
          </StepSave>
        )}
        {error && <PlainMessage text={error} role="alert" dir="auto" className="rounded-md border border-error/30 bg-error-bg px-3 py-2 text-[12px] text-error-fg" />}
      </>
    );
  };

  return (
    <ModalDialog titleId="calculate-value-title" title={VALUE_LABELS.dialogTitle} onClose={onClose} widthClass="max-w-4xl"
      footer={(
        <>
          <span data-preview-state={preview.status} className="me-auto text-[12px] text-text-secondary">{plan && answers && preview.status === 'updating' ? 'Updating' : 'Up to date'}</span>
          {pageIdx > 0 && <button type="button" className={btn} onClick={() => setPageIdx((i) => Math.max(0, i - 1))}>Back</button>}
          {last ? (
            <>
              <button type="button" onClick={onClose} className={btn}>Close</button>
              <button type="button" disabled={busy || preview.status !== 'ready'} onClick={save} className={primary}>Save</button>
            </>
          ) : (
            <button type="button" disabled={!plan || !answers || (page === 'kinds' && !anyOn)} onClick={() => setPageIdx((i) => Math.min(pages.length - 1, i + 1))} className={primary}>Next</button>
          )}
        </>
      )}>
      <ol aria-label="Steps" className="flex gap-1 text-[12px]">
        {STEPS.map((name, k) => (
          <li key={name} aria-current={k === mainStep ? 'step' : undefined} className={`flex flex-1 items-center gap-1.5 ${k === mainStep ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${k === mainStep ? 'border-db-red-solid bg-db-red-solid text-white' : k < mainStep ? 'border-ok text-ok' : 'border-border'}`}>{k < mainStep ? '✓' : k + 1}</span>{name}
          </li>
        ))}
      </ol>
      {body()}
    </ModalDialog>
  );
}
