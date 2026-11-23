import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlainMessage } from './TechnicalDetails';
import ModalDialog from './ModalDialog';
import BusyNote from './BusyNote';
import ValueHistory from './ValueHistory';
import MeasureSettings from './valueWizard/MeasureSettings.jsx';
import StepFactors from './valueWizard/StepFactors.jsx';
import StepSave from './valueWizard/StepSave.jsx';
import { StepData, StepKind, StepKinds } from './valueWizard/Steps.jsx';
import usePreview from './valueWizard/usePreview.js';
import { nameOfUseCase, trackingIdOf } from '../lib/useCaseFields';
import { measureOfSaved } from '../lib/measureSettings.js';
import { VALUE_LABELS, dialogTitleFor } from '../lib/valueLabels';
import { outsideValueRange, rangeNote } from '../lib/valueBulk.js';
import { CASE_PLAN_ROUTE, FALLBACK_NOTICE, noModelNotice, answersKey, bodyOf, carryAnswers, driversOn, initialAnswers, reviewLineOf, showsFactors } from '../lib/valueWizard.js';

const messageOf = (err) => String(err?.message || err || 'The value could not be saved.');
const STEPS = ['Kinds of value', 'Your data', 'Each value', 'Save'];
const btn = 'rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-50';
const primary = 'rounded-md bg-db-red-solid hover:bg-db-red-solid-hover px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50';

// REQ-436/437: the Calculate value wizard. The AI reads the data into a case plan (POST case-plan); every amount on screen is the server's
// reply to POST preview; Save sends the answers (shape 2, calculated true) with the plan. `values` saves, reads history and undoes.
export default function CalculateValueDialog({ uc, table, apiPostJson, inspireDatabase, warehouseId, sessionId, saved = null, version = null, values, measure = null, onClose }) {
  const useCaseId = trackingIdOf(uc);
  const [planState, setPlanState] = useState({ status: 'loading', plan: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  const [answers, setAnswers] = useState(null);
  // A link that opens the measure settings (measure.open) lands on Your data, where that section sits; every other opening starts on Kinds of value.
  const [pageIdx, setPageIdx] = useState(measure?.open ? 1 : 0);
  const [savedKey, setSavedKey] = useState('');
  // REQ-496: the accept tick is for the numbers on screen; it starts off with every opening and is lost when a number changes.
  const [acceptedKey, setAcceptedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const asked = useRef({ key: '', promise: null });

  useEffect(() => {
    let live = true;
    setPlanState((s) => ({ ...s, status: 'loading', error: '' }));
    const ask = String(attempt);
    // One request per ask, even when the effect runs twice (React strict mode).
    if (asked.current.key !== ask) {
      asked.current = { key: ask, promise: apiPostJson(CASE_PLAN_ROUTE, { inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId),
        use_case_id: useCaseId, table }) };
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
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = planState.plan;
  const preview = usePreview(plan && answers ? plan : null, answers, apiPostJson);
  const loadHistory = useCallback(() => values.history(useCaseId).then(setHistory, () => setHistory([])), [values, useCaseId]);
  useEffect(() => { if (version) loadHistory(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = useMemo(() => (plan && answers ? ['kinds', 'data', ...driversOn(plan, answers).map((d) => `driver:${d.id}`), ...(showsFactors(plan, answers) ? ['factors'] : []), 'save'] : ['kinds']), [plan, answers]);
  const page = pages[Math.min(pageIdx, pages.length - 1)];
  const calculated = Boolean(answers) && savedKey === answersKey(answers);
  const accepted = Boolean(answers) && acceptedKey === JSON.stringify(answers);

  const edit = (fn) => { setError(''); setAnswers((a) => fn(a)); };
  const setInput = (id, ask, v) => edit((a) => ({ ...a, drivers: { ...a.drivers, [id]: { ...a.drivers[id], inputs: { ...a.drivers[id].inputs, [ask]: v } } } }));
  const toggleDriver = (id) => edit((a) => ({ ...a, drivers: { ...a.drivers, [id]: { ...a.drivers[id], on: !a.drivers[id].on } } }));
  const setFactor = (id, patch) => edit((a) => ({ ...a, economic_factors: { ...a.economic_factors, [id]: { ...a.economic_factors?.[id], ...patch } } }));
  const setCredit = (v) => edit((a) => ({ ...a, attribution_pct: v }));

  // One save for both buttons: Save confirms and closes; Calculate now keeps the numbers as estimated (calculated false) and jumps to the Save step.
  // REQ-472 (c): a plan the model review did not approve is saved as an estimate, as its review line says, even from Save.
  const save = async (confirm = true) => {
    setBusy(true); setError('');
    try {
      const calculated = confirm && plan.review?.approved !== false;
      const sent = bodyOf(plan, answers, calculated).answers;
      // REQ-457: the measure settings ride along: the wizard's live ones, else the saved ones (initialAnswers drops unknown fields).
      await values.run(useCaseId, table, { ...sent, ...(measure ? measure.values : measureOfSaved(saved)), plan: bodyOf(plan, answers).plan });
      // REQ-449: a confirmed save closes the dialog (the card shows the new value); Calculate now stays on the Save step.
      if (confirm) { onClose?.(); return; }
      setSavedKey(''); setPageIdx(pages.length - 1);
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

  const mainStep = page === 'kinds' ? 0 : page === 'data' ? 1 : page === 'save' ? 3 : 2;
  const driver = plan?.drivers.find((d) => page === `driver:${d.id}`);
  const last = page === 'save';
  const anyOn = plan && answers ? driversOn(plan, answers).length > 0 : false;
  // D21/D24: "Up to date" only when a value exists; a missing one says Calculating; no kind ticked says what to tick.
  const footerNote = !plan || !answers ? (planState.status === 'error' ? 'No value yet' : 'Calculating...')
    : !anyOn ? 'Tick a kind of value to calculate.' : preview.status === 'error' ? 'Could not update' : preview.status === 'ready' && preview.yearly ? 'Up to date' : 'Calculating...';
  const body = () => {
    if (planState.status === 'loading' && !plan) return <BusyNote data-wizard-loading="" className="flex flex-col items-center py-8 text-center text-sm text-text-secondary" text="Reading your data to plan the value." />;
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
        {!plan.model && <p role="note" data-fallback-notice="" className="rounded-md border border-warning/40 bg-warning-bg px-3 py-1.5 text-[12px] text-warning-fg">{plan.model_reason ? noModelNotice(plan.model_reason) : FALLBACK_NOTICE}</p>}
        {(page === 'kinds' || last) && reviewLineOf(plan.review) && <p role="note" data-value-review="" className="rounded-md border border-border bg-bg-subtle px-3 py-1.5 text-[12px] text-text-secondary">{reviewLineOf(plan.review)}</p>}
        {page === 'data' && <StepData plan={plan} answers={answers} />}
        {page === 'kinds' && <StepKinds plan={plan} answers={answers} onToggle={toggleDriver} />}
        {page === 'factors' && <StepFactors plan={plan} answers={answers} yearly={yearly} onFactor={setFactor} status={preview.status} error={preview.error} />}
        {driver && <StepKind driver={driver} answers={answers} yearly={yearly} onInput={setInput} status={preview.status} error={preview.error} />}
        {last && yearly && outsideValueRange(yearly.total?.amount) && (
          <p role="note" data-value-range-note="" className="rounded-md border border-warning/40 bg-warning-bg px-3 py-1.5 text-[12px] text-warning-fg">{rangeNote(yearly.total.unit, yearly.total.amount)}</p>
        )}
        {last && (
          <StepSave plan={plan} answers={answers} yearly={yearly} calculated={calculated} onToggleDriver={toggleDriver} onInput={setInput} onCredit={setCredit} status={preview.status}
            accepted={accepted} onAccept={(on) => setAcceptedKey(on ? JSON.stringify(answers) : '')}>
            {preview.status === 'error' && <PlainMessage text={preview.error} role="status" dir="auto" className="text-[12px] text-error-fg" />}
            <ValueHistory history={history} busy={busy} onUndo={undo} />
          </StepSave>
        )}
        {error && <PlainMessage text={error} role="alert" dir="auto" className="rounded-md border border-error/30 bg-error-bg px-3 py-2 text-[12px] text-error-fg" />}
      </>
    );
  };

  return (
    <ModalDialog titleId="calculate-value-title" title={dialogTitleFor(nameOfUseCase(uc))} onClose={onClose} widthClass="max-w-4xl"
      footer={(
        <>
          <span data-preview-state={preview.status} className="me-auto truncate text-[12px] text-text-secondary">{footerNote === 'Calculating...' ? <BusyNote inline text={footerNote} size={12} /> : footerNote}</span>
          {pageIdx > 0 && <button type="button" className={btn} onClick={() => setPageIdx((i) => Math.max(0, i - 1))}>Back</button>}
          {last ? (
            <>
              <button type="button" onClick={onClose} className={btn}>Close</button>
              <button type="button" data-save-button="" disabled={busy || preview.status !== 'ready' || !accepted} onClick={() => accepted && save(true)} className={primary}>{accepted ? 'Accept and save' : 'Tick the box to accept and save'}</button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy || !plan || !answers || !anyOn} title={anyOn ? undefined : 'Tick a kind of value first'} onClick={() => save(false)} className={btn}>Calculate now</button>
              <button type="button" disabled={!plan || !answers || (page === 'kinds' && !anyOn)} onClick={() => setPageIdx((i) => Math.min(pages.length - 1, i + 1))} className={primary}>Next</button>
            </>
          )}
        </>
      )}>
      {/* D23: a fixed frame (header, steps and footer stay put; only this body scrolls) so Next and Save never move under the cursor. */}
      <ol aria-label="Steps" className="flex gap-1 text-[12px]">
        {STEPS.map((name, k) => (
          <li key={name} aria-current={k === mainStep ? 'step' : undefined} className={`flex flex-1 items-center gap-1.5 ${k === mainStep ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${k === mainStep ? 'border-db-red-solid bg-db-red-solid text-white' : k < mainStep ? 'border-ok text-ok' : 'border-border'}`}>{k < mainStep ? '✓' : k + 1}</span>{name}
          </li>
        ))}
      </ol>
      <div data-wizard-body="" className="h-[min(34rem,calc(100dvh-18rem))] space-y-3 overflow-y-auto overscroll-contain">
        {measure && <div hidden={page !== 'data'}><MeasureSettings measure={measure} /></div>}
        {body()}
      </div>
    </ModalDialog>
  );
}
