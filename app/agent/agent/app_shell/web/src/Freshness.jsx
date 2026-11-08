import { useCallback, useEffect, useRef, useState } from 'react';
import { getFreshness, refreshPage, toneOf } from './api.js';
import { Icon } from './icons.jsx';
import { useToast } from './ui.jsx';
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

  const ask = () => {
    setAsking(true);
    refreshPage(page.id)
      .then((run) => { watched.current = run.run_id; })
      .catch((error) => toast(error.message, toneOf(error)))
      .finally(() => load().finally(() => setAsking(false)));
  };

  const busy = !!fresh?.active || asking;
  return { fresh, now, busy, ask, load, showThrough, why: `fresh-why-${page.id}`, reason: !!fresh && !busy && !fresh.can_refresh && fresh.reason };
}

export function FreshBar({ freshness, children }) {
  const { fresh, now, busy, ask, showThrough, why, reason } = freshness;
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
      <button className="btn fresh-btn top-ic2" onClick={ask} disabled={busy || !fresh.can_refresh} title="Run this use case again on all its data"
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
