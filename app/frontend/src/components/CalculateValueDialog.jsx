import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlainMessage } from './TechnicalDetails';
import ModalDialog from './ModalDialog';
import BusyNote from './BusyNote';
import ValueHistory from './ValueHistory';
import MeasureSettings from './valueWizard/MeasureSettings.jsx';
import StepFactors from './valueWizard/StepFactors.jsx';
import StepSave from './valueWizard/StepSave.jsx';
import { StepKind, StepKinds } from './valueWizard/Steps.jsx';
import StepScope from './value/StepScope.jsx';
import StepFilter from './value/StepFilter.jsx';
import StepMacro from './value/StepMacro.jsx';
import StepEconomics from './value/StepEconomics.jsx';
import StepStory from './value/StepStory.jsx';
import usePreview from './valueWizard/usePreview.js';
import { nameOfUseCase, trackingIdOf } from '../lib/useCaseFields';
import { measureOfSaved } from '../lib/measureSettings.js';
import { VALUE_LABELS, dialogTitleFor } from '../lib/valueLabels';
import { outsideValueRange, rangeNote } from '../lib/valueBulk.js';
import { DEFAULT_CURRENCY } from '../lib/moneyDefaults.js';
import { FILTER_ROUTE, SCOPE_ROUTE, filterBodyOfChoice, scopeChoices, scopeOfChoice } from '../lib/valueScope.js';
import { paramsOf, storyAnswers, storyOf } from '../lib/valueStory.js';
import { CASE_PLAN_ROUTE, FALLBACK_NOTICE, noModelNotice, bodyOf, carryAnswers, driversOn, factorsOf, initialAnswers, reviewLineOf, showsFactors } from '../lib/valueWizard.js';

const messageOf = (err) => String(err?.message || err || 'The value could not be saved.');
const STEPS = ['Data', 'Kinds', 'Each kind', 'Value story', 'Terms and accept'];
const btn = 'rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-50';
const primary = 'rounded-md bg-primary-solid hover:bg-primary-solid-hover px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50';
const withoutChoice = ({ choice, ...rest }) => rest; // eslint-disable-line no-unused-vars
// A reopened value keeps the scope it was saved with; which card it was is read back from its structure.
const scopeFromSaved = (s) => (s ? { ...s, choice: s.filters?.length ? 'filter' : s.window ? 'last_12' : 'all' } : null);
const mainStepOf = (page) => (page === 'data' ? 0 : page === 'kinds' ? 1 : page.startsWith('driver:') ? 2 : page === 'story' ? 3 : 4);

// REQ-544: the Calculate value wizard in 5 steps (Data, Kinds, Each kind, Value story, Terms and accept). It opens on the records found
// (POST value/scope) and shows no money; the case plan is asked once, when the Data step is left, with the chosen scope; every amount on
// screen is the server's reply to POST preview; "Accept and save" is the one PUT. `values` saves, reads history and undoes.
export default function CalculateValueDialog({ uc, table, apiPostJson, apiFetch, inspireDatabase, warehouseId, sessionId, saved = null, version = null, values, measure = null, onClose }) {
  const useCaseId = trackingIdOf(uc);
  const base = { inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId), use_case_id: useCaseId, table };
  const [factsState, setFactsState] = useState({ status: 'loading', facts: null, error: '' });
  const [factsTry, setFactsTry] = useState(0);
  const [scope, setScope] = useState(() => scopeFromSaved(saved?.shape === 2 ? saved.scope : null));
  const [planState, setPlanState] = useState({ status: 'idle', plan: null, error: '' });
  const [ask, setAsk] = useState(null);
  const [answers, setAnswers] = useState(null);
  const [page, setPage] = useState('data');
  const [trail, setTrail] = useState([]);
  const pageRef = useRef('data');
  const [savedKey, setSavedKey] = useState('');
  const [done, setDone] = useState(false);
  const [macroPage, setMacroPage] = useState('macro:offer');
  const [macroOpen, setMacroOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const askedFacts = useRef({ key: '', promise: null });
  const asked = useRef({ key: '', promise: null });
  const planKey = useRef('');
  const post = (route, body) => apiPostJson(route, { ...base, ...body });
  const get = useCallback((route, query) => apiFetch(`${route}?${new URLSearchParams(query || {}).toString()}`), [apiFetch]);

  // The records found come first; one request per try, even when the effect runs twice (React strict mode).
  useEffect(() => {
    let live = true;
    setFactsState((s) => ({ ...s, status: 'loading', error: '' }));
    const key = String(factsTry);
    if (askedFacts.current.key !== key) askedFacts.current = { key, promise: apiPostJson(SCOPE_ROUTE, base) };
    askedFacts.current.promise
      .then((got) => {
        if (!live) return;
        if (!got?.facts) throw new Error('Inspire could not read the data for this use case.');
        setFactsState({ status: 'ready', facts: got.facts, error: '' });
      })
      .catch((err) => { if (live) setFactsState({ status: 'error', facts: null, error: messageOf(err) }); });
    return () => { live = false; };
  }, [factsTry]); // eslint-disable-line react-hooks/exhaustive-deps

  // The case plan is asked when the Data step is left, once per scope.
  useEffect(() => {
    if (!ask) return undefined;
    let live = true;
    setPlanState({ status: 'loading', plan: null, error: '' });
    if (asked.current.key !== ask.id) asked.current = { key: ask.id, promise: apiPostJson(CASE_PLAN_ROUTE, { ...base, scope: ask.scope, currency: ask.currency }) };
    asked.current.promise
      .then((got) => {
        if (!live) return;
        if (!got?.plan) throw new Error('Inspire got no plan back for this use case.');
        setPlanState({ status: 'ready', plan: got.plan, error: '' });
        setAnswers((prev) => {
          const next = prev ? carryAnswers(got.plan, prev) : initialAnswers(got.plan, saved);
          return { ...next, scope: ask.scope };
        });
      })
      .catch((err) => { if (live) setPlanState({ status: 'error', plan: null, error: messageOf(err) }); });
    return () => { live = false; };
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = planState.plan;
  const facts = factsState.facts;
  const preview = usePreview(plan && answers ? plan : null, answers, apiPostJson);
  const loadHistory = useCallback(() => values.history(useCaseId).then(setHistory, () => setHistory([])), [values, useCaseId]);
  useEffect(() => { if (version) loadHistory(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = Boolean(plan && answers);
  const hasMacro = ready && (plan.economic_factors || []).length > 0;
  const pages = useMemo(() => ['data', 'kinds', ...(ready ? [...driversOn(plan, answers).map((d) => `driver:${d.id}`), 'story', 'terms'] : [])], [plan, answers, ready]);
  // The recommended scope card starts picked, so Next works from the Data step; the person can pick another.
  useEffect(() => {
    if (!facts || scope) return;
    const pick = scopeChoices(facts).find((c) => c.recommended) || { id: 'all', label: 'All data' };
    setScope({ ...(scopeOfChoice(pick.id, facts) || { phrase: pick.label, filters: [], window: null }), choice: pick.id });
  }, [facts, scope]);

  const trailRef = useRef([]);
  const go = (p) => { setError(''); setDone(false); trailRef.current = [...trailRef.current, pageRef.current]; setTrail(trailRef.current); pageRef.current = p; setPage(p); };
  const back = () => {
    setError('');
    const p = trailRef.current[trailRef.current.length - 1];
    if (!p) return;
    setDone(false);
    trailRef.current = trailRef.current.slice(0, -1); setTrail(trailRef.current); pageRef.current = p; setPage(p);
  };
  const calculated = Boolean(answers) && savedKey === JSON.stringify([answers.scope, answers.drivers, answers.economics, answers.attribution_pct]);

  const edit = (fn) => { setError(''); setAnswers((a) => fn(a)); };
  const setInput = (id, askId, v) => edit((a) => ({ ...a, drivers: { ...a.drivers, [id]: { ...a.drivers[id], inputs: { ...a.drivers[id].inputs, [askId]: v } } } }));
  const toggleDriver = (id) => edit((a) => ({ ...a, drivers: { ...a.drivers, [id]: { ...a.drivers[id], on: !a.drivers[id].on } } }));
  const setFactor = (id, patch) => edit((a) => ({ ...a, economic_factors: { ...a.economic_factors, [id]: { ...a.economic_factors?.[id], ...patch } } }));
  const setCredit = (v) => edit((a) => ({ ...a, attribution_pct: v }));
  const setEconomics = (e) => edit((a) => ({ ...a, economics: e }));
  const setConfidence = (c) => edit((a) => ({ ...a, confidence: c }));
  // A market series saved into the plan moves its factor to the public value and ticks it: the person chose it.
  const setPlan = (next) => {
    const moved = factorsOf(next).filter((f) => { const old = factorsOf(plan).find((o) => o.id === f.id); return old && old.likely_pct !== f.likely_pct; });
    setPlanState((s) => ({ ...s, plan: next }));
    if (moved.length) edit((a) => ({ ...a, economic_factors: { ...a.economic_factors, ...Object.fromEntries(moved.map((f) => [f.id, { on: true, pct: Number(f.likely_pct) }])) } }));
  };
  // One parameter of the story table edited: an estimate, a cost, the ramp or a factor.
  const setParam = (id, v) => {
    if (id === 'ramp_pct') return setEconomics({ ...answers.economics, ramp_pct: v });
    if (id === 'build_cost' || id === 'run_cost_per_year') { const e = { ...answers.economics, [id]: v }; if (!v) delete e[id]; return setEconomics(e); }
    const f = factorsOf(plan).find((x) => x.id === id);
    if (f) { setPlanState((s) => ({ ...s, plan: { ...s.plan, economic_factors: factorsOf(s.plan).map((x) => (x.id === id ? { ...x, likely_pct: v } : x)) } })); return setFactor(id, { pct: v }); }
    const d = driversOn(plan, answers).find((x) => x.asks.some((a) => a.id === id && a.source === 'estimate'));
    return d ? setInput(d.id, id, v) : undefined;
  };
  const setOwner = (id, text) => edit((a) => ({ ...a, story: { ...a.story, owners: { ...a.story?.owners, [id]: text } } }));

  // The one save: Accept and save. REQ-472 (c): a plan the model review did not approve is saved as an estimate, as its review line says.
  // REQ-442/497: Calculate now is the same save with calculated false (a Provisional estimate), from any page before the Terms step.
  const save = async (final, accepted = true) => {
    setBusy(true); setError('');
    try {
      const confirmed = accepted && plan.review?.approved !== false;
      const sent = bodyOf(plan, final, confirmed).answers;
      // REQ-457: the measure settings ride along: the wizard's live ones, else the saved ones (initialAnswers drops unknown fields).
      await values.run(useCaseId, table, { ...sent, ...(measure ? measure.values : measureOfSaved(saved)), plan: bodyOf(plan, final).plan });
      setSavedKey(confirmed ? JSON.stringify([final.scope, final.drivers, final.economics, final.attribution_pct]) : '');
      if (pageRef.current !== 'terms') go('terms');
      setDone(true);
      loadHistory();
    } catch (err) {
      setError(messageOf(err));
    } finally { setBusy(false); }
  };
  const approve = (storyAns) => {
    const final = { ...answers, story: { ...answers.story, ...storyAns } };
    setAnswers(final);
    return save(final);
  };
  const calculateNow = () => save(answers, false);
  const undo = async () => {
    setBusy(true); setError('');
    try {
      const got = await values.undo(useCaseId);
      if (got.answers?.shape === 2 && plan) { setAnswers(initialAnswers(plan, got.answers)); setSavedKey(''); }
      loadHistory();
    } catch (err) {
      setError(messageOf(err));
    } finally { setBusy(false); }
  };

  const onNext = async () => {
    setError('');
    if (page === 'data') {
      let chosen = scope;
      if (scope?.choice === 'last_12' && scope.rows_after == null) {
        setBusy(true);
        try {
          const out = await post(FILTER_ROUTE, filterBodyOfChoice('last_12', facts));
          if (!out?.scope) throw new Error('Inspire could not count the last 12 months.');
          chosen = { ...out.scope, choice: 'last_12' };
          setScope(chosen);
        } catch (err) { setError(messageOf(err)); setBusy(false); return; }
        setBusy(false);
      }
      const body = withoutChoice(chosen);
      const currency = answers?.currency || saved?.currency || DEFAULT_CURRENCY;
      const key = JSON.stringify([body, currency]);
      if (planKey.current !== key) { planKey.current = key; setAsk((a) => ({ id: (a?.id || 0) + 1, scope: body, currency })); }
      return go('kinds');
    }
    return go(pages[pages.indexOf(page) + 1]);
  };

  const noun = plan?.case_noun || saved?.plan?.case_noun || facts?.noun || 'record';
  const driver = plan?.drivers.find((d) => page === `driver:${d.id}`);
  const last = page === 'terms';
  const anyOn = ready ? driversOn(plan, answers).length > 0 : false;
  const scopeDone = scope?.choice && (scope.choice !== 'filter' || Number.isFinite(Number(scope.rows_after)));
  const nextOff = busy || (page === 'data' && (!facts || !scopeDone)) || (page !== 'data' && !ready) || (page === 'kinds' && !anyOn);
  const calcOff = busy || !ready || !anyOn;
  const calcWhy = !ready ? 'Finish the Data step first' : !anyOn ? 'Tick a kind of value first' : 'Save these numbers as a provisional estimate';
  const money = page !== 'data';
  // D21/D24: "Up to date" only when a value exists; a missing one says Calculating; no kind ticked says what to tick. No money before the Data step is done.
  const footerBusy = money && (!ready ? planState.status !== 'error' : anyOn && preview.status !== 'error' && !(preview.status === 'ready' && preview.yearly));
  const footerNote = !money || footerBusy ? '' : !ready ? 'No value yet'
    : !anyOn ? 'Tick a kind of value to calculate.' : preview.status === 'error' ? 'Could not update' : 'Up to date';
  const yearly = preview.yearly;
  const errorBox = error && <PlainMessage text={error} role="alert" dir="auto" className="rounded-md border border-error/30 bg-error-bg px-3 py-2 text-[12px] text-error-fg" />;
  // The macro folds have their own sub-pages; a page outside them (Keep my own estimates) closes the fold.
  const onMacroPage = (p) => { if (p.startsWith('macro:')) setMacroPage(p); else { setMacroPage('macro:offer'); setMacroOpen(false); } };
  const fold = 'rounded-lg border border-border px-3 py-1.5';
  const foldTitle = 'cursor-pointer text-[13px] font-semibold text-text-primary';
  const body = () => {
    if (page === 'data') {
      if (factsState.status === 'error') {
        return (
          <div className="space-y-3 py-6 text-center">
            <PlainMessage text={factsState.error} role="alert" dir="auto" className="rounded-md border border-error/30 bg-error-bg px-3 py-2 text-[12px] text-error-fg" />
            <button type="button" className={btn} onClick={() => setFactsTry((n) => n + 1)}>{VALUE_LABELS.retry}</button>
          </div>
        );
      }
      if (!facts) return <BusyNote data-wizard-loading="" className="flex flex-col items-center py-8 text-center text-sm text-text-secondary" text="Reading your data." />;
      const counted = Number.isFinite(Number(scope?.rows_after)) && scope?.choice !== 'all';
      return (
        <div data-wizard-page="data" className="space-y-3">
          {['scope:facts', 'scope:choice'].map((p) => (
            <StepScope key={p} page={p} facts={facts} scope={scope} useCase={{ noun }} post={post}
              onScope={(s) => { setError(''); setScope(s); }} onFacts={(f) => { setFactsState({ status: 'ready', facts: f, error: '' }); setScope(null); }} />
          ))}
          {scope?.choice === 'filter' && <StepFilter facts={facts} scope={scope} post={post} onScope={(s) => setScope(s)} />}
          {counted && <p data-scope-count="" className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm font-semibold text-text-primary">{`After the filter: ${Number(scope.rows_after).toLocaleString('en-US')} of ${Number(scope.rows_before ?? facts.rows).toLocaleString('en-US')} ${noun}s`}</p>}
          {errorBox}
        </div>
      );
    }
    if (planState.status === 'error') {
      return (
        <div className="space-y-3 py-6 text-center">
          <PlainMessage text={planState.error} role="alert" dir="auto" className="rounded-md border border-error/30 bg-error-bg px-3 py-2 text-[12px] text-error-fg" />
          <button type="button" className={btn} onClick={() => setAsk((a) => ({ ...a, id: a.id + 1 }))}>{VALUE_LABELS.retry}</button>
        </div>
      );
    }
    if (!ready) return <BusyNote data-wizard-loading="" className="flex flex-col items-center py-8 text-center text-sm text-text-secondary" text="Reading your data to plan the value." />;
    const ticked = driversOn(plan, answers);
    const story = storyOf({ useCase: nameOfUseCase(uc), noun, currency: answers.currency, scope: answers.scope, drivers: ticked, projection: yearly?.projection, economics: answers.economics });
    const params = paramsOf(plan, answers, yearly);
    const kindAt = driver ? ticked.findIndex((d) => d.id === driver.id) + 1 : 0;
    return (
      <>
        {!plan.model && <p role="note" data-fallback-notice="" className="rounded-md border border-warning/40 bg-warning-bg px-3 py-1.5 text-[12px] text-warning-fg">{plan.model_reason ? noModelNotice(plan.model_reason) : FALLBACK_NOTICE}</p>}
        {(page === 'kinds' || last) && reviewLineOf(plan.review) && <p role="note" data-value-review="" title={last ? reviewLineOf(plan.review) : undefined} className={`rounded-md border border-border bg-bg-subtle px-3 py-1 text-[12px] text-text-secondary${last ? ' truncate' : ''}`}>{reviewLineOf(plan.review)}</p>}
        {page === 'kinds' && <StepKinds plan={plan} answers={answers} onToggle={toggleDriver} />}
        {driver && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 data-kind-title="" className="text-2xl font-bold text-text-primary">{driver.label}</h2>
              <p data-kind-count="" className="text-[13px] text-text-secondary">{`Kind ${kindAt} of ${ticked.length}`}</p>
            </div>
            <StepKind driver={driver} answers={answers} yearly={yearly} onInput={setInput} status={preview.status} error={preview.error} />
          </>
        )}
        {page === 'story' && (
          <>
            <StepStory page="draft" story={story} polish={null} params={params} currency={answers.currency} />
            <details data-story-numbers="" className={fold}>
              <summary className={foldTitle}>{`Every number behind the story (${params.length})`}</summary>
              <div className="mt-2"><StepStory page="params" story={story} polish={null} params={params} currency={answers.currency} onValue={setParam} onOwner={setOwner} /></div>
            </details>
            <details data-assumptions="" className={fold}>
              <summary className={foldTitle}>Assumptions</summary>
              <div className="mt-2 space-y-2">
                <details data-assumption="ramp-cost" open className={fold}>
                  <summary className={foldTitle}>Ramp and cost</summary>
                  <div className="mt-2 space-y-3">
                    <StepEconomics page="ramp" answers={answers} currency={answers.currency} projection={yearly?.projection} onEconomics={setEconomics} onCredit={setCredit} onConfidence={setConfidence} />
                    <StepEconomics page="cost" answers={answers} currency={answers.currency} projection={yearly?.projection} onEconomics={setEconomics} onCredit={setCredit} onConfidence={setConfidence} />
                  </div>
                </details>
                {showsFactors(plan, answers) && (
                  <details data-assumption="factors" className={fold}>
                    <summary className={foldTitle}>Market and customer factors</summary>
                    <div className="mt-2"><StepFactors plan={plan} answers={answers} yearly={yearly} onFactor={setFactor} status={preview.status} error={preview.error} /></div>
                  </details>
                )}
                {hasMacro && (
                  <details data-assumption="macro" open={macroOpen} onToggle={(e) => setMacroOpen(e.currentTarget.open)} className={fold}>
                    <summary className={foldTitle}>Public market data</summary>
                    <div className="mt-2"><StepMacro plan={plan} onPlan={setPlan} get={get} inspireDatabase={inspireDatabase} warehouseId={warehouseId} page={macroPage} onPage={onMacroPage} /></div>
                  </details>
                )}
              </div>
            </details>
          </>
        )}
        {last && (
          <StepSave plan={plan} answers={answers} yearly={yearly} calculated={calculated} saved={done} busy={busy}
            onAccept={({ include }) => { const final = { ...answers, story: { ...answers.story, ...storyAnswers({ text: story.text, params, include_in_docs: include }) } }; setAnswers(final); return save(final); }}>
            {done && yearly && outsideValueRange(yearly.total?.amount) && (
              <p role="note" data-value-range-note="" className="rounded-md border border-warning/40 bg-warning-bg px-3 py-1.5 text-[12px] text-warning-fg">{rangeNote(yearly.total.unit, yearly.total.amount)}</p>
            )}
            {preview.status === 'error' && <PlainMessage text={preview.error} role="status" dir="auto" className="text-[12px] text-error-fg" />}
            {done && <ValueHistory history={history} busy={busy} onUndo={undo} />}
          </StepSave>
        )}
        {errorBox}
      </>
    );
  };

  const step = mainStepOf(page);
  return (
    <ModalDialog titleId="calculate-value-title" title={dialogTitleFor(nameOfUseCase(uc))} onClose={onClose} closeLabel={done ? 'Dismiss' : 'Close'} widthClass="max-w-4xl"
      footer={(
        <>
          <span data-preview-state={preview.status} className="me-auto min-h-[34px] truncate text-[12px] leading-[34px] text-text-secondary">{footerBusy ? <BusyNote inline text="Calculating..." size={14} /> : footerNote}</span>
          {trail.length > 0 && !(last && busy) && <button type="button" className={btn} onClick={back}>Back</button>}
          {last ? (
            done && <button type="button" onClick={onClose} className={primary}>Close</button>
          ) : (
            <>
              <button type="button" disabled={calcOff} title={calcWhy} onClick={calculateNow} className={btn}>Calculate now</button>
              {!last && <button type="button" disabled={nextOff} onClick={onNext} className={primary}>Next</button>}
            </>
          )}
        </>
      )}>
      {/* D23: a fixed frame (header, steps and footer stay put; only this body scrolls) so Next and Save never move under the cursor. */}
      <ol aria-label="Steps" className="flex gap-1 text-[12px]">
        {STEPS.map((name, k) => (
          <li key={name} aria-current={k === step ? 'step' : undefined} className={`flex flex-1 items-center gap-1.5 ${k === step ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-caption ${k === step ? 'border-primary-solid bg-primary-solid text-white' : k < step ? 'border-ok text-ok' : 'border-border'}`}>{k < step ? '✓' : k + 1}</span>{name}
          </li>
        ))}
      </ol>
      <div data-wizard-body="" className="h-[min(44rem,calc(100dvh-15rem))] space-y-2 overflow-y-auto overscroll-contain">
        {measure && <div hidden={page !== 'data'}><MeasureSettings measure={measure} /></div>}
        <div key={page} className="tab-panel-enter space-y-2">{body()}</div>
      </div>
    </ModalDialog>
  );
}
