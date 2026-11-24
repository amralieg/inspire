import { useEffect, useState } from 'react';
import { PlainMessage } from '../TechnicalDetails';
import MacroChart from './MacroChart.jsx';
import { SERIES_ROUTE, SOURCES_ROUTE, blockedLine, citationLine, orderSources, seriesQuery } from '../../lib/macroData.js';

// REQ-507 L5: the Market data pages macro:offer, macro:series and macro:factor. Every fetch goes through the App (get(route, query)); the
// server returns the series and the scaled factor, and this step only shows them and saves the factor with its source into the plan.
const NEXT_AFTER = 'story:draft';
const btn = 'rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-text-primary';

export default function StepMacro({ plan, onPlan, get, inspireDatabase, warehouseId, page, onPage }) {
  const factors = plan?.economic_factors || [];
  const [targetId, setTargetId] = useState(factors[0]?.id);
  const target = factors.find((f) => f.id === targetId) || factors[0];
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState('');
  const [country, setCountry] = useState('');
  const [indicator, setIndicator] = useState('');
  const [elasticity, setElasticity] = useState(1);
  const [reply, setReply] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    if (page !== 'macro:series' || sources.length) return undefined;
    let live = true;
    Promise.resolve(get(SOURCES_ROUTE, {})).then((r) => { if (live) setSources(orderSources(r?.sources || [])); })
      .catch(() => { if (live) setError('The list of data sources could not be loaded. You can keep your own estimates.'); });
    return () => { live = false; };
  }, [page, get, sources.length]);

  const ask = async (e) => {
    if (!target) return;
    setBusy(true); setError(''); setSaved('');
    try {
      const r = await get(SERIES_ROUTE, { ...seriesQuery({ source, indicator, country, inspire_database: inspireDatabase, warehouse_id: warehouseId }),
        factor_id: target.id, factor_label: target.label, elasticity: String(e) });
      setReply(r);
      if (!blockedLine(r) && r?.series) onPage('macro:factor');
      else if (page === 'macro:factor') onPage('macro:series');
    } catch (err) { setError(err?.message || 'The series could not be fetched.'); } finally { setBusy(false); }
  };

  const keep = <button type="button" className={btn} onClick={() => onPage(NEXT_AFTER)}>Keep my own estimates</button>;

  if (page === 'macro:offer') {
    return (
      <div data-wizard-page="macro:offer" className="space-y-2">
        <h3 className="text-sm font-bold text-text-primary">Use public economic data for these factors?</h3>
        <ul className="list-disc ps-5 text-[13px] text-text-secondary">{factors.map((f) => <li key={f.id}>{f.label}</li>)}</ul>
        <div className="flex gap-2">
          <button type="button" data-recommended="true" className={`${btn} bg-primary-solid text-white`} onClick={() => onPage('macro:series')}>Use public data</button>
          {keep}
        </div>
      </div>
    );
  }

  if (page === 'macro:series') {
    const blocked = blockedLine(reply);
    return (
      <div data-wizard-page="macro:series" className="space-y-2">
        <h3 className="text-sm font-bold text-text-primary">{`Pick a source${target ? ` for ${target.label}` : ''}`}</h3>
        <div className="grid grid-cols-2 gap-2">
          {sources.map((s) => (
            <button key={s.id} type="button" data-macro-source={s.id} aria-pressed={source === s.id} onClick={() => setSource(s.id)}
              className={`rounded-lg border px-3 py-2 text-start text-[12px] ${source === s.id ? 'border-primary-solid ring-1 ring-primary-solid' : 'border-border'}`}>
              <b className="block text-[13px] text-text-primary">{s.name}</b>
              <span className="text-text-secondary">{s.licence}</span>
              {s.terms && <span className="block text-text-secondary">{s.terms}</span>}
              {s.id === 'marketplace' && s.configured === false && <span className="block text-text-secondary">Not set up yet: an admin names its table.</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label className="text-[12px] text-text-secondary">Country <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} className="rounded border border-border px-2 py-1 text-[13px]" /></label>
          <label className="text-[12px] text-text-secondary">Indicator <input type="text" value={indicator} onChange={(e) => setIndicator(e.target.value)} className="rounded border border-border px-2 py-1 text-[13px]" /></label>
        </div>
        {blocked && <PlainMessage text={blocked} role="alert" data-macro-blocked="" className="rounded-md border border-error/30 bg-error-bg px-3 py-1.5 text-[12px] text-error-fg" />}
        {error && <PlainMessage text={error} role="alert" className="rounded-md border border-error/30 bg-error-bg px-3 py-1.5 text-[12px] text-error-fg" />}
        <div className="flex gap-2">
          <button type="button" className={btn} disabled={busy || !source || !country || !indicator} onClick={() => { setElasticity(1); ask(1); }}>Get series</button>
          {keep}
        </div>
      </div>
    );
  }

  if (page === 'macro:factor' && reply?.series) {
    const useIt = () => {
      if (!reply.factor || !target) return;
      onPlan({ ...plan, economic_factors: factors.map((f) => (f.id === target.id ? reply.factor : f)) });
      setSaved(`Saved for ${target.label}`);
      const next = factors.find((f) => f.id !== target.id && !f.source);
      if (next) { setTargetId(next.id); setReply(null); onPage('macro:series'); }
    };
    return (
      <div data-wizard-page="macro:factor" className="space-y-2">
        <h3 className="text-sm font-bold text-text-primary">{target?.label}</h3>
        <MacroChart series={reply.series} />
        <p data-macro-citation="" className="text-[12px] text-text-secondary">{citationLine(reply.series)}</p>
        <div data-elasticity="" className="text-[12px] text-text-secondary">
          <label>Sensitivity to this series <input type="range" min={0} max={3} step={0.1} value={elasticity}
            onChange={(e) => { const v = Number(e.target.value); setElasticity(v); ask(v); }} className="w-full" /></label>
          <span className="tabular-nums">{elasticity}</span>
        </div>
        {saved && <p role="status" className="text-[12px] text-text-secondary">{saved}</p>}
        <div className="flex gap-2">
          <button type="button" className={btn} disabled={busy || !reply.factor} onClick={useIt}>{`Use this for ${target?.label}`}</button>
          {keep}
        </div>
      </div>
    );
  }
  return null;
}
