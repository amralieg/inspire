// REQ-542 (W-4): the One-by-One wizard. It renders page.focus_spec (the AI wrote it; the App makes no model call while you look):
// one record at a time, one plain question per step, a visual block, a compare toggle, a decision on the last step.
import { useEffect, useMemo, useRef, useState } from 'react';
import { actRecords, askGenie as sendAsk, getRecords } from './api.js';
import { genieAnswer, genieOn } from './genieAsk.js';
import { guideOf } from './guide.js';
import { StepBody } from './GuidedAnswer.jsx';
import { GenieMark } from './icons.jsx';
import { actionValues, decideChoices, FOCUS_MODE, NOTE_FIELDS, queueOf, stepsOf, summaryOf } from './focus.js';
import { useMyView } from './MyView.jsx';
import { motionOf } from './onboarding.js';
import { prefersReduced } from './viz/motion.js';
import { actError, recordKeyOf } from './records.js';
import TermChip from './TermChip.jsx';
import { PlainNote } from './ui.jsx';
import { BLOCKS } from './viz/index.js';
import Strip from './viz/Strip.jsx';
import TrendBand from './viz/TrendBand.jsx';
import './styles/focus.css';

const LOAD = 200;
const COMPARE_NAMES = { history: 'History', cohort: 'Cohort', picked: 'Picked', population: 'Population' };
const THIS = 'This record';
const keyOf = (row) => String(recordKeyOf(row) ?? '');
// The record's name is the column the spec binds to a label role; without one it is the record key.
const nameOf = (row, spec) => {
  const column = (spec?.steps || []).map((s) => s.visual?.bind?.label).find(Boolean);
  return String((column && row?.[column]) || keyOf(row));
};

// The key a block uses to find the focus row: the same column its tidy() reads, else the row's position.
const BIND_KEYS = ['key', 'label', 'stage', 'group', 'region', 'time', 'x', 'source'];
function focusOf(bind, row, rows) {
  const role = BIND_KEYS.find((r) => bind?.[r] != null);
  return role ? String(row?.[bind[role]] ?? '') : String(rows.indexOf(row));
}

// GET records/compare lands later (REQ-531). A 404 means this App does not have it yet: the toggle is hidden.
async function getCompare(page, key, mode, measure, cohortColumn, keys) {
  const q = new URLSearchParams({ page, record_key: key, mode, measure, ...(mode === 'cohort' && cohortColumn ? { cohort_column: cohortColumn } : {}), ...(mode === 'picked' && keys.length ? { keys: keys.join(',') } : {}) });
  const response = await fetch(`./api/records/compare?${q}`, { credentials: 'same-origin' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('The comparison could not load.');
  return response.json();
}

function fill(template, row, bind, name, reference) {
  const value = row?.[bind?.value];
  const words = { record: name, value: value == null ? '' : String(value), reference: reference || 'the rest of the list' };
  return String(template || '').replace(/\{(\w+)\}/g, (_, k) => words[k] ?? '');
}

function Visual({ step, rows, row, level }) {
  const Block = BLOCKS[step.visual.block];
  if (!Block) return null;
  return <Block rows={rows} bind={step.visual.bind} focus={focusOf(step.visual.bind, row, rows)} motion={step.motion} motionLevel={level} />;
}

function Terms({ step, kind, row, name }) {
  return (step.terms || []).map((t) => <TermChip key={typeof t === 'string' ? t : t.term} term={typeof t === 'string' ? t : t.term} kind={kind} context={`${name}: ${step.question}`} />);
}

function StepView({ step, rows, row, name, kind, level, reference, children }) {
  return (
    <div className="focus-step" data-focus-step data-step-id={step.id}>
      <h3 className="focus-q" data-focus-question>{step.question}</h3>
      <Visual step={step} rows={rows} row={row} level={level} />
      <p className="focus-line" data-focus-line>{fill(step.answer_template, row, step.visual.bind, name, reference)}</p>
      <div className="focus-terms"><Terms step={step} kind={kind} row={row} name={name} /></div>
      {children}
    </div>
  );
}

function Compare({ page, spec, step, row, items, level, onGone }) {
  const visual = step.visual;
  const [mode, setMode] = useState(visual.default_compare ? visual.compare : null);
  const [out, setOut] = useState(null);
  const [failed, setFailed] = useState('');
  const key = keyOf(row);
  const cohort = spec.queue?.cohort_column || null;
  const modes = Object.keys(COMPARE_NAMES).filter((m) => m !== 'cohort' || cohort);
  const others = useMemo(() => items.filter((r) => keyOf(r) !== key).slice(0, 3).map(keyOf), [items, key]);
  useEffect(() => {
    if (!mode) return undefined;
    let live = true;
    setOut(null);
    setFailed('');
    getCompare(page.id, key, mode, step.visual.bind.value, cohort, others)
      .then((reply) => { if (!live) return; if (reply === null) onGone(); else setOut(reply); })
      .catch((err) => { if (live) setFailed(err.message); });
    return () => { live = false; };
  }, [mode, key]);
  const timed = out && (out.mode === 'history' || out.points?.some((p) => p.t != null));
  const rows = out ? [...out.points.map((p) => ({ label: p.name, value: p.x, t: p.t ?? '', low: out.band?.[0], high: out.band?.[1] })), { label: THIS, value: out.this.x, t: out.this.t ?? 'Now', low: out.band?.[0], high: out.band?.[1] }] : [];
  const bind = timed ? { time: 't', value: 'value', ...(out?.band ? { low: 'low', high: 'high' } : {}) } : { label: 'label', value: 'value' };
  const Chart = timed ? TrendBand : Strip;
  return (
    <div className="focus-compare" data-focus-compare>
      <div role="group" aria-label="Compare with" className="focus-seg">
        {modes.map((m) => <button key={m} type="button" className="btn btn--sm" aria-pressed={mode === m} onClick={() => setMode(m)}>{COMPARE_NAMES[m]}</button>)}
      </div>
      {mode && (
        <div className="focus-cmp-chart" data-focus-compare-chart data-mode={out?.mode || ''}>
          {out && <Chart rows={rows} bind={bind} focus={timed ? 'Now' : THIS} motion={step.motion} motionLevel={level} />}
          {out?.note && <p className="focus-note">{out.note}</p>}
          {failed && <p className="focus-note" role="alert">{failed}</p>}
        </div>
      )}
    </div>
  );
}

function AskHere({ app, page, step, row, name, kind }) {
  const [state, setState] = useState(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!genieOn(app, page.id) || !(step.ask || []).length) return null;
  const run = async (question) => {
    setState({ busy: true });
    try {
      const started = await sendAsk(page.id, `${name}: ${question}`, '', { recordKey: keyOf(row) });
      const answer = await genieAnswer(page.id, started, { alive: () => alive.current });
      if (alive.current) setState({ answer });
    } catch (err) {
      if (alive.current) setState({ error: err.message || 'Genie could not answer.' });
    }
  };
  const guide = state?.answer ? guideOf(state.answer, { kind }) : null;
  const look = guide?.steps.find((s) => s.id === 'look');
  return (
    <section className="focus-ask" aria-label="Ask Genie about this item">
      <h4><GenieMark size={13} />Ask Genie about this</h4>
      <div className="g-sugg">{step.ask.map((q) => <button key={q} type="button" className="sugg" disabled={!!state?.busy} onClick={() => run(q)}>{q}</button>)}</div>
      {state?.busy && <p className="focus-note" role="status">Genie is working on it.</p>}
      {state?.error && <PlainNote text={state.error} className="focus-note" role="alert" />}
      {state?.answer && (
        <div className="focus-answer" data-focus-answer>
          {state.answer.text && <p>{state.answer.text}</p>}
          {look && <StepBody step={look} genie={null} onStart={() => {}} context={name} />}
        </div>
      )}
    </section>
  );
}

function Decide({ choices, busy, onPick }) {
  const [asking, setAsking] = useState(null);
  const [note, setNote] = useState('');
  const field = asking && NOTE_FIELDS[asking.action];
  if (field) {
    return (
      <form className="focus-note-form" data-focus-note onSubmit={(e) => { e.preventDefault(); onPick(asking, note.trim()); }}>
        <label>{field[0]}<input type={field[1]} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} required autoFocus /></label>
        <button type="submit" className="btn btn--pri" disabled={busy}>Confirm</button>
        <button type="button" className="btn" onClick={() => { setAsking(null); setNote(''); }}>Cancel</button>
      </form>
    );
  }
  return (
    <div className="focus-choices" data-focus-decide role="group" aria-label="Decide">
      {choices.map((c) => (
        <button key={c.label} type="button" className="btn focus-choice" aria-label={c.label} title={c.detail} disabled={busy} onClick={() => (NOTE_FIELDS[c.action] ? setAsking(c) : onPick(c, ''))}>
          <b>{c.label}</b><span>{c.detail}</span>
        </button>
      ))}
    </div>
  );
}

function Summary({ log, choices, onSwitch }) {
  const sum = summaryOf(log);
  const names = Object.fromEntries(choices.map((c) => [c.action, c.label]));
  return (
    <section className="focus-summary" data-focus-summary aria-label="Finished">
      <h3>All done</h3>
      <ul>
        {Object.keys(sum).filter((k) => k !== 'total' && (sum[k] > 0)).map((k) => <li key={k} data-sum={k}><b>{sum[k]}</b> {k === 'skipped' ? 'Skipped' : names[k] || k}</li>)}
      </ul>
      <button type="button" className="btn" onClick={() => onSwitch(null)}>Switch to All records</button>
    </section>
  );
}

// The drawer in All records: every step of the spec stacked, for the open record.
export function FocusStack({ spec, rows, row, kind }) {
  const { prefs } = useMyView();
  const steps = stepsOf(spec);
  if (!steps.length || !row) return null;
  const level = motionOf(prefs, prefersReduced());
  const list = rows.includes(row) ? rows : [row, ...rows];
  return (
    <section className="focus-stack sec" data-focus-stack aria-label="Steps for this record">
      <div className="focus-mode" role="group" aria-label="Work mode">
        <button type="button" aria-pressed="false" onClick={() => window.dispatchEvent(new CustomEvent(FOCUS_MODE, { detail: { mode: 'one' } }))}>One by one</button>
        <button type="button" aria-pressed="true">All records</button>
      </div>
      {steps.map((s) => <StepView key={s.id} step={s} rows={list} row={row} name={nameOf(row, spec)} kind={kind || spec.technique_kind} level={level} />)}
    </section>
  );
}

export default function Focus({ app, page, spec, filters, prefs, start, onSwitch, onCount, onPlace, onChanged }) {
  const steps = stepsOf(spec);
  const choices = decideChoices(spec);
  const level = motionOf(prefs || {}, prefersReduced());
  const kind = page.kind || spec.technique_kind;
  const [load, setLoad] = useState({ items: null, error: '' });
  const [at, setAt] = useState({ i: 0, step: 0 });
  const [log, setLog] = useState([]);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [gone, setGone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    let live = true;
    getRecords({ page: page.id, filters, offset: 0, limit: LOAD })
      .then((data) => {
        if (!live) return;
        const items = queueOf(data?.rows || [], spec.queue);
        const found = start?.key ? items.findIndex((r) => keyOf(r) === String(start.key)) : -1;
        setAt(found >= 0 ? { i: found, step: Math.min(start.step || 0, steps.length - 1) } : { i: 0, step: 0 });
        setLoad({ items, error: '' });
        onCount?.(items.length);
      })
      .catch((err) => { if (live) setLoad({ items: [], error: err.message || 'The records could not load.' }); });
    return () => { live = false; };
  }, [page.id, JSON.stringify(filters)]);
  const items = load.items || [];
  const row = items[at.i] || null;
  const key = row ? keyOf(row) : '';
  useEffect(() => { if (key) onPlace?.({ key, step: at.step }); }, [key, at.step]);
  useEffect(() => { setProblem(''); setGone(false); }, [key]);

  if (!steps.length) return null;
  if (!load.items) return <p className="focus-note" role="status">Loading the records.</p>;
  if (load.error) return <p className="focus-note" role="alert">{load.error}</p>;
  const finished = at.i >= items.length;
  if (!items.length) return <section className="focus-summary" data-focus-summary><h3>Nothing needs you</h3><button type="button" className="btn" onClick={() => onSwitch(null)}>Switch to All records</button></section>;
  if (finished) return <Summary log={log} choices={choices} onSwitch={onSwitch} />;

  const step = steps[at.step];
  const name = nameOf(row, spec);
  const next = (action) => {
    setLog((l) => [...l, { key, action }]);
    setAt({ i: at.i + 1, step: 0 });
    setChecked(false);
  };
  const pick = async (choice, note) => {
    setBusy(true);
    setProblem('');
    try {
      await actRecords({ page: page.id, record_keys: [key], action: choice.action, values: actionValues(choice.action, note) });
      onChanged?.();
      if (level === 'off') next(choice.action);
      else { setChecked(true); timer.current = setTimeout(() => next(choice.action), 450); }
    } catch (err) {
      setProblem(actError(err));
    } finally {
      setBusy(false);
    }
  };
  const last = at.step === steps.length - 1;
  return (
    <section className="focus" data-focus aria-label="One by one">
      <header className="focus-head">
        <span className="focus-count" data-focus-count>Item {at.i + 1} of {items.length}</span>
        <ol className="focus-dots" data-focus-dots aria-label="Steps">
          {steps.map((s, n) => <li key={s.id} data-dot aria-current={n === at.step ? 'step' : undefined} className={n <= at.step ? 'is-on' : ''} />)}
        </ol>
      </header>
      <div className={`focus-item${checked ? ' is-saved' : ''}`} data-focus-item data-key={key} key={key}>
        <h2 className="focus-name">{name}</h2>
        <StepView key={step.id} step={step} rows={items} row={row} name={name} kind={kind} level={level}>
          {step.visual.compare && !gone && <Compare key={`${key}:${step.id}`} page={page} spec={spec} step={step} row={row} items={items} level={level} onGone={() => setGone(true)} />}
          {last && <Decide choices={choices} busy={busy || checked} onPick={pick} />}
          {checked && <svg className="focus-check" viewBox="0 0 24 24" role="img" aria-label="Saved"><path d="M5 13l4 4 10-10" /></svg>}
          {problem && <p className="focus-problem" role="alert">{problem}</p>}
          <AskHere app={app} page={page} step={step} row={row} name={name} kind={kind} />
        </StepView>
      </div>
      <footer className="focus-nav">
        <button type="button" className="btn" disabled={at.step === 0} onClick={() => setAt({ ...at, step: at.step - 1 })}>Back</button>
        {!last && <button type="button" className="btn btn--pri" onClick={() => setAt({ ...at, step: at.step + 1 })}>Next</button>}
        <button type="button" className="btn" onClick={() => next('skip')}>Skip item</button>
        <button type="button" className="btn" onClick={() => onSwitch(key)}>Switch to All records</button>
      </footer>
    </section>
  );
}
