import { Suspense, lazy, useEffect, useState } from 'react';
import { decidePlan, getRecords, runSettingsNow } from './api.js';
import { formatValue, integer, numberOf } from './format.js';
import { recordKeyOf } from './records.js';
import { Icon, GenieMark } from './icons.jsx';
import { Skeleton, useToast } from './ui.jsx';
import { genieOn } from './genieAsk.js';
import { ChartsReady, SECTION_PARTS } from './KindParts.jsx';

const ScenarioPanel = lazy(() => import('./Scenario.jsx'));

export const DEFAULT_LAYOUT = 'decision_queue';
export const layoutOf = (page) => page?.layout?.id || DEFAULT_LAYOUT;
export const isLaidOut = (page) => layoutOf(page) !== DEFAULT_LAYOUT;
export const tabLabel = (page, fallback) => (isLaidOut(page) && page.layout?.tab_label) || fallback;
export const decides = (page) => !!page?.records && page?.layout?.decides !== false;
const PLAN_ROWS = 50;
const TODO_ROWS = 5;

const scrollTo = (section) => document.querySelector(`[data-section="${section}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function useList(pageId, filters, ready, nonce, limit, on = true, view = null) {
  const [state, setState] = useState({ data: null, error: '' });
  const key = JSON.stringify([filters || {}, view || {}]);
  useEffect(() => {
    if (!ready || !on) return undefined;
    let live = true;
    getRecords({ ...(view || {}), page: pageId, filters: filters || {}, offset: 0, limit })
      .then((data) => live && setState({ data, error: '' }))
      .catch((e) => live && setState({ data: null, error: e.message }));
    return () => { live = false; };
  }, [pageId, key, ready, nonce, limit, on]);
  return state;
}

const decisionSection = (page) => Object.keys(page?.layout?.holds || {}).find((s) => ['plan', 'records'].includes(page.layout.holds[s])) || 'records';

export function todoSteps(page, list, genie, modify = false) {
  const label = page.records?.label;
  const to = decisionSection(page);
  const first = list?.rows?.[0];
  const steps = [];
  if (page.scenario) {
    const levers = Object.keys(page.layout?.holds || {}).find((s) => page.layout.holds[s] === 'levers');
    steps.push({ id: 'levers', text: `Move the levers and watch the ${(page.scenario.outcome?.label || 'outcome').toLowerCase()} and its P10 to P90 range.`, action: 'Show me', to: levers });
    if (page.scenario.save && modify) steps.push({ id: 'save', text: 'Name and save the scenario you want to plan on, so your team sees it.', action: null });
  } else if (!decides(page)) {
    steps.push({ id: 'read', text: page.question || page.title, action: null });
    steps.push({ id: 'so_what', text: 'Read the “So what” line under each chart: it says what to do with it.', action: null });
  } else if (first) {
    steps.push({ id: 'first', text: `Start with ${first[label] ?? recordKeyOf(first)}: it is first in the list because it matters most.`, action: 'Show me', to });
    steps.push(page.plan
      ? { id: 'plan', text: 'Take the ★ suggested line in the plan, or override it with a reason.', action: 'Open the plan', to }
      : { id: 'down', text: 'Work down the list in order and record what you did on each one.', action: null });
  }
  if (genie) steps.push({ id: 'genie', text: 'Not sure where to start? Ask Genie what to do first and why.', action: 'Ask Genie', ask: true });
  return steps;
}

export function TodoNow({ page, app, ready, nonce, onAsk }) {
  const decided = decides(page);
  const list = useList(page.id, {}, ready, nonce, TODO_ROWS, decided);
  const genie = genieOn(app, page.id) && !!onAsk;
  const steps = todoSteps(page, list.data, genie, !!app?.options?.modify);
  const summary = list.data?.summary;
  const waiting = summary?.open ?? list.data?.total ?? 0;
  const all = Math.max(waiting, (summary?.open ?? 0) + (summary?.done ?? 0), list.data?.total ?? 0);
  return (
    <section className="todo card" aria-label="What to do now" data-section="todo">
      <header className="card-h"><div><h2>What to do now</h2>
        {decided && list.data && <p data-todo-count>{all ? `${integer(waiting)} of ${integer(all)} waiting for you` : 'Nothing is waiting for you right now'}</p>}
        {decided && !list.data && !list.error && <Skeleton height={14} width="40%" />}
        {list.error && <p className="tile-err"><Icon name="info" size={12} />{list.error}</p>}
      </div></header>
      {decided && all > 0 && <div className="todo-bar" role="progressbar" aria-valuemin={0} aria-valuemax={all} aria-valuenow={all - waiting}><i style={{ width: `${((all - waiting) / all) * 100}%` }} /></div>}
      <ol className="todo-steps">
        {steps.map((s) => (
          <li key={s.id} data-step={s.id}>
            <span>{s.text}</span>
            {s.action && (
              <button type="button" className="btn btn--sm" onClick={() => (s.ask ? onAsk(`What should I do first on ${page.title}, and why?`) : scrollTo(s.to))}>
                {s.ask && <GenieMark size={14} />}{s.action}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function planDelta(plan, row) {
  if (plan.delta && row[plan.delta] != null) return numberOf(row[plan.delta]);
  if (row[plan.current] == null || row[plan.recommended] == null) return null;
  return numberOf(row[plan.recommended]) - numberOf(row[plan.current]);
}

function PlanRow({ page, plan, row, actions, onDecided }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const key = recordKeyOf(row);
  const fmt = (v) => formatValue(v, plan.format, plan.currency);
  const delta = planDelta(plan, row);
  const status = row._inspire_status || row.action_status;
  const decide = async (decision) => {
    setBusy(true);
    setError('');
    try {
      await decidePlan({ page: page.id, record_key: String(key), seen: String(row._inspire_version), decision, reason,
        recommended: numberOf(row[plan.recommended]), ...(decision === 'override' ? { value: Number(value) } : {}) });
      toast(decision === 'accept' ? 'Accepted the suggested line' : 'Saved your override and its reason');
      setOpen(false);
      onDecided();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const can = actions && key != null && !!row._inspire_version;
  return (
    <>
      <tr data-plan-row={key}>
        <th scope="row">{row[page.records.label] ?? key}</th>
        <td className="num">{fmt(row[plan.current])}</td>
        <td className="num plan-rec"><span aria-hidden="true">★ </span>{fmt(row[plan.recommended])}</td>
        <td className={`num ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}`}>{delta == null ? '' : `${delta > 0 ? '+' : ''}${fmt(delta)}`}</td>
        <td>{status || 'New'}</td>
        <td className="plan-act">
          {can ? (
            <>
              <button type="button" className="btn btn--sm btn--pri" disabled={busy} onClick={() => decide('accept')}>Accept</button>
              <button type="button" className="btn btn--sm" disabled={busy} aria-expanded={open} onClick={() => setOpen(!open)}>Override</button>
            </>
          ) : <span className="muted">Read only</span>}
        </td>
      </tr>
      {open && (
        <tr className="plan-form"><td colSpan={6}>
          <form onSubmit={(e) => { e.preventDefault(); decide('override'); }}>
            <label>Your value<input type="number" step="any" required value={value} onChange={(e) => setValue(e.target.value)} /></label>
            <label className="grow">Why you override it<input required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <button className="btn btn--sm btn--pri" type="submit" disabled={busy || !value || !reason.trim()}>Save override</button>
          </form>
        </td></tr>
      )}
      {error && <tr><td colSpan={6}><p className="tile-err" role="alert"><Icon name="info" size={12} />{error}</p></td></tr>}
    </>
  );
}

const planDecides = (app, plan, list) => !!(list?.actions && app.options?.decisions) || !!(plan.override && app.options?.modify);

function Resolve({ page }) {
  const [state, setState] = useState({ busy: false, said: '' });
  const toast = useToast();
  const run = async () => {
    setState({ busy: true, said: '' });
    try {
      await runSettingsNow(page.id);
      toast('Started a new solve: the plan updates when the run ends');
      setState({ busy: false, said: '' });
    } catch (e) {
      setState({ busy: false, said: e.message });
    }
  };
  return (
    <>
      <button type="button" className="btn btn--sm" disabled={state.busy} onClick={run} data-resolve><Icon name="sliders" size={14} />Re-solve the plan</button>
      {state.said && <p className="tile-err" role="alert"><Icon name="info" size={12} />{state.said}</p>}
    </>
  );
}

export function PlanTable({ page, app, filters, ready, nonce, onChanged }) {
  const plan = page.plan;
  const list = useList(page.id, filters, ready, nonce, PLAN_ROWS);
  const rows = list.data?.rows || [];
  const can = planDecides(app, plan, list.data);
  return (
    <section className="card card--table plan" aria-label={plan.title}>
      <header className="card-h"><div><h2>{plan.title}</h2>{plan.hint && <p>{plan.hint}</p>}
        {list.data && !can && <p className="muted">This App keeps no decisions on these lines, so the plan is read only.</p>}
      </div></header>
      {!list.data && !list.error && <div style={{ padding: 16 }}><Skeleton height={22} /></div>}
      {list.error && <p className="tile-err"><Icon name="info" size={14} />The plan could not load: {list.error}</p>}
      {list.data && !rows.length && <p className="empty">No plan lines for these filters.</p>}
      {rows.length > 0 && (
        <div className="tw"><table className="plan-t">
          <thead><tr><th scope="col">{page.records.label_title || 'Line'}</th><th scope="col">Now</th><th scope="col">Suggested</th><th scope="col">Change</th><th scope="col">Status</th><th scope="col"><span className="sr">Decide</span></th></tr></thead>
          <tbody>{rows.map((row) => <PlanRow key={recordKeyOf(row)} page={page} plan={plan} row={row} actions={can} onDecided={onChanged} />)}</tbody>
        </table></div>
      )}
    </section>
  );
}

const SCENARIO_HOLDS = ['levers', 'scenario', 'target'];

export function LayoutSections({ page, app, ready, nonce, filters, onChanged, onAsk, kpisOf, records, chartCards, tableCard, data, onPick }) {
  const sections = page.layout?.sections || [];
  const holds = page.layout?.holds || {};
  const placed = new Set();
  const plan = (key) => <PlanTable key={key} page={page} app={app} filters={filters} ready={ready} nonce={nonce} onChanged={onChanged} />;
  const draw = (section) => {
    const hold = holds[section];
    if (hold === 'todo') return <TodoNow key="todo" page={page} app={app} ready={ready} nonce={nonce} onAsk={onAsk} />;
    if (hold === 'kpis') return <div key="kpis" data-section="kpis">{kpisOf(page.kpis.filter((k) => !holds[k.section]))}</div>;
    if (hold === 'objective') {
      const hero = page.kpis.filter((k) => k.section === section);
      return hero.length ? <div key={section} className="objective" data-section={section}>{kpisOf(hero, false)}</div> : null;
    }
    const Part = SECTION_PARTS[section];
    if (Part) return <div key={section} data-section={section}><Part page={page} app={app} ready={ready} nonce={nonce} filters={filters} onChanged={onChanged} onAsk={onAsk} data={data} records={records} onPick={onPick} /></div>;
    if (hold === 'plan' || hold === 'records') {
      if (page.plan) return <div key={section} data-section={section}>{plan(section)}</div>;
      return records ? <div key={section} data-section={section}>{records}</div> : null;
    }
    if (hold === 'resolve') return page.plan ? <div key={section} className="resolve" data-section={section}><Resolve page={page} /></div> : null;
    if (SCENARIO_HOLDS.includes(hold)) return page.scenario ? hold : null;
    if (hold) return null;
    const charts = page.charts.filter((c) => c.section === section);
    const tables = page.tables.filter((t) => t.section === section);
    charts.forEach((c) => placed.add(c.id));
    tables.forEach((t) => placed.add(t.id));
    const out = tables.map((t) => <div key={`${section}:${t.id}`} data-section={section}>{tableCard(t)}</div>);
    if (charts.length) out.unshift(<section key={section} className="charts" data-section={section}>{chartCards(charts)}</section>);
    return out.length ? out : null;
  };
  const drawn = sections.map((s) => [s, draw(s)]).filter(([, part]) => part);
  const first = drawn.findIndex(([, part]) => typeof part === 'string');
  const out = first < 0 ? drawn.map(([, part]) => part) : [
    ...drawn.slice(0, first).map(([, part]) => part),
    <Suspense key="scenario" fallback={<section className="card" data-section={drawn[first][0]}><Skeleton height={180} /></section>}>
      <ScenarioPanel page={page} app={app} ready={ready} order={drawn.slice(first)} onSaved={onChanged} />
    </Suspense>,
  ];
  const rest = page.charts.filter((c) => !placed.has(c.id));
  if (rest.length) out.push(<section key="rest" className="charts">{chartCards(rest)}</section>);
  return <ChartsReady page={page}>{out}</ChartsReady>;
}
