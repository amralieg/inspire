import { useCallback, useEffect, useRef, useState } from 'react';
import { getFreshness, refreshPage, toneOf } from './api.js';
import { Icon } from './icons.jsx';
import { useToast } from './ui.jsx';
import { runWrite, useWrite } from './saving.jsx';
import { UNDO_MS } from './records.js';
import {
  CHECK_AGAIN, POLL_MS, RUN_STATES, activeState, bannerText, isQuiet, lastRunNote, lastRunText, progressShare, runState, stepText, toastTone, untilText,
} from './freshness.js';

const refreshEnded = (run) => {
  const said = lastRunText(run);
  return { text: said.text, tone: toastTone(said.tone) };
};
const REFRESHED = RUN_STATES.succeeded;

function RunAction({ state, url, onCheck }) {
  if (!state.action) return null;
  if (url) return <a className="lnk fresh-go" href={url} target="_blank" rel="noreferrer">{state.action}</a>;
  return <button type="button" className="lnk fresh-go" onClick={onCheck}>{CHECK_AGAIN}</button>;
}

export function RunBar({ active, label }) {
  if (isQuiet(active)) return null;
  const share = progressShare(active);
  if (share == null) return <span className="run-bar is-open" role="progressbar" aria-label={label}><i /></span>;
  return (
    <span className="run-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)}>
      <i style={{ width: `${share}%` }} />
    </span>
  );
}

export function useFreshness({ page, onRefreshed, onRun, onSeeChanged, showThrough = true }) {
  const toast = useToast();
  const [fresh, setFresh] = useState(null);
  const [misses, setMisses] = useState(0);
  const [asking, setAsking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const watched = useRef('');
  const running = useRef(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    return getFreshness(page.id)
      .then((next) => { if (mine === seq.current) { setNow(Date.now()); setFresh(next); } })
      .catch(() => { if (mine === seq.current) setMisses((n) => n + 1); });
  }, [page.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!fresh?.active) return undefined;
    const timer = setTimeout(load, POLL_MS);
    return () => clearTimeout(timer);
  }, [fresh, misses, load]);
  const activeId = fresh ? fresh.active?.run_id || '' : null;
  useEffect(() => {
    if (activeId == null) return;
    if (running.current != null && running.current !== activeId) onRun?.();
    running.current = activeId;
  }, [activeId]);
  useEffect(() => {
    if (!fresh) return;
    if (fresh.active) {
      watched.current = fresh.active.run_id;
      return;
    }
    const id = watched.current;
    if (!id) return;
    watched.current = '';
    if (fresh.last_run?.run_id === id && fresh.last_run.result !== 'succeeded') {
      const said = refreshEnded(fresh.last_run);
      toast(said.text, said.tone);
      return;
    }
    if (fresh.last_success?.run_id === id) {
      toast(REFRESHED.heading, toastTone(REFRESHED.tone), onSeeChanged ? { actions: [{ label: REFRESHED.action, run: onSeeChanged }], ms: UNDO_MS } : undefined);
    }
    onRefreshed?.();
  }, [fresh]);

  const ask = () => runWrite('refresh', () => {
    setAsking(true);
    return refreshPage(page.id)
      .then((run) => { watched.current = run.run_id; })
      .catch((error) => toast(error.message, toneOf(error)))
      .finally(() => load().finally(() => setAsking(false)));
  });

  const busy = !!fresh?.active || asking;
  return { fresh, now, busy, ask, load, showThrough, why: `fresh-why-${page.id}`, reason: !!fresh && !busy && !fresh.can_refresh && fresh.reason };
}

export function FreshBar({ freshness, children }) {
  const { fresh, now, busy, ask, showThrough, why, reason } = freshness;
  const writing = useWrite().busy;
  const text = bannerText(fresh, now, showThrough);
  if (!fresh || !text) return children;
  const state = fresh.active ? activeState(fresh.active) : runState('queued');
  return (
    <>
      <span className={`fresh${fresh.overdue ? ' fresh--late' : ''}`} data-source={fresh.source}>
        {busy ? (
          <span className="fresh-busy" role="status" id={why} data-run-state={state.key} data-tone={state.tone}
            title={fresh.active?.by ? `Started by ${fresh.active.by}` : undefined}>
            {isQuiet(fresh.active) ? <Icon name="info" size={14} /> : <span className="fresh-dots" aria-hidden="true"><i /><i /><i /></span>}<b>{state.heading}</b>
            {fresh.active && <RunBar active={fresh.active} label="How far the refresh is" />}
          </span>
        ) : (
          <span className="fresh-t" title={text}><Icon name="history" size={14} /><span className="fresh-tx">{text}</span>{fresh.overdue && <b className="fresh-flag">Overdue</b>}</span>
        )}
      </span>
      {children}
      <button className="btn fresh-btn top-ic2" onClick={ask} disabled={busy || writing || !fresh.can_refresh} title="Run this use case again on all its data"
        aria-label="Refresh now" aria-describedby={busy || reason ? why : undefined}>
        <Icon name="undo" size={15} /><span>Refresh now</span>
      </button>
    </>
  );
}

export function FreshDetail({ freshness }) {
  const { fresh, now, load, why, reason, showThrough } = freshness;
  if (!fresh) return null;
  const last = lastRunNote(fresh);
  const active = fresh.active;
  const until = active ? untilText(fresh, now) : '';
  const text = active ? '' : bannerText(fresh, now, showThrough);
  if (!active && !reason && !last && !text) return null;
  return (
    <div className="fresh-d" data-source={fresh.source}>
      {text && <span className={`fresh-pt${fresh.overdue ? ' is-late' : ''}`}><Icon name="history" size={14} /><span>{text}</span>{fresh.overdue && <b className="fresh-flag">Overdue</b>}</span>}
      {active && (
        <span className="fresh-run" data-run-state={activeState(active).key}>
          <small data-progress>{stepText(active, now, fresh.typical_s)}</small>
          <RunAction state={activeState(active)} url={active.url} onCheck={load} />
          {until && <span className="fresh-asof">{until}</span>}
        </span>
      )}
      {reason && <small className="fresh-why" id={why}>{fresh.reason}</small>}
      {last && (
        <span className="fresh-note" data-last-run={last.result} data-tone={last.tone}><Icon name="info" size={13} />{last.text}</span>
      )}
    </div>
  );
}

export function RunningNow({ pages, hub, onSeeChanged }) {
  const toast = useToast();
  const [runs, setRuns] = useState({});
  const watched = useRef({});
  const running = pages.filter((p) => hub?.pages?.[p.id]?.runs?.active).map((p) => p.id).join('|');
  useEffect(() => {
    let live = true;
    const timers = new Set();
    const ids = running ? running.split('|') : [];
    const later = (page) => {
      const timer = setTimeout(() => { timers.delete(timer); check(page); }, POLL_MS);
      timers.add(timer);
    };
    const check = (page) => getFreshness(page.id).then((fresh) => {
      if (!live) return;
      const was = watched.current[page.id];
      if (fresh.active) {
        watched.current[page.id] = fresh.active.run_id;
        setRuns((r) => ({ ...r, [page.id]: { active: fresh.active, typical: fresh.typical_s, at: Date.now() } }));
        later(page);
        return;
      }
      setRuns((r) => {
        const next = { ...r };
        delete next[page.id];
        return next;
      });
      if (!was) return;
      delete watched.current[page.id];
      if (fresh.last_run?.run_id === was && fresh.last_run.result !== 'succeeded') {
        const said = refreshEnded(fresh.last_run);
        toast(`${page.title}: ${said.text}`, said.tone);
      } else if (fresh.last_success?.run_id === was) {
        toast(`${page.title}: ${REFRESHED.heading}`, toastTone(REFRESHED.tone), { actions: [{ label: REFRESHED.action, run: () => onSeeChanged(page.id) }], ms: UNDO_MS });
      }
    }).catch(() => { if (live) later(page); });
    const at = Date.now();
    setRuns(Object.fromEntries(ids.map((id) => [id, { active: hub.pages[id].runs.active, typical: null, at }])));
    ids.forEach((id) => {
      watched.current[id] = hub.pages[id].runs.active.run_id;
      const page = pages.find((p) => p.id === id);
      if (page) later(page);
    });
    return () => { live = false; timers.forEach(clearTimeout); };
  }, [running]);
  const active = pages.filter((p) => runs[p.id]);
  if (!active.length) return null;
  return (
    <section className="card running" aria-label="Running now">
      <header className="card-h"><div><h2>Running now</h2><p>The data you see stays as it is until each refresh finishes.</p></div></header>
      <ul className="running-l">
        {active.map((p) => {
          const { active, typical, at } = runs[p.id];
          const state = activeState(active);
          return (
            <li key={p.id} data-running={p.id} data-run-state={state.key} data-tone={state.tone}>
              <b>{p.title}</b>
              {state.key !== 'running' && <span className="running-st">{state.heading}</span>}
              <small data-progress>{stepText(active, at, typical)}</small>
              <RunBar active={active} label={`How far the refresh of ${p.title} is`} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
