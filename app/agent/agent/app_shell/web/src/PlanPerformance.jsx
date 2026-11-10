import { getPlanResults } from './api.js';
import { Icon } from './icons.jsx';
import { usePlans } from './PlanSection.jsx';
import { PlainNote, Skeleton } from './ui.jsx';
import { NOT_RECORDED, formatValue, integer } from './format.js';
import './styles/plan.css';

const STATE_WORDS = { on: 'On plan', off: 'Off plan', unknown: 'Not known yet' };

export function Stat({ label, value, note, tone = '', id }) {
  return (
    <div className={`mstat ${tone ? `is-${tone}` : ''}`} data-stat={id}>
      <span>{label}</span><b>{value}</b>{note && <small>{note}</small>}
    </div>
  );
}

const valueLook = (page) => {
  const hero = (page.kpis || []).find((k) => k.section === 'objective_kpi') || {};
  return [hero.format || 'number', hero.currency || 'USD'];
};

export default function PlanPerformance({ page }) {
  const state = usePlans(page.id, getPlanResults);
  const plan = page.plan || {};
  const fmt = (v) => formatValue(v, plan.format, plan.currency);
  const [vf, vc] = valueLook(page);
  const money = (v) => formatValue(v, vf, vc);
  const d = state.data;
  return (
    <section className="plan-perf" aria-label="Plan against actuals" data-plan-performance>
      {state.error && <PlainNote text={state.error} prefix="The plan results could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={state.reload} />}
      {!d && !state.error && <section className="card"><Skeleton height={80} /></section>}
      {d?.missing && <p className="tile-err" data-plans-missing><Icon name="info" size={14} />{d.missing}</p>}
      {d && !d.version && !d.missing && <p className="empty" data-no-plan>No version of this plan is approved or published yet, so there is nothing to compare with the actuals.</p>}
      {d?.version && (
        <>
          <div className="mstats">
            <Stat id="version" label="Compared version" value={`${d.version.label}`} note={d.version.status} />
            <Stat id="on_plan" label="Lines on plan" value={`${integer(d.on_plan)} of ${integer(d.counted)}`} note="within 1% of the planned value" tone="good" />
            <Stat id="off_plan" label="Lines off plan" value={integer(d.off_plan)} tone={d.off_plan ? 'bad' : ''} note={d.unknown ? `${integer(d.unknown)} not known yet` : ''} />
            <Stat id="realized" label="Value realized" value={d.has_value ? money(d.value_realized) : NOT_RECORDED}
              note={d.has_value ? `of ${money(d.value_planned)} planned` : 'the plan lines carry no objective_contribution column'} />
          </div>
          <section className="card card--table" aria-label="Plan against actuals by line">
            <header className="card-h"><div><h2>Plan against actuals</h2><p>Each line of {d.version.label} next to its value in the latest run. Lines off plan come first.</p></div></header>
            {d.lines.length ? (
              <div className="tw"><table className="plan-t">
                <thead><tr><th scope="col">Line</th><th scope="col">Planned</th><th scope="col">Now</th><th scope="col">Gap</th><th scope="col">State</th><th scope="col">Override reason</th></tr></thead>
                <tbody>{d.lines.map((l) => (
                  <tr key={l.line_key} data-perf-line={l.line_key} data-state={l.state}>
                    <th scope="row"><bdi>{l.label}</bdi></th>
                    <td className="num">{fmt(l.planned)}</td><td className="num">{fmt(l.actual)}</td>
                    <td className={`num ${l.gap > 0 ? 'is-up' : l.gap < 0 ? 'is-down' : ''}`}>{l.gap == null ? '' : `${l.gap > 0 ? '+' : ''}${fmt(l.gap)}`}</td>
                    <td>{STATE_WORDS[l.state]}</td><td dir="auto">{l.overridden ? l.reason : ''}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <p className="empty">The latest run has no lines for this plan.</p>}
            {d.truncated && <p className="muted" data-truncated>The App compared the first {integer(d.counted)} lines only.</p>}
          </section>
        </>
      )}
    </section>
  );
}
