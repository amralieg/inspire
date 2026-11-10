import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlans } from './api.js';
import { PlanTable, Resolve, acceptOpenLines, planDecides, planOpen } from './Layouts.jsx';
import { PLAN_WORDS, VersionBar, statusWord, versionName } from './PlanVersions.jsx';
import { Icon } from './icons.jsx';
import { PlainNote, Skeleton } from './ui.jsx';
import { formatValue, integer, numberOf } from './format.js';
import './styles/plan.css';

export function usePlans(pageId, load = getPlans) {
  const [state, setState] = useState({ data: null, error: '', scope: '' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    load(pageId).then((data) => live && setState({ data, error: '', scope: pageId }))
      .catch((e) => live && setState((s) => ({ data: s.scope === pageId ? s.data : null, error: e.message, scope: pageId })));
    return () => { live = false; };
  }, [pageId, nonce, load]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const take = useCallback((data) => setState((s) => ({ ...s, data, error: '' })), []);
  return { data: state.data, error: state.error, reload, take };
}

export function ConstraintBars({ rows, error, onRetry = null }) {
  if (error) return <PlainNote text={error} prefix="The limits could not load: " icon={<Icon name="info" size={12} />} className="tile-err" data-constraints-error="" onRetry={onRetry} />;
  if (!rows?.length) return null;
  return (
    <section className="card plan-limits" aria-label="Limits the plan uses" data-constraints>
      <header className="card-h"><div><h2>Limits the plan uses</h2><p>The bar is what the plan uses; the line is the limit. Red means the limit is fully used.</p></div></header>
      <ul>
        {rows.map((r) => {
          const limit = numberOf(r.limit);
          const used = numberOf(r.used);
          const share = limit > 0 && Number.isFinite(used) ? Math.max(0, Math.min(used / limit, 1)) : 0;
          const full = r.slack != null && numberOf(r.slack) <= 0;
          return (
            <li key={r.name} data-limit={r.name} className={full ? 'is-full' : ''}>
              <span className="plan-limit-n"><bdi>{r.name}</bdi></span>
              <span className="plan-bar" role="meter" aria-valuemin={0} aria-valuemax={limit || 0} aria-valuenow={Number.isFinite(used) ? used : 0}
                aria-label={`${r.name}: ${formatValue(used)} of ${formatValue(limit)}`}><i style={{ width: `${share * 100}%` }} /></span>
              <span className="num">{formatValue(used)} / {formatValue(limit)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function PlanSection({ app, page, onRun, running }) {
  const plans = usePlans(page.id);
  const [nonce, setNonce] = useState(0);
  const list = useRef(null);
  const versions = plans.data?.versions || [];
  const current = versions.find((v) => v.editable) || null;
  const latest = versions[0] || null;
  const locked = !plans.data ? 'Loading the plan versions…' : plans.data.missing ? plans.data.missing
    : current ? '' : latest ? `${versionName(latest, PLAN_WORDS)} is ${statusWord(latest.status, PLAN_WORDS)}. Start a new draft to change any line.`
      : 'Start a draft to accept or override lines: each override keeps its reason in the draft.';
  const changed = () => { setNonce((n) => n + 1); plans.reload(); };
  const beforeMove = async (action, version) => {
    if (action !== 'approve' || !page.plan) return '';
    const data = list.current;
    const open = data && planDecides(app, page.plan, data) ? (data.rows || []).filter(planOpen) : [];
    if (!open.length) return '';
    try {
      const got = await acceptOpenLines(page, page.plan, open, version.plan_id);
      setNonce((n) => n + 1);
      return `Accepted the suggested value of ${integer(got.done)} line${got.done === 1 ? '' : 's'} you did not override`;
    } catch (e) {
      throw new Error(e.done ? `Accepted ${integer(e.done)} of ${integer(open.length)} lines, then: ${e.message}. The version is not approved yet.` : e.message);
    }
  };
  return (
    <section className="plan-sec" aria-label="Plan" data-plan-section>
      {plans.error && <PlainNote text={plans.error} prefix="The plan versions could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={plans.reload} />}
      {!plans.data && !plans.error && <section className="card"><Skeleton height={60} /></section>}
      {plans.data && (
        <>
          {plans.data.missing && <p className="tile-err" data-plans-missing><Icon name="info" size={14} />{plans.data.missing}</p>}
          {!plans.data.missing && <VersionBar page={page} versions={versions} access={plans.data} words={PLAN_WORDS} onMoved={(got) => { plans.take(got); setNonce((n) => n + 1); }} beforeMove={beforeMove} />}
          {onRun && <div className="plan-tools"><Resolve onRun={onRun} running={running} /></div>}
          <ConstraintBars rows={plans.data.constraints} error={plans.data.constraints_error} onRetry={plans.reload} />
        </>
      )}
      {page.plan && <PlanTable page={page} app={app} filters={{}} ready nonce={nonce} onChanged={changed} planId={current?.plan_id || null} locked={locked}
        onList={(data) => { list.current = data; }} />}
    </section>
  );
}
