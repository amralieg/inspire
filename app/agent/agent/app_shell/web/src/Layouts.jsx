import { Suspense, lazy, useEffect, useState } from 'react';
import { decidePlan, getRecords, runSettingsNow } from './api.js';
import { entityName, formatValue, integer, numberOf } from './format.js';
import { canDecide, choiceLabel, noDecisionText, pageDecides, recordKeyOf, statusChoices } from './records.js';
import { Icon } from './icons.jsx';
import { SaidNote, Skeleton, useToast, PlainNote } from './ui.jsx';
import { genieOn } from './genieAsk.js';
import { ChartsReady, RowPanel, SECTION_PARTS, TAKE_ALL, TakeAll, decidedText, isClosed, useOpenRow } from './KindParts.jsx';
import { SaveButton, runWrite } from './saving.jsx';
import { AskGenie } from './AskGenie.jsx';
import { RowGenie } from './DataTable.jsx';
import { tableContext } from './explain.js';
import { KIND_PARTS, KindReady } from './KindLayouts.jsx';
import { reducedMotion } from './theme.js';

const ScenarioPanel = lazy(() => import('./Scenario.jsx'));

export const DEFAULT_LAYOUT = 'decision_queue';
export const layoutOf = (page) => page?.layout?.id || DEFAULT_LAYOUT;
export const isLaidOut = (page) => layoutOf(page) !== DEFAULT_LAYOUT;
export const tabLabel = (page, fallback) => (isLaidOut(page) && page.layout?.tab_label) || fallback;
export const isQueue = (page) => !!page?.records && !isLaidOut(page);
export const pageSections = (app, page) => ['dashboard', ...(isQueue(page) ? ['work'] : []), ...(app?.screens?.runs !== false ? ['runs'] : []),
  ...(app?.alerting?.on ? ['alerts'] : []), 'settings'];
export const decides = pageDecides;
const PLAN_ROWS = 50;
const TODO_ROWS = 5;

const scrollTo = (section) => document.querySelector(`[data-section="${section}"]`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });

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

export function todoSteps(page, list, { modify = false, accept = false, plan = false } = {}) {
  const label = page.records?.label;
  const to = decisionSection(page);
  const first = list?.rows?.[0];
  const steps = [];
  const chat = Object.values(page.layout?.holds || {}).includes('conversation');
  if (page.scenario) {
    const levers = Object.keys(page.layout?.holds || {}).find((s) => page.layout.holds[s] === 'levers');
    steps.push({ id: 'levers', text: `Move the levers and watch the ${(page.scenario.outcome?.label || 'outcome').toLowerCase()} and its P10 to P90 range.`, action: 'Show me', to: levers });
    if (page.scenario.save && modify) steps.push({ id: 'save', text: 'Name and save the scenario you want to plan on, so your team sees it.', action: null });
  } else if (chat) {
    steps.push({ id: 'ask', text: 'Pick a suggested question, or ask your own: Genie answers from the data of this use case.', action: 'Show me', to: 'suggested_questions' });
    steps.push({ id: 'sql', text: 'Open the SQL under each answer to check what Genie read before you use a number.', action: null });
    steps.push({ id: 'rate', text: 'Mark each answer helpful or not, so the Genie Agent learns what a good answer is.', action: null });
  } else if (!decides(page)) {
    steps.push({ id: 'read', text: page.question || page.title, action: null });
    steps.push({ id: 'so_what', text: 'Read the “So what” line under each chart: it says what to do with it.', action: null });
    if (page.filters?.length) steps.push({ id: 'filters', text: 'Use the filters at the top to narrow every chart to the part you own.', action: null });
  } else if (first) {
    const name = entityName(first, label) || recordKeyOf(first);
    const value = ['Start with ', name, ': it is first in the list because it matters most.'];
    steps.push({ id: 'first', text: value.join(''), value, action: 'Show me', to });
    if (page.plan && plan) steps.push({ id: 'plan', text: 'Take the ★ suggested line in the plan, or override it with a reason.', action: 'Open the plan', to });
    else if (page.plan) steps.push({ id: 'plan_read', text: 'Read each line of the plan next to its ★ suggested value, largest change first.', action: 'Open the plan', to });
    else if (accept) steps.push({ id: 'accept', text: 'Accept the suggested action where you agree: one row at a time, or select several and accept them together.', action: 'Show me', to });
    else steps.push({ id: 'down', text: 'Work down the list in order and record what you did on each one.', action: null });
  }
  return steps;
}

export function TodoNow({ page, app, ready, nonce, shared, onRecords }) {
  const decided = decides(page);
  const fetched = useList(page.id, {}, ready, nonce, TODO_ROWS, decided && shared === undefined);
  const list = shared === undefined ? fetched : shared || {};
  const steps = todoSteps(page, list.data, { modify: !!app?.options?.modify, accept: !!(list.data?.actions && page.records?.action),
    plan: !!(page.plan && list.data && planDecides(app, page.plan, list.data)) });
  const summary = list.data?.summary;
  const waiting = summary?.open ?? list.data?.total ?? 0;
  const all = Math.max(waiting, (summary?.open ?? 0) + (summary?.done ?? 0), list.data?.total ?? 0);
  return (
    <section className="todo card" aria-label="What to do now" data-section="todo">
      <header className="card-h"><div><h2>What to do now</h2>
        {decided && list.data && <p data-todo-count>{all ? `${integer(waiting)} of ${integer(all)} waiting for you` : 'Nothing is waiting for you right now'}</p>}
        {decided && !list.data && !list.error && <Skeleton height={14} width="40%" />}
        {list.error && <PlainNote text={list.error} icon={<Icon name="info" size={12} />} className="tile-err" />}
      </div>
      <AskGenie kind="text" title="What to do now" context={{ hint: steps.map((s) => s.text).join('\n') }} /></header>
      {decided && all > 0 && <div className="todo-bar" role="progressbar" aria-valuemin={0} aria-valuemax={all} aria-valuenow={all - waiting}><i style={{ width: `${((all - waiting) / all) * 100}%` }} /></div>}
      <ol className="todo-steps">
        {steps.map((s) => (
          <li key={s.id} data-step={s.id}>
            <span>{s.value ? <>{s.value[0]}<bdi>{s.value[1]}</bdi>{s.value[2]}</> : s.text}</span>
            {s.action && (
              <button type="button" className="btn btn--sm" onClick={() => (s.to === 'records' && onRecords ? onRecords() : scrollTo(s.to))}>
                {s.action}
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

const lineName = (page, row) => String(row[page.records.label] ?? recordKeyOf(row));

function planFields(page, plan, row) {
  return { [page.records.label_title || 'Line']: lineName(page, row), Now: row[plan.current], Suggested: row[plan.recommended], Change: planDelta(plan, row),
    Status: choiceLabel(statusChoices(page), row) };
}

export async function decidePlanLine(page, plan, row, decision, reason = '', value = null) {
  return decidePlan({ page: page.id, record_key: String(recordKeyOf(row)), seen: String(row._inspire_version), decision, reason,
    recommended: numberOf(row[plan.recommended]), ...(decision === 'override' ? { value: Number(value) } : {}) });
}

const planOpen = (row) => recordKeyOf(row) != null && !!row._inspire_version && !isClosed(row);

function PlanRow({ page, app, plan, row, actions, onDecided, onOpen }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const toast = useToast();
  const key = recordKeyOf(row);
  const fmt = (v) => formatValue(v, plan.format, plan.currency);
  const delta = planDelta(plan, row);
  const decided = isClosed(row);
  const decide = (decision) => runWrite(`plan:${key}:${decision}`, async () => {
    setError('');
    setSaid('');
    try {
      const got = await decidePlanLine(page, plan, row, decision, reason, value);
      const text = got?.showcase ? got.note : decision === 'accept' ? 'Accepted the suggested line' : 'Saved your override and its reason';
      setSaid(text);
      toast(text);
      setOpen(false);
      onDecided();
    } catch (e) {
      setError(e.message);
    }
  }, { rows: [key] });
  const can = actions && planOpen(row);
  const cols = actions ? 7 : 6;
  return (
    <>
      <tr data-plan-row={key}>
        <th scope="row"><button type="button" className="choice-open" onClick={() => onOpen(row)} data-open-row={key} aria-label={`Open ${lineName(page, row)}`}><bdi>{lineName(page, row)}</bdi></button></th>
        <td className="num">{fmt(row[plan.current])}</td>
        <td className="num plan-rec"><span aria-hidden="true">★ </span>{fmt(row[plan.recommended])}</td>
        <td className={`num ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}`}>{delta == null ? '' : `${delta > 0 ? '+' : ''}${fmt(delta)}`}</td>
        <td>{choiceLabel(statusChoices(page), row)}</td>
        {actions && (
          <td className="plan-act">
            {decided && <span className="choice-done" data-decided><Icon name="check" size={13} />{decidedText(row, statusChoices(page))}</span>}
            {can && (
              <>
                <SaveButton write={`plan:${key}:accept`} className="btn btn--sm btn--pri" onClick={() => decide('accept')}>Accept</SaveButton>
                <SaveButton write={`plan:${key}:override`} className="btn btn--sm" aria-expanded={open} onClick={() => setOpen(!open)}>Override</SaveButton>
              </>
            )}
          </td>
        )}
        <td className="ask-c"><RowGenie about={genieOn(app, page.id) && key != null ? { pageId: page.id, recordKey: String(key), label: lineName(page, row) } : null}
          element={{ title: lineName(page, row), page: page.id, context: { hint: `A line of ${plan.title}.`, fields: planFields(page, plan, row) } }} /></td>
      </tr>
      {open && (
        <tr className="plan-form"><td colSpan={cols}>
          <form onSubmit={(e) => { e.preventDefault(); decide('override'); }}>
            <label>Your value<input type="number" step="any" required value={value} onChange={(e) => setValue(e.target.value)} /></label>
            <label className="grow">Why you override it<input dir="auto" required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <SaveButton write={`plan:${key}:override`} className="btn btn--sm btn--pri" type="submit" disabled={!value || !reason.trim()}>Save override</SaveButton>
          </form>
        </td></tr>
      )}
      {said && !error && <tr className="plan-said"><td colSpan={cols}><SaidNote text={said} at={key} /></td></tr>}
      {error && <tr><td colSpan={cols}><PlainNote text={error} icon={<Icon name="info" size={12} />} className="tile-err" role="alert" /></td></tr>}
    </>
  );
}

const planDecides = (app, plan, list) => canDecide(app, list) || !!(plan.override && app.options?.modify);

const RESOLVE = 'plan:resolve';

function Resolve({ page }) {
  const [said, setSaid] = useState('');
  const toast = useToast();
  const run = () => runWrite(RESOLVE, async () => {
    setSaid('');
    try {
      await runSettingsNow(page.id);
      toast('Started a new solve: the plan updates when the run ends');
    } catch (e) {
      setSaid(e.message);
    }
  });
  return (
    <>
      <SaveButton write={RESOLVE} className="btn btn--sm" onClick={run} data-resolve><Icon name="sliders" size={14} />Re-solve the plan</SaveButton>
      {said && <p className="tile-err" role="alert"><Icon name="info" size={12} />{said}</p>}
    </>
  );
}

export function PlanTable({ page, app, filters, ready, nonce, onChanged }) {
  const plan = page.plan;
  const list = useList(page.id, filters, ready, nonce, PLAN_ROWS);
  const opened = useOpenRow();
  const rows = list.data?.rows || [];
  const can = planDecides(app, plan, list.data);
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const toast = useToast();
  const open = can ? rows.filter(planOpen) : [];
  const acceptAll = () => runWrite(TAKE_ALL, async () => {
    setError('');
    setSaid('');
    let done = 0;
    let demo = '';
    try {
      for (const row of open) {
        const got = await decidePlanLine(page, plan, row, 'accept');
        if (got?.showcase) demo = got.note;
        done += 1;
      }
      const text = `${done === 1 ? 'Accepted the suggested line' : `Accepted ${integer(done)} suggested lines`}${demo ? `. ${demo}` : ''}`;
      setSaid(text);
      toast(text);
    } catch (e) {
      setError(done ? `Accepted ${integer(done)} of ${integer(open.length)} lines, then: ${e.message}` : e.message);
    } finally {
      if (done) onChanged();
    }
  }, { rows: open.map((r) => String(recordKeyOf(r))) });
  return (
    <section className="card card--table plan" aria-label={plan.title}>
      <header className="card-h"><div><h2>{plan.title}</h2>
        {list.data && !can ? <p className="muted" data-no-decisions>{noDecisionText(app, page)}</p> : plan.hint && <p>{plan.hint}</p>}
      </div>
      {open.length > 0 && <TakeAll count={open.length} onClick={acceptAll} />}
      <AskGenie kind="table" title={plan.title} context={tableContext(plan.hint || '', rows, (row) => planFields(page, plan, row), list.data?.total)} /></header>
      {!list.data && !list.error && <div style={{ padding: 16 }}><Skeleton height={22} /></div>}
      {list.error && <PlainNote text={list.error} prefix="The plan could not load: " icon={<Icon name="info" size={14} />} className="tile-err" />}
      {error && <PlainNote text={error} icon={<Icon name="info" size={14} />} className="tile-err" role="alert" />}
      {!error && <SaidNote text={said} at="all" size={14} />}
      {list.data && !rows.length && <p className="empty">No plan lines for these filters.</p>}
      {rows.length > 0 && (
        <div className="tw"><table className="plan-t">
          <thead><tr><th scope="col">{page.records.label_title || 'Line'}</th><th scope="col">Now</th><th scope="col">Suggested</th><th scope="col">Change</th><th scope="col">Status</th>{can && <th scope="col"><span className="sr">Decide</span></th>}<th scope="col"><span className="sr">Ask Genie</span></th></tr></thead>
          <tbody>{rows.map((row) => <PlanRow key={recordKeyOf(row)} page={page} app={app} plan={plan} row={row} actions={can} onDecided={onChanged} onOpen={opened.open} />)}</tbody>
        </table></div>
      )}
      <RowPanel page={page} app={app} list={list.data} opened={opened} filters={filters} onChanged={onChanged} />
    </section>
  );
}

const SCENARIO_HOLDS = ['levers', 'scenario', 'target'];

export function LayoutSections({ page, app, ready, nonce, filters, onChanged, kpisOf, records, chartCards, tableCard, data, onPick, genie }) {
  const sections = page.layout?.sections || [];
  const holds = page.layout?.holds || {};
  const placed = new Set();
  const plan = (key) => <PlanTable key={key} page={page} app={app} filters={filters} ready={ready} nonce={nonce} onChanged={onChanged} />;
  const draw = (section) => {
    const hold = holds[section];
    if (hold === 'todo') return <TodoNow key="todo" page={page} app={app} ready={ready} nonce={nonce} />;
    if (hold === 'kpis') return <div key="kpis" data-section="kpis">{kpisOf(page.kpis.filter((k) => !holds[k.section]))}</div>;
    if (hold === 'objective') {
      const hero = page.kpis.filter((k) => k.section === section);
      return hero.length ? <div key={section} className="objective" data-section={section}>{kpisOf(hero, false)}</div> : null;
    }
    const Part = SECTION_PARTS[section] || KIND_PARTS[section];
    if (Part) return <div key={section} data-section={section}><Part page={page} app={app} ready={ready} nonce={nonce} filters={filters} onChanged={onChanged} data={data} records={records} onPick={onPick} genie={genie} section={section} /></div>;
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
  return <ChartsReady page={page}><KindReady page={page}>{out}</KindReady></ChartsReady>;
}
