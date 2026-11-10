import { useEffect, useState } from 'react';
import './echartsKinds.js';
import { useChart } from './ChartCard.jsx';
import { evaluateScenario, writeRecord } from './api.js';
import { axisValue, formatValue, numberOf } from './format.js';
import { chartPalette, reducedMotion } from './theme.js';
import { Icon } from './icons.jsx';
import { categoryLabels } from './layout.js';
import { Skeleton, useDebounced, useToast, PlainNote } from './ui.jsx';
import { SaveButton, runWrite } from './saving.jsx';
import { AskGenie } from './AskGenie.jsx';

const STEPS = 100;

export function distributionOption(result, outcome, P) {
  const fmt = (v) => formatValue(v, outcome.format, outcome.currency);
  const o = result.outcome;
  const lines = [['P10', o.p10], ['P50', o.p50], ['P90', o.p90]].map(([name, x]) => ({ name, xAxis: x, label: { formatter: `${name} ${fmt(x)}`, color: P.muted } }));
  if (o.target != null) lines.push({ name: 'Target', xAxis: o.target, lineStyle: { color: P.ink, type: 'solid' }, label: { formatter: `Target ${fmt(o.target)}`, color: P.ink } });
  return {
    animation: !reducedMotion(),
    grid: { left: 16, right: 16, top: 34, bottom: 30 },
    xAxis: { type: 'value', scale: true, axisLabel: { color: P.muted, formatter: (v) => axisValue(v, outcome.format, outcome.currency) }, splitLine: { show: false } },
    yAxis: { type: 'value', show: false },
    tooltip: { show: false },
    series: [{ type: 'line', smooth: true, symbol: 'none', data: result.distribution, lineStyle: { color: P.series[0], width: 2 },
      areaStyle: { color: P.series[0], opacity: 0.18 }, markLine: { symbol: 'none', silent: true, lineStyle: { color: P.muted, type: 'dashed' }, data: lines } }],
  };
}

export function gaugeOption(chance, P) {
  const pct = Math.round(numberOf(chance) * 100);
  return {
    animation: !reducedMotion(),
    series: [{ type: 'gauge', min: 0, max: 100, startAngle: 200, endAngle: -20, radius: '95%', center: ['50%', '62%'],
      progress: { show: true, width: 12, itemStyle: { color: pct >= 70 ? P.series[2] : pct >= 40 ? P.series[3] : P.series[5] } },
      axisLine: { lineStyle: { width: 12, color: [[1, P.well]] } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
      pointer: { show: false }, title: { show: false }, detail: { offsetCenter: [0, '-5%'], formatter: '{value}%', color: P.ink, fontSize: 24, fontWeight: 700 },
      data: [{ value: pct }] }],
  };
}

export function sensitivityOption(result, levers, P) {
  const label = Object.fromEntries(levers.map((l) => [l.lever, l.label]));
  const rows = [...result.contributions].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const names = rows.map((r) => label[r.lever] || r.lever);
  const cats = categoryLabels(names, { fontSize: 12, side: true });
  return {
    grid: { left: cats.left, right: 24, top: 10, bottom: 24 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', axisLabel: { color: P.muted } },
    yAxis: { type: 'category', inverse: true, data: names, axisLabel: { color: P.muted, ...cats.axisLabel } },
    series: [{ type: 'bar', barMaxWidth: 20, data: rows.map((r) => ({ value: r.delta, itemStyle: { color: r.delta >= 0 ? P.series[2] : P.series[5], borderRadius: 3 } })) }],
  };
}

function outcomeFields(result) {
  const o = result?.outcome;
  if (!o) return {};
  return { P10: o.p10, P50: o.p50, P90: o.p90, ...(o.target != null ? { Target: o.target } : {}),
    ...(o.prob_target != null ? { 'Chance of reaching the target': o.prob_target } : {}) };
}

function SaveScenario({ page, app, result, onSaved }) {
  const save = page.scenario.save;
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  if (!save || !app?.options?.modify) return null;
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    await runWrite('scenario:save', async () => {
      try {
        const levers = Object.fromEntries(result.levers.map((l) => [l.lever, l.value]));
        await writeRecord('add', { page: page.id, values: { [save.name]: name.trim(), [save.levers]: JSON.stringify(levers), [save.outcome]: result.outcome.p50 } });
        toast(`Saved the scenario ${name.trim()}`);
        setName('');
        onSaved?.();
      } catch (err) {
        setError(err.message);
      }
    });
  };
  return (
    <form className="scenario-save" onSubmit={submit} data-save>
      <label>Name this scenario<input dir="auto" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <SaveButton write="scenario:save" className="btn btn--sm btn--pri" type="submit" disabled={!result || !name.trim()}>Save the scenario</SaveButton>
      {(!result || !name.trim()) && <p className="text-[12px] text-text-secondary" data-save-missing>{`Add ${[!result && 'a result', !name.trim() && 'a name'].filter(Boolean).join(' and ')} to save.`}</p>}
      {error && <PlainNote text={error} icon={<Icon name="info" size={12} />} className="tile-err" role="alert" />}
    </form>
  );
}

export default function ScenarioPanel({ page, app, ready, order, onSaved, saver = null }) {
  const scenario = page.scenario;
  const outcome = scenario.outcome || {};
  const [values, setValues] = useState({});
  const asked = useDebounced(values, 150);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [again, setAgain] = useState(0);
  const P = chartPalette();
  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    evaluateScenario({ page: page.id, values: asked })
      .then((r) => { if (live) { setResult(r); setError(''); } })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [page.id, ready, JSON.stringify(asked), again]);
  const { el: dist } = useChart(result ? distributionOption(result, outcome, P) : null, [result]);
  const { el: gauge } = useChart(result && result.outcome.prob_target != null ? gaugeOption(result.outcome.prob_target, P) : null, [result]);
  const { el: sens } = useChart(result ? sensitivityOption(result, scenario.levers, P) : null, [result]);
  const ranges = Object.fromEntries((result?.levers || []).map((l) => [l.lever, l]));
  const fmt = (v) => formatValue(v, outcome.format, outcome.currency);
  const names = Object.fromEntries(scenario.levers.map((l) => [l.lever, l.label || l.lever]));
  const levers = Object.fromEntries((result?.levers || []).map((l) => [names[l.lever] || l.lever, l.value]));
  const moves = (result?.contributions || []).map((c) => ({ Lever: names[c.lever] || c.lever, 'Change in the P50': c.delta }));
  const parts = {
    levers: (section) => (
      <section key={section} className="card scenario" data-section={section} aria-label={scenario.title}>
        <header className="card-h"><div><h2>{scenario.title}</h2>{scenario.hint && <p>{scenario.hint}</p>}</div>
          <button type="button" className="btn btn--sm" onClick={() => setValues({})} disabled={!Object.keys(values).length}>Back to the base case</button>
          <AskGenie kind="scenario" title={scenario.title} context={{ hint: scenario.hint || '', fields: { ...levers, ...outcomeFields(result) } }} />
        </header>
        {error && <PlainNote text={error} icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={() => setAgain((n) => n + 1)} />}
        {!result && !error && <div style={{ padding: 16 }}><Skeleton height={120} /></div>}
        {result && (
          <div className="levers">
            {scenario.levers.map((lever) => {
              const r = ranges[lever.lever];
              if (!r) return null;
              const step = lever.step || (r.high - r.low) / STEPS || 1;
              return (
                <label key={lever.lever} className="lever" data-lever={lever.lever}>
                  <span>{lever.label}<b>{formatValue(r.value, lever.format, lever.currency)}</b></span>
                  <input type="range" min={r.low} max={r.high} step={step} value={values[lever.lever] ?? r.value}
                    onChange={(e) => setValues((v) => ({ ...v, [lever.lever]: Number(e.target.value) }))} aria-label={lever.label} />
                  <small>{formatValue(r.low, lever.format, lever.currency)} to {formatValue(r.high, lever.format, lever.currency)}, base {formatValue(r.base, lever.format, lever.currency)}</small>
                </label>
              );
            })}
          </div>
        )}
        {result && (saver ? saver(result) : <SaveScenario page={page} app={app} result={result} onSaved={onSaved} />)}
      </section>
    ),
    scenario: (section) => (
      <section key={section} className="charts" data-section={section}>
        <article className="card card--wide" data-card="outcome">
          <header className="card-h"><div><h2>{outcome.label}</h2>
            {result && <p data-quantiles>P10 {fmt(result.outcome.p10)} · P50 {fmt(result.outcome.p50)} · P90 {fmt(result.outcome.p90)}</p>}</div>
            <AskGenie kind="chart" title={outcome.label} context={{ hint: `The range of the ${outcome.label?.toLowerCase() || 'outcome'} for the levers as set.`, fields: outcomeFields(result) }} /></header>
          <div className="chart"><div ref={dist} style={{ position: 'absolute', inset: 0 }} /></div>
        </article>
        <article className="card" data-card="lever_effect">
          <header className="card-h"><div><h2>What each lever moves</h2><p>Change in the P50 {outcome.label?.toLowerCase()} from the base case</p></div>
            <AskGenie kind="chart" title="What each lever moves" context={{ hint: `Change in the P50 ${outcome.label?.toLowerCase() || 'outcome'} from the base case.`, rows: moves, row_count: moves.length }} /></header>
          <div className="chart"><div ref={sens} style={{ position: 'absolute', inset: 0 }} /></div>
        </article>
      </section>
    ),
    target: (section) => result?.outcome.prob_target != null && (
      <section key={section} className="charts" data-section={section}>
        <article className="card" data-card="chance">
          <header className="card-h"><div><h2>Chance of reaching the target</h2><p>Target {fmt(result.outcome.target)}</p></div>
            <AskGenie kind="chart" title="Chance of reaching the target" context={{ hint: `The chance the ${outcome.label?.toLowerCase() || 'outcome'} reaches its target.`, fields: outcomeFields(result) }} /></header>
          <div className="chart chart--gauge"><div ref={gauge} style={{ position: 'absolute', inset: 0 }} /></div>
        </article>
      </section>
    ),
  };
  return <>{order.map(([section, part]) => (typeof part === 'string' ? parts[part](section) : part))}</>;
}
