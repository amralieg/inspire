import { useEffect, useRef, useState } from 'react';
import { askGenie, failureOf, getMyWork } from './api.js';
import { genieAnswer, genieOn } from './genieAsk.js';
import { grouped } from './format.js';
import { Icon } from './icons.jsx';
import { Tiles } from './Kpis.jsx';
import { Failure } from './ui.jsx';
import { statusClass, statusLabel } from './records.js';
import { UseCaseName, YourWork, yourWorkProps } from './Home.jsx';
import { RowGenie } from './DataTable.jsx';
import { AskGenie } from './AskGenie.jsx';
import { tableContext } from './explain.js';
import { plural } from './hub.js';
import {
  CUSTOM, DEFAULT_PERIOD, PAGE_ROWS, PERIODS, activityText, aiQuestion, answerProblem, checkedAnswer, closeText, periodBody, periodProblem, rateText,
  scopeText, templateText, whenText, workFacts,
} from './mywork.js';

const SIGN_IN = 'Sign in so the App can show the work you did.';

function moneyTile(id, label, line, sub) {
  return { id, label, value: line ? line.text : 'None', sub: line ? `${sub} on ${plural(line.n, 'fix', 'fixes')}` : `No fix of yours ${sub} in this period`,
    tone: line && id === 'measured' ? 'green' : '' };
}

function tilesOf(facts) {
  const w = facts.worked;
  const closed = [`${grouped(w.fixed)} fixed`, `${grouped(w.dismissed)} not a real issue`, `${grouped(w.could_not)} could not fix`].join(', ');
  const tiles = [
    { id: 'records', label: 'Records you changed', value: grouped(w.records), sub: closed },
    moneyTile('measured', 'Measured', facts.money.measured, 'confirmed by a later run'),
    moneyTile('reported', 'Reported', facts.money.reported, 'as people reported it'),
    moneyTile('estimated', 'Estimated', facts.money.estimated, 'at stake when you fixed it'),
  ];
  if (facts.saved) {
    const missing = facts.saved.missing.length ? `; ${plural(facts.saved.missing.length, 'use case')} with no minutes set ${facts.saved.missing.length === 1 ? 'is' : 'are'} left out` : '';
    tiles.push({ id: 'saved', label: 'Time saved, estimated', value: `${grouped(Math.round(facts.saved.hours * 10) / 10)} h`,
      sub: `records you changed times the minutes per record the owners set${missing}` });
  }
  return tiles;
}

function Period({ choice, from, to, problem, onChoice, onFrom, onTo }) {
  return (
    <div className="tbar" data-period>
      <div className="wchips" role="group" aria-label="Period">
        {PERIODS.map(([id, text]) => (
          <button key={id} type="button" className={`pick-i ${choice === id ? 'is-on' : ''}`} aria-pressed={choice === id} onClick={() => onChoice(id)}>{text}</button>
        ))}
      </div>
      {choice === CUSTOM && (
        <span className="wchips">
          <label className="in"><span>First day</span><input type="date" name="my_work_from" value={from} onChange={(e) => onFrom(e.target.value)} /></label>
          <label className="in"><span>Last day</span><input type="date" name="my_work_to" value={to} onChange={(e) => onTo(e.target.value)} /></label>
        </span>
      )}
      {problem && choice === CUSTOM && (from || to) && <p className="err" role="alert">{problem}</p>}
    </div>
  );
}

function Summary({ app, facts }) {
  const [said, setSaid] = useState({ state: 'idle', text: '', note: '' });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const target = [facts.best?.page, ...facts.rows.map((r) => r.page)].find((p) => p && genieOn(app, p.id));
  const write = async () => {
    setSaid({ state: 'running', text: '', note: '' });
    try {
      const started = await askGenie(target.id, aiQuestion(facts), '');
      const msg = await genieAnswer(target.id, started, { alive: () => alive.current });
      if (!msg) return;
      const problem = answerProblem(msg.text, facts);
      setSaid(problem ? { state: 'plain', text: '', note: `${problem}, so this is the plain summary.` }
        : { state: 'ai', text: checkedAnswer(msg.text, facts), note: 'Genie wrote this from your numbers; every number in it is one of them.' });
    } catch (error) {
      if (alive.current) setSaid({ state: 'plain', text: '', note: `Genie could not write it: ${error.message}` });
    }
  };
  return (
    <section className="card" aria-label="Summary" data-summary>
      <header className="card-h">
        <div><h2>In short</h2><p data-summary-text={said.state}>{said.text || templateText(facts)}</p>{said.note && <p className="more">{said.note}</p>}</div>
        {target && facts.worked.records > 0 && (
          <div className="tbar">
            <button type="button" className="btn" onClick={write} disabled={said.state === 'running'} data-summary-ai>
              <Icon name="edit" size={14} />{said.state === 'running' ? 'Genie is writing…' : 'Write it with Genie'}
            </button>
          </div>
        )}
      </header>
    </section>
  );
}

const useCaseFields = (r) => ({
  'Use case': r.page.title, Changed: r.worked.records || 0, Fixed: r.worked.fixed || 0, 'Not a real issue': r.worked.dismissed || 0, 'Could not fix': r.worked.could_not || 0,
  Assigned: r.worked.assigned || 0, Notes: r.worked.notes || 0, Pace: rateText(r), 'Time to close': closeText(r),
  'Largest closed': r.best ? `${r.best.label || r.best.key}, ${r.best.text} ${r.best.basis}` : 'none',
});

const activityFields = (a, page) => ({
  When: whenText(a.at), 'Use case': page?.title || a.page, Record: a.label || a.key, 'What you did': activityText(a), Status: a.status ? statusLabel(a.status) : '',
  ...(a.note && a.kind === 'note' ? { Note: a.note } : {}),
});

function ByUseCase({ facts, onRecord }) {
  return (
    <section className="card card--table" aria-label="By use case">
      <header className="card-h">
        <div><h2>By use case</h2><p>Each use case in its own unit, so they are compared side by side and never added up.</p></div>
        <AskGenie kind="table" title="By use case" context={tableContext('What you did in each use case, each in its own unit.', facts.rows, useCaseFields)} />
      </header>
      <div className="tbl-wrap">
        <table className="tbl" data-by-use-case>
          <thead>
            <tr><th>Use case</th><th className="num">Changed</th><th className="num">Fixed</th><th className="num">Not a real issue</th><th className="num">Could not fix</th>
              <th className="num">Assigned</th><th className="num">Notes</th><th>Pace</th><th>Time to close</th><th>Largest closed</th><th className="ask-c"><span className="sr">Ask Genie</span></th></tr>
          </thead>
          <tbody>
            {facts.rows.map((r) => (
              <tr key={r.page.id} data-page={r.page.id}>
                <td><UseCaseName page={r.page} wrap /></td>
                {['records', 'fixed', 'dismissed', 'could_not', 'assigned', 'notes'].map((k) => <td key={k} className="num">{grouped(r.worked[k] || 0)}</td>)}
                <td>{rateText(r)}</td>
                <td>{closeText(r)}</td>
                <td>{r.best
                  ? <button type="button" className="lnk" onClick={() => onRecord(r.page.id, r.best.key)}>{`${r.best.label || r.best.key}, ${r.best.text} ${r.best.basis}`}</button>
                  : 'none'}</td>
                <td className="ask-c"><RowGenie element={{ title: r.page.title, page: r.page.id, context: { hint: 'What you did in this use case.', fields: useCaseFields(r) } }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Activity({ app, data, onMore, onRecord }) {
  const title = (id) => app.pages.find((p) => p.id === id);
  return (
    <section className="card card--table" aria-label="What you did">
      <header className="card-h">
        <div><h2>What you did</h2><p>{`Every change you made, newest first: ${grouped(data.activity.length)} of ${plural(data.total, 'change')}`}</p></div>
        <AskGenie kind="table" title="What you did" context={tableContext('Every change you made, newest first.', data.activity, (a) => activityFields(a, title(a.page)), data.total)} />
      </header>
      {data.activity.length === 0 ? <div className="nomatch">You changed no records in this period.</div> : (
        <div className="tbl-wrap">
          <table className="tbl tbl--work" data-activity>
            <thead><tr><th>When</th><th className="c-uc">Use case</th><th>Record</th><th>What you did</th><th className="c-status">Status</th><th className="ask-c"><span className="sr">Ask Genie</span></th></tr></thead>
            <tbody>
              {data.activity.map((a, i) => {
                const page = title(a.page);
                const open = () => onRecord(a.page, a.key);
                return (
                  <tr key={`${a.page}:${a.key}:${a.at}:${i}`} className="is-click" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
                    aria-label={`Open ${a.label || a.key} in ${page?.title || a.page}`}>
                    <td className="nw">{whenText(a.at)}</td>
                    <td className="c-uc">{page ? <UseCaseName page={page} wrap /> : a.page}</td>
                    <td><div className="it"><b>{a.label || a.key}</b>{a.note && a.kind === 'note' && <small>{a.note}</small>}</div></td>
                    <td>{activityText(a)}</td>
                    <td className="nw c-status">{a.status ? <span className={statusClass(a.status)}>{statusLabel(a.status)}</span> : ''}</td>
                    <td className="ask-c"><RowGenie about={genieOn(app, a.page) ? { pageId: a.page, recordKey: String(a.key), label: a.label || a.key } : null}
                      element={{ title: a.label || a.key, page: a.page, context: { hint: 'A change you made to this record.', fields: activityFields(a, page) } }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.activity.length < data.total && (
        <p className="more">{data.more ? 'Loading more…' : <button className="lnk" onClick={onMore} data-my-work-more>{`Show ${grouped(Math.min(PAGE_ROWS, data.total - data.activity.length))} more`}</button>}</p>
      )}
    </section>
  );
}

export default function MyWorkPage({ app, hub, hubError, summaries, onRecord }) {
  const [choice, setChoice] = useState(DEFAULT_PERIOD);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [failure, setFailure] = useState(null);
  const signedIn = !!(app.user?.email || app.user?.name);
  const problem = periodProblem(choice, from, to);
  const asked = problem ? '' : JSON.stringify(periodBody(choice, from, to));
  const seq = useRef(0);
  useEffect(() => {
    if (!signedIn || !asked) return;
    const mine = ++seq.current;
    setData(null);
    setFailure(null);
    getMyWork(JSON.parse(asked)).then((d) => { if (mine === seq.current) setData(d); })
      .catch((e) => { if (mine === seq.current) setFailure(failureOf(e)); });
  }, [asked, signedIn]);
  const more = () => {
    const mine = seq.current;
    setData((d) => ({ ...d, more: true }));
    getMyWork({ ...JSON.parse(asked), offset: data.activity.length })
      .then((d) => { if (mine === seq.current) setData((x) => ({ ...x, more: false, activity: [...x.activity, ...d.activity] })); })
      .catch((e) => { if (mine === seq.current) { setData((x) => ({ ...x, more: false })); setFailure(failureOf(e)); } });
  };
  const facts = data ? workFacts(data, app.pages, summaries) : null;
  const quiet = data ? app.pages.filter((p) => data.pages?.[p.id] && !data.pages[p.id].tracked && data.pages[p.id].visible !== false && data.pages[p.id].note) : [];
  const problems = Object.entries(data?.errors || {}).map(([id, message]) => [app.pages.find((p) => p.id === id)?.title || id, message]);
  return (
    <div className="page hub" data-my-work>
      <div className="pg-h">
        <div><h1>My work</h1><p>What you did yourself, read from the change history of each use case.</p></div>
      </div>
      <Period choice={choice} from={from} to={to} problem={problem} onChoice={setChoice} onFrom={setFrom} onTo={setTo} />
      {!signedIn && <div className="nomatch">{SIGN_IN}</div>}
      <Failure failure={failure} className="tile-err">{failure?.text}</Failure>
      {problems.map(([name, message]) => <p key={name} className="tile-err" role="alert"><Icon name="info" size={14} />{name} could not load: {message}</p>)}
      {signedIn && !data && !failure && !problem && <p className="more">Loading your work…</p>}
      {facts && (
        <>
          <p className="note" data-scope><Icon name="info" size={14} />{scopeText(facts)}</p>
          <Tiles tiles={tilesOf(facts)} loading={false} label="Your numbers" />
          <Summary key={asked} app={app} facts={facts} />
          {facts.best && (
            <p className="note" data-best>
              <Icon name="check" size={14} />Your largest closed record is{' '}
              <button type="button" className="lnk" onClick={() => onRecord(facts.best.page.id, facts.best.key)}>{facts.best.label}</button>
              {` in ${facts.best.page.title}: ${facts.best.text} ${facts.best.basis}.`}
            </p>
          )}
          {facts.rows.length > 0 && <ByUseCase facts={facts} onRecord={onRecord} />}
          <Activity app={app} data={data} onMore={more} onRecord={onRecord} />
          {quiet.map((p) => <p key={p.id} className="more" data-quiet={p.id}><UseCaseName page={p} /> {data.pages[p.id].note}</p>)}
        </>
      )}
      <YourWork {...yourWorkProps(app, hub, hubError, summaries)} onRecord={onRecord} />
    </div>
  );
}
