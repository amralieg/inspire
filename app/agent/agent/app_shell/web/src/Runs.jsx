import { useEffect, useRef, useState } from 'react';
import { saveSetting } from './api.js';
import { formatValue, integer, kindOf, unitOf } from './format.js';
import Fx from './Fx.jsx';
import { Icon } from './icons.jsx';
import { Skeleton, PlainNote, useRetry } from './ui.jsx';
import ChartCard, { BarsCard } from './ChartCard.jsx';
import DataTable from './DataTable.jsx';
import { fieldsOf, tableContext } from './explain.js';
import { AskGenie } from './AskGenie.jsx';
import {
  RUNS_PAGE, STOPPED, couldSaveRunFormula, coveredText, errorText, foundText, groupingText, lastedText, runBars, runFlag, runKey, runsPageText, stampText, stepsText,
  triggerText,
} from './freshness.js';
import { timelineChart } from './trends.js';
import { SectionHelp } from './SectionHelp.jsx';

function RunNow({ onRun, running }) {
  return (
    <div className="runs-now" data-runs-now>
      <button type="button" className="btn btn--pri" onClick={() => onRun()} disabled={running} aria-busy={running}>
        <Icon name="undo" size={14} />{running ? 'Running' : 'Run now'}
      </button>
      <p className="note">Runs this use case again on all its data. Only its owners can start a run.</p>
    </div>
  );
}

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const None = () => <span className="none">none</span>;
const count = (n) => (n == null ? <None /> : integer(n));

const TABLE_COLUMNS = [
  { key: 'table', label: 'Table', className: 'nowrap', render: (t) => <code>{t.table}</code> },
  { key: 'rows', label: 'Rows read', num: true, render: (t) => (t.rows == null ? <None /> : integer(t.rows)) },
  { key: 'updated_at', label: 'Last updated', date: true, className: 'nowrap', render: (t) => (t.updated_at ? stampText(t.updated_at) : <None />) },
];

function Tables({ tables }) {
  if (tables == null) return <p className="none">This run did not record the tables it used.</p>;
  if (!tables.length) return <p className="none">This run recorded no tables.</p>;
  return <DataTable label="Tables this run used" tableClass="runs-sub" columns={TABLE_COLUMNS} rows={tables} rowKey={(t) => t.table} grid="runs:tables"
    askRow={(t) => ({ title: t.table, context: { hint: 'A table this run used.', fields: fieldsOf(t, TABLE_COLUMNS) } })} />;
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

const detailsId = (run) => `run-d-${slug(runKey(run))}`;
const whenText = (run) => (run.started ? stampText(run.started) : 'Not recorded');

function runColumns(isOpen, toggle) {
  return [
    {
      key: '_open', label: 'Details', hideLabel: true, fixed: true, className: 'runs-x',
      render: (run) => {
        const open = isOpen(run);
        return (
          <button className="ibtn ibtn--sm runs-tog" aria-expanded={open} aria-controls={open ? detailsId(run) : undefined}
            aria-label={`${open ? 'Hide' : 'Show'} the run of ${whenText(run)}`} onClick={(e) => { e.stopPropagation(); toggle(run); }}>
            <Icon name="right" size={14} />
          </button>
        );
      },
    },
    { key: 'started', label: 'When', date: true, className: 'nowrap', render: (run) => <><b>{whenText(run)}</b><span className="runs-sub-t">{lastedText(run)}</span></> },
    {
      key: 'status', label: 'Status', className: 'nowrap', sortValue: (run) => runFlag(run.status).text,
      render: (run) => { const flag = runFlag(run.status); return <span className={`run-st run-st--${flag.tone}`}><i aria-hidden="true" />{flag.text}</span>; },
    },
    { key: 'trigger', label: 'Started by', className: 'nowrap', sortValue: (run) => triggerText(run.trigger), render: (run) => <>{triggerText(run.trigger)}{run.by && <span className="runs-sub-t">{run.by}</span>}</> },
    { key: 'segments', label: 'What it covered', className: 'wrap', sortValue: (run) => coveredText(run.segments), render: (run) => <>{coveredText(run.segments)}{run.scope_text && <span className="runs-sub-t">{run.scope_text}</span>}{groupingText(run.grouping) && <span className="runs-sub-t" data-grouping>{groupingText(run.grouping)}</span>}</> },
    { key: 'records', label: 'Records', num: true, render: (run) => (run.records ? integer(run.records) : <None />) },
    { key: 'to_fix', label: 'To fix', num: true, render: (run) => count(run.to_fix) },
    {
      key: 'could_save', label: 'Could save', num: true, className: 'could-save',
      render: (run) => (run.could_save == null ? <None />
        : <Fx formula={couldSaveRunFormula(run)}>{formatValue(run.could_save, unitOf(run) ? 'currency' : 'number', unitOf(run), undefined, kindOf(run))}</Fx>),
    },
  ];
}

function ScopeFacts({ page, run, onRun, running }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const everything = async () => {
    setBusy(true);
    try {
      await saveSetting({ page: page.id, name: 'run_scope', value: 'all', was: run.scope?.scope || '', note: 'Run on everything' });
      setSaid('');
      await onRun((started) => `The run on everything is ${started.state || 'starting'}; schedules now cover all the records too.`);
    } catch (err) {
      setSaid(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card runs-scope" aria-label="First run">
      <p>{run.facts.covered}</p>
      {run.facts.everything && <p>{run.facts.everything}</p>}
      {run.facts.trained && <p>{run.facts.trained}</p>}
      <button className="btn" onClick={everything} disabled={busy || running}>Run on everything</button>
      {said && <p role="status">{said}</p>}
    </section>
  );
}

function emptyText(page, job) {
  if (job) return 'The job has not run yet.';
  return page.history ? 'This use case has not recorded a run yet.' : 'This use case has no job and keeps no results table, so it has no runs to show.';
}

export default function Runs({ page, runs, offset, onOffset, onExplain, genieBusy, trends, themeKey, app, onRun, running, opened = '' }) {
  const retry = useRetry();
  const [open, setOpen] = useState(() => new Set(opened ? [opened] : []));
  const { data, error, busy } = runs;
  const list = data?.runs || [];
  const total = data?.total || 0;
  const size = data?.limit || RUNS_PAGE;
  const errors = data?.errors || {};
  const details = errors.summary || errors.details;
  const scoped = list.find((r) => r.facts && r.facts.covered);
  const isOpen = (run) => open.has(runKey(run));
  const toggle = (run) => setOpen((was) => {
    const next = new Set(was);
    if (next.has(runKey(run))) next.delete(runKey(run));
    else next.add(runKey(run));
    return next;
  });
  const columns = runColumns(isOpen, toggle);
  const timeline = timelineChart(list, trends);
  return (
    <>
      {data?.can_run && onRun && <RunNow onRun={onRun} running={running} />}
      {data && timeline.result.rows.length > 0 && (
        <ChartCard chart={timeline.chart} result={timeline.result} themeKey={themeKey} app={app || {}} pageId={page.id} onExplain={onExplain} genieBusy={genieBusy} />
      )}
      {((busy && !data) || list.length > 0) && (
        <BarsCard id="to_fix_runs" title="To fix per run" hint="Each bar is a run listed below, oldest on the left." vertical hue={page.hue || 'blue'}
          loading={busy && !data} bars={runBars(list)} empty="No run listed below wrote a count of things to fix." x="Run" measure="To fix"
          onExplain={onExplain} genieBusy={genieBusy} />
      )}
      {scoped && onRun && <ScopeFacts page={page} run={scoped} onRun={onRun} running={running} />}
      <section className="card card--table runs" aria-label="Runs" aria-busy={busy}>
        <header className="card-h">
          <div>
            <h2>Runs</h2>
            <p>Newest first. Click a run to see the tables it used. Refresh now updates all the data.</p>
          </div>
          <SectionHelp title="Runs" steps={[{ title: 'Each refresh of this use case', text: 'Each row is one refresh: when it ran, what it found and the figures it reached. Click a run to see which tables it read.' }]} />
          <AskGenie kind="table" title="Runs" context={tableContext('The runs of this use case, newest first.', list, (run) => fieldsOf(run, columns), total)} />
        </header>
        {busy && !data && <div style={{ padding: 16, display: 'grid', gap: 10 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={22} />)}</div>}
        {error && <PlainNote text={error} prefix="The runs could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={retry} />}
        {data?.job?.error && <PlainNote text={data.job.error} prefix="The job's runs could not load, so the list shows only the runs this use case recorded: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={retry} />}
        {errors.table && <PlainNote text={errors.table} prefix="The runs written to the results table could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={retry} />}
        {details && <PlainNote text={details} prefix="The details of each run could not load, so the list shows what the job recorded: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={retry} />}
        {data && (
          <>
            <DataTable label="Runs of this use case" tableClass="runs-tbl" columns={columns} rows={list} rowKey={runKey} paged={false} grid={`page:${page.id}:runs`}
              askRow={(run) => ({ title: `The run of ${whenText(run)}`, context: { hint: 'A run of this use case.', fields: fieldsOf(run, columns) } })}
              onRow={toggle} rowClass={(run) => (isOpen(run) ? 'is-open' : '')} detail={(run) => (isOpen(run) ? <Details run={run} id={detailsId(run)} /> : null)} detailClass="runs-d"
              empty={total ? runsPageText(data.offset, 0, total) : emptyText(page, data.job && !data.job.error ? data.job : null)} />
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
