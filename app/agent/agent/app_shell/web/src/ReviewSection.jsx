import { useState } from 'react';
import { getForecastReview, overrideForecast } from './api.js';
import { usePlans } from './PlanSection.jsx';
import { CYCLE_WORDS, REASON_MAX, VersionBar, statusWord, versionName } from './PlanVersions.jsx';
import { Icon } from './icons.jsx';
import { PlainNote, SaidNote, Skeleton, useToast } from './ui.jsx';
import { formatValue, integer } from './format.js';
import './styles/plan.css';
import { SectionHelp } from './SectionHelp.jsx';

const mase = (v) => (v == null ? '' : formatValue(v, 'number', 'USD', 2));

function SeriesRow({ page, row, cycle, can, look, onSaved }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const fmt = (v) => formatValue(v, look[0], look[1]);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const got = await overrideForecast({ page: page.id, plan_id: cycle.plan_id, series_id: row.series_id, period: row.next_period, value: Number(value), reason: reason.trim() });
      toast(`Saved your forecast for ${row.series_id} and its reason`);
      setOpen(false);
      onSaved(got, row.series_id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const cols = can ? 7 : 6;
  return (
    <>
      <tr data-series={row.series_id} data-at-risk={row.at_risk ? 'yes' : 'no'}>
        <th scope="row"><bdi>{row.series_id}</bdi>{row.at_risk && <span className="plan-risk" title="Its error is above a simple naive forecast">At risk</span>}</th>
        <td className="num">{mase(row.mase)}</td>
        <td>{row.next_period || ''}</td>
        <td className="num plan-rec">{row.forecast == null ? '' : fmt(row.forecast)}</td>
        <td className="num">{row.lower == null || row.upper == null ? '' : `${fmt(row.lower)} to ${fmt(row.upper)}`}</td>
        <td dir="auto" data-override>{row.override ? <><b>{fmt(row.override.value)}</b> <small className="muted">{row.override.reason}</small></> : ''}</td>
        {can && (
          <td className="plan-act">
            <button type="button" className="btn btn--sm" disabled={busy || !row.next_period || row.forecast == null} aria-expanded={open} onClick={() => setOpen(!open)} data-override-open>
              {row.override ? 'Change override' : 'Override'}
            </button>
          </td>
        )}
      </tr>
      {open && (
        <tr className="plan-form"><td colSpan={cols}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} data-override-form>
            <label>Your forecast for {row.next_period}<input type="number" step="any" required value={value} onChange={(e) => setValue(e.target.value)} data-override-value /></label>
            <label className="grow">Why you override the model<input dir="auto" required maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} data-override-reason /></label>
            <button className="btn btn--sm btn--pri" type="submit" disabled={busy || value === '' || !reason.trim()} data-override-save>Save override</button>
          </form>
        </td></tr>
      )}
      {error && <tr><td colSpan={cols}><PlainNote text={error} icon={<Icon name="info" size={12} />} className="tile-err" role="alert" /></td></tr>}
    </>
  );
}

const seriesLook = (page) => {
  const plan = page.plan || {};
  return [plan.format || 'number', plan.currency || 'USD'];
};

export default function ReviewSection({ page }) {
  const review = usePlans(page.id, getForecastReview);
  const [all, setAll] = useState(false);
  const [said, setSaid] = useState('');
  const d = review.data;
  const cycle = d?.cycle || null;
  const versions = cycle ? [cycle] : [];
  const can = !!(d?.can_decide && cycle?.editable && !d?.missing);
  const rows = (d?.series || []).filter((s) => all || s.at_risk);
  const lockedText = !d ? '' : d.missing ? '' : !cycle ? 'Start a review cycle to override a series: each override keeps its reason.'
    : !cycle.editable ? `${versionName(cycle, CYCLE_WORDS)} is ${statusWord(cycle.status, CYCLE_WORDS).toLowerCase()}. Start the next cycle to override again.` : '';
  return (
    <section className="plan-sec" aria-label="Review" data-review-section>
      {review.error && <PlainNote text={review.error} prefix="The forecast review could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={review.reload} />}
      {!d && !review.error && <section className="card"><Skeleton height={60} /></section>}
      {d?.missing && <p className="tile-err" data-plans-missing><Icon name="info" size={14} />{d.missing}</p>}
      {d && !d.missing && <VersionBar page={page} versions={versions} access={d} words={CYCLE_WORDS} onMoved={() => review.reload()} />}
      {d && (
        <section className="card card--table" aria-label="Series to review" data-series-queue>
          <header className="card-h"><div><h2>Series to review</h2>
            <p>{`${integer(d.at_risk)} of ${integer(d.series.length)} series forecast worse than a simple naive guess. Check them first, and override where you know better.`}</p>
            {lockedText && <p className="muted" data-plan-locked>{lockedText}</p>}
          </div>
          <div className="wchips" role="group" aria-label="Which series">
            <button type="button" className={`pick-i ${!all ? 'is-on' : ''}`} aria-pressed={!all} onClick={() => setAll(false)} data-show="risk">At risk</button>
            <button type="button" className={`pick-i ${all ? 'is-on' : ''}`} aria-pressed={all} onClick={() => setAll(true)} data-show="all">All series</button>
          </div><SectionHelp title={'Series to review'} steps={[{ title: 'Series to review', text: "The series the forecast gets worse than a simple guess, worst first. Check them first, and override where you know better." }]} /></header>
          <SaidNote text={said} at="override" />
          {rows.length ? (
            <div className="tw"><table className="plan-t">
              <thead><tr><th scope="col">Series</th><th scope="col">Error vs naive</th><th scope="col">Next period</th><th scope="col">Forecast</th><th scope="col">Range</th>
                <th scope="col">Your override</th>{can && <th scope="col"><span className="sr">Override</span></th>}</tr></thead>
              <tbody>{rows.map((r) => <SeriesRow key={r.series_id} page={page} row={r} cycle={cycle} can={can} look={seriesLook(page)}
                onSaved={(got, id) => { review.take(got); setSaid(`Saved your override for ${id}`); }} />)}</tbody>
            </table></div>
          ) : <p className="empty" data-no-series>{all ? 'The forecast has no series yet.' : 'No series forecast worse than a naive guess right now.'}</p>}
        </section>
      )}
    </section>
  );
}
