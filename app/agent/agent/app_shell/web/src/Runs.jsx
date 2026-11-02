import { useEffect, useRef, useState } from 'react';
import { getRuns } from './api.js';
import { formatValue, integer, kindOf, unitOf } from './format.js';
import Fx from './Fx.jsx';
import { Icon } from './icons.jsx';
import { Skeleton } from './ui.jsx';
import { BarsCard } from './ChartCard.jsx';
import {
  RUNS_PAGE, couldSaveRunFormula, coveredText, errorText, foundText, lastedText, runBars, runFlag, runKey, runsPageText, stampText, stepsText, triggerText,
} from './freshness.js';

const STOPPED = ['failed', 'canceled', 'skipped'];
const COLUMNS = 8;
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const None = () => <span className="none">none</span>;
const count = (n) => (n == null ? <None /> : integer(n));

export function useRuns(pageId, offset, nonce, on = true) {
  const [out, setOut] = useState({ data: null, error: '', busy: on });
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    if (!on) {
      setOut({ data: null, error: '', busy: false });
      return;
    }
    setOut((o) => ({ ...o, busy: true }));
    getRuns(pageId, offset)
      .then((data) => { if (mine === seq.current) setOut({ data, error: '', busy: false }); })
      .catch((e) => { if (mine === seq.current) setOut({ data: null, error: e.message, busy: false }); });
  }, [pageId, offset, nonce, on]);
  return out;
}

export function runCounts(data) {
  if (!data) return {};
  const latest = data.offset === 0 ? (data.runs || []).find((r) => r.status === 'done' && r.to_fix != null) : null;
  return { overview: latest ? latest.to_fix : null, runs: data.total };
}

function Tables({ tables }) {
  if (tables == null) return <p className="none">This run did not record the tables it used.</p>;
  if (!tables.length) return <p className="none">This run recorded no tables.</p>;
  return (
    <div className="tbl-wrap">
      <table className="tbl runs-sub" aria-label="Tables this run used">
        <thead><tr><th>Table</th><th className="num">Rows read</th><th>Last updated</th></tr></thead>
        <tbody>
          {tables.map((t, i) => (
            <tr key={`${t.table}#${i}`}>
              <td className="nowrap"><code>{t.table}</code></td>
              <td className="num">{t.rows == null ? <None /> : integer(t.rows)}</td>
              <td className="nowrap">{t.updated_at ? stampText(t.updated_at) : <None />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Details({ run, id }) {
  const wrong = STOPPED.includes(run.status) ? errorText(run) : null;
  const steps = stepsText(run.stages);
  return (
    <div className="runs-g" id={id}>
      <section><h3>Tables it used</h3><Tables tables={run.tables} /></section>
      <section>
        <h3>{wrong ? 'What went wrong' : 'What it found'}</h3>
        {wrong ? (
          <div className="run-err">
            <p>{wrong.lead}</p>
            {wrong.detail && <small>Details: {wrong.detail}</small>}
            {run.url && <a className="run-link" href={run.url} target="_blank" rel="noopener noreferrer">Open the run</a>}
          </div>
        ) : <p>{foundText(run)}</p>}
      </section>
      {steps.length > 0 && (
        <section className="runs-steps"><h3>How long each step took</h3><ol>{steps.map((s, i) => <li key={`${i}:${s}`}>{s}</li>)}</ol></section>
      )}
    </div>
  );
}

function RunRow({ run, open, onToggle }) {
  const flag = runFlag(run.status);
  const id = `run-d-${slug(runKey(run))}`;
  const when = run.started ? stampText(run.started) : 'Not recorded';
  return (
    <>
      <tr className={`is-click${open ? ' is-open' : ''}`} onClick={onToggle}>
        <td className="runs-x">
          <button className="ibtn ibtn--sm runs-tog" aria-expanded={open} aria-controls={open ? id : undefined}
            aria-label={`${open ? 'Hide' : 'Show'} the run of ${when}`} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            <Icon name="right" size={14} />
          </button>
        </td>
        <td className="nowrap"><b>{when}</b><span className="runs-sub-t">{lastedText(run)}</span></td>
        <td className="nowrap"><span className={`run-st run-st--${flag.tone}`}><i aria-hidden="true" />{flag.text}</span></td>
        <td className="nowrap">{triggerText(run.trigger)}{run.by && <span className="runs-sub-t">{run.by}</span>}</td>
        <td className="wrap">{coveredText(run.segments)}</td>
        <td className="num">{run.records ? integer(run.records) : <None />}</td>
        <td className="num">{count(run.to_fix)}</td>
        <td className="num money">{run.could_save == null ? <None /> : <Fx formula={couldSaveRunFormula(run)}>{formatValue(run.could_save, unitOf(run) ? 'currency' : 'number', unitOf(run), undefined, kindOf(run))}</Fx>}</td>
      </tr>
      {open && <tr className="runs-d"><td colSpan={COLUMNS}><Details run={run} id={id} /></td></tr>}
    </>
  );
}

function emptyText(page, job) {
  if (job) return 'The job has not run yet.';
  return page.history ? 'This use case has not recorded a run yet.' : 'This use case has no job and keeps no results table, so it has no runs to show.';
}

export default function Runs({ page, runs, offset, onOffset, onExplain, genieBusy }) {
  const [open, setOpen] = useState(() => new Set());
  const { data, error, busy } = runs;
  const list = data?.runs || [];
  const total = data?.total || 0;
  const size = data?.limit || RUNS_PAGE;
  const errors = data?.errors || {};
  const details = errors.summary || errors.details;
  const toggle = (key) => setOpen((was) => {
    const next = new Set(was);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return (
    <>
      {((busy && !data) || list.length > 0) && (
        <BarsCard id="to_fix_runs" title="To fix per run" hint="Each bar is a run listed below, oldest on the left." vertical hue={page.hue || 'blue'}
          loading={busy && !data} bars={runBars(list)} empty="No run listed below wrote a count of things to fix." x="Run" measure="To fix"
          onExplain={onExplain} genieBusy={genieBusy} />
      )}
      <section className="card card--table runs" aria-label="Runs" aria-busy={busy}>
        <header className="card-h">
          <div>
            <h2>Runs</h2>
            <p>Newest first. Click a run to see the tables it used. Refresh now updates all the data.</p>
          </div>
        </header>
        {busy && !data && <div style={{ padding: 16, display: 'grid', gap: 10 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={22} />)}</div>}
        {error && <p className="tile-err" role="alert"><Icon name="info" size={14} />The runs could not load: {error}</p>}
        {data?.job?.error && <p className="tile-err" role="alert"><Icon name="info" size={14} />The job's runs could not load, so the list shows only the runs this use case recorded: {data.job.error}</p>}
        {errors.table && <p className="tile-err" role="alert"><Icon name="info" size={14} />The runs written to the results table could not load: {errors.table}</p>}
        {details && <p className="tile-err" role="alert"><Icon name="info" size={14} />The details of each run could not load, so the list shows what the job recorded: {details}</p>}
        {data && (
          <>
            <div className="tbl-wrap">
              <table className="tbl runs-tbl" aria-label="Runs of this use case">
                <thead>
                  <tr>
                    <th className="runs-x"><span className="sr">Details</span></th>
                    <th>When</th><th>Status</th><th>Started by</th><th>What it covered</th>
                    <th className="num">Records</th><th className="num">To fix</th><th className="num">Could save</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((run) => <RunRow key={runKey(run)} run={run} open={open.has(runKey(run))} onToggle={() => toggle(runKey(run))} />)}
                </tbody>
              </table>
            </div>
            {!list.length && <p className="more">{total ? runsPageText(data.offset, 0, total) : emptyText(page, data.job && !data.job.error ? data.job : null)}</p>}
            {total > size && (
              <div className="pager">
                <span className="pager-n">{runsPageText(data.offset, list.length, total)}</span>
                <span className="sp" />
                <button className="ibtn ibtn--sm" onClick={() => onOffset(Math.max(0, offset - size))} disabled={offset === 0} aria-label="Newer runs"><Icon name="left" size={15} /></button>
                <button className="ibtn ibtn--sm" onClick={() => onOffset(offset + size)} disabled={offset + size >= total} aria-label="Older runs"><Icon name="right" size={15} /></button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
