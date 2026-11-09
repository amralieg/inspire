import { useEffect, useState } from 'react';
import { getForecastAccuracy } from './api.js';
import { Stat } from './PlanPerformance.jsx';
import { Icon } from './icons.jsx';
import { Skeleton } from './ui.jsx';
import { NOT_RECORDED, formatValue, integer, percent } from './format.js';
import './styles/plan.css';

const pct = (share) => (share == null ? NOT_RECORDED : percent(share * 100));
const signed = (share) => (share == null ? NOT_RECORDED : `${share > 0 ? '+' : ''}${percent(share * 100)}`);

export function biasWords(bias) {
  if (bias == null) return 'no past periods with actuals yet';
  if (Math.abs(bias) < 0.005) return 'the forecast is balanced';
  return bias > 0 ? 'the forecast runs above the actuals' : 'the forecast runs below the actuals';
}

export function liftWords(d) {
  if (!d.overrides) return 'no override has an actual to check yet';
  if (d.lift == null) return `${integer(d.overrides)} override${d.overrides === 1 ? '' : 's'} checked`;
  return `${d.lift >= 0 ? 'better' : 'worse'} than the model alone · ${integer(d.helped)} helped, ${integer(d.hurt)} hurt`;
}

export default function AccuracyPanel({ page }) {
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    let live = true;
    getForecastAccuracy(page.id).then((data) => live && setState({ data, error: '' })).catch((e) => live && setState({ data: null, error: e.message }));
    return () => { live = false; };
  }, [page.id]);
  const d = state.data;
  return (
    <section className="plan-perf" aria-label="Accuracy" data-accuracy>
      {state.error && <p className="tile-err" role="alert"><Icon name="info" size={14} />The forecast accuracy could not load: {state.error}</p>}
      {!d && !state.error && <section className="card"><Skeleton height={80} /></section>}
      {d && (
        <>
          <div className="mstats">
            <Stat id="error" label="Forecast error" value={pct(d.error)} note={d.points ? `over ${integer(d.points)} past periods of ${integer(d.series)} series` : 'no past periods with actuals yet'} />
            <Stat id="bias" label="Bias" value={signed(d.bias)} note={biasWords(d.bias)} tone={d.bias != null && Math.abs(d.bias) >= 0.05 ? 'bad' : ''} />
            <Stat id="mase" label="Error vs naive" value={d.mase == null ? NOT_RECORDED : formatValue(d.mase, 'number', 'USD', 2)} note="below 1 beats a naive guess" tone={d.mase > 1 ? 'bad' : d.mase != null ? 'good' : ''} />
            <Stat id="lift" label="Override lift" value={signed(d.lift)} note={liftWords(d)} tone={d.lift > 0 ? 'good' : d.lift < 0 ? 'bad' : ''} />
          </div>
          {d.lift_note && <p className="tile-err" data-plans-missing><Icon name="info" size={14} />{d.lift_note}</p>}
          <p className="muted plan-how">Forecast error is the total absolute error divided by the total actuals. Bias is the total signed error divided by the total actuals.
            Override lift compares each override with the model's forecast it replaced, once the actual is in.</p>
        </>
      )}
    </section>
  );
}
