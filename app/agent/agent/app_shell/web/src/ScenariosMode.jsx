import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { chooseScenario, evaluateScenario, getSavedScenarios, saveScenario, shareScenario, toneOf } from './api.js';
import { dayLabel, formatValue, integer } from './format.js';
import { Icon } from './icons.jsx';
import { Skeleton, useToast } from './ui.jsx';
import { ModeEmpty } from './ModeParts.jsx';
import { COMPARE_MAX, compareRows, decisionCounts, toggleCompared } from './scenarios.js';

const ScenarioPanel = lazy(() => import('./Scenario.jsx'));
const NAME_CHARS = 80;
const NOTE_CHARS = 300;
const WORK_ORDER = [['scn-levers', 'levers'], ['scn-outcome', 'scenario']];

function useLibrary(pageId) {
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => {
    getSavedScenarios(pageId).then((data) => setState({ data, error: null })).catch((error) => setState((s) => ({ data: s.data, error })));
  }, [pageId]);
  useEffect(() => { load(); }, [load]);
  return { ...state, set: (data) => setState({ data, error: null }), load };
}

const dayOf = (at) => (at ? dayLabel(String(at).slice(0, 10)) : '');

function SaveForm({ page, result, onSaved }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const values = Object.fromEntries(result.levers.map((l) => [l.lever, l.value]));
      onSaved(await saveScenario({ page: page.id, name: name.trim(), note: note.trim(), values }));
      toast(`Saved the scenario ${name.trim()}`);
      setName('');
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="scenario-save" onSubmit={submit} data-scenario-save>
      <label>Name this scenario<input dir="auto" required maxLength={NAME_CHARS} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Why, for whoever reads it<input dir="auto" maxLength={NOTE_CHARS} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button className="btn btn--sm btn--pri" type="submit" disabled={busy || !name.trim()}>Save the scenario</button>
      {error && <p className="tile-err" role="alert"><Icon name="info" size={12} />{error}</p>}
    </form>
  );
}

function Compare({ page, picked }) {
  const outcome = page.scenario.outcome || {};
  const [now, setNow] = useState({});
  const key = picked.map((s) => s.id).join(',');
  useEffect(() => {
    let live = true;
    picked.forEach((s) => {
      evaluateScenario({ page: page.id, values: s.levers })
        .then((r) => { if (live) setNow((x) => ({ ...x, [s.id]: { outcome: r.outcome } })); })
        .catch((e) => { if (live) setNow((x) => ({ ...x, [s.id]: { error: e.message } })); });
    });
    return () => { live = false; };
  }, [page.id, key]);
  const rows = compareRows(page.scenario, picked, now);
  const shown = (row, v) => (v == null ? '' : row.kind === 'share' ? `${Math.round(v * 100)}%` : row.kind === 'outcome'
    ? formatValue(v, outcome.format, outcome.currency) : formatValue(v, row.format, row.currency));
  return (
    <section className="card card--table" aria-label="Compare scenarios" data-scenario-compare>
      <header className="card-h"><div><h2>Compare</h2><p>Each scenario is worked out again on today&apos;s model, next to what it showed when saved.</p></div></header>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th scope="col">Figure</th>{picked.map((s) => <th key={s.id} scope="col">{s.name}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-compare-row={row.id}>
                <th scope="row">{row.label}</th>
                {row.values.map((v, i) => <td key={picked[i].id} className="num">{now[picked[i].id]?.error && row.live ? '' : shown(row, v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {picked.filter((s) => now[s.id]?.error).map((s) => <p key={s.id} className="tile-err" role="alert"><Icon name="info" size={12} />{s.name}: {now[s.id].error}</p>)}
    </section>
  );
}

function ChooseForm({ scenario, onChoose, onCancel }) {
  const [note, setNote] = useState('');
  return (
    <form className="scenario-choose" onSubmit={(e) => { e.preventDefault(); onChoose(note.trim()); }} data-scenario-choose>
      <label>Why this scenario<input dir="auto" autoFocus maxLength={NOTE_CHARS} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button className="btn btn--sm btn--pri" type="submit">Record the choice of {scenario.name}</button>
      <button className="btn btn--sm" type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function Decisions({ decisions }) {
  if (!decisions.length) return <ModeEmpty>No scenario was chosen yet. Choose one from the saved scenarios to record the decision.</ModeEmpty>;
  return (
    <ol className="mode-list mode-log" aria-label="Decision log" data-decision-log>
      {decisions.map((d, i) => (
        <li key={`${d.scenario_id}:${i}`}><Icon name="check" size={13} /><span><b>{d.name}</b>{d.note ? `: ${d.note}` : ''}</span><small>{[d.by, dayOf(d.at)].filter(Boolean).join(' · ')}</small></li>
      ))}
    </ol>
  );
}

export function Work({ app, page, ready }) {
  const library = useLibrary(page.id);
  const [compared, setCompared] = useState([]);
  const [choosing, setChoosing] = useState('');
  const [failure, setFailure] = useState(null);
  const toast = useToast();
  const outcome = page.scenario.outcome || {};
  const saved = library.data?.scenarios || [];
  const picked = saved.filter((s) => compared.includes(s.id));
  const act = async (call, said) => {
    setFailure(null);
    try {
      library.set(await call());
      if (said) toast(said);
    } catch (error) {
      setFailure(error);
    }
  };
  const share = (s) => act(() => shareScenario({ page: page.id, scenario_id: s.id, shared: !s.shared }), s.shared ? `Stopped sharing ${s.name}` : `Shared ${s.name} with everyone in this App`);
  const choose = (s, note) => { setChoosing(''); act(() => chooseScenario({ page: page.id, scenario_id: s.id, note }), `Recorded the choice of ${s.name}`); };
  const fmt = (v) => (v == null ? '' : formatValue(v, outcome.format, outcome.currency));
  const error = library.error || failure;
  return (
    <div className="mode-work mode-scenarios" data-mode-work="scenarios">
      <Suspense fallback={<section className="card"><Skeleton height={180} /></section>}>
        <ScenarioPanel page={page} app={app} ready={ready} order={WORK_ORDER} saver={(result) => <SaveForm page={page} result={result} onSaved={library.set} />} />
      </Suspense>
      {library.data?.note && <p className="note" role="status" data-scenario-note><Icon name="info" size={14} />{library.data.note}</p>}
      {error && <p className={toneOf(error) === 'info' ? 'note' : 'tile-err'} role="alert"><Icon name="info" size={14} />{error.message}</p>}
      <section className="card card--table" aria-label="Saved scenarios" data-saved-scenarios>
        <header className="card-h"><div><h2>Saved scenarios</h2><p>Yours, and the ones others shared. Pick up to {COMPARE_MAX} to compare.</p></div></header>
        {!library.data && !library.error && <div style={{ padding: 16 }}><Skeleton height={60} /></div>}
        {library.data && !saved.length && <ModeEmpty>No saved scenario yet. Move the levers above, name the scenario and save it.</ModeEmpty>}
        {saved.length > 0 && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th scope="col">Compare</th><th scope="col">Scenario</th><th scope="col">Saved by</th><th scope="col" className="num">{outcome.label || 'Outcome'} P50</th><th scope="col">Shared</th><th scope="col" aria-label="Actions" /></tr></thead>
              <tbody>
                {saved.map((s) => (
                  <tr key={s.id} data-scenario={s.id}>
                    <td><input type="checkbox" checked={compared.includes(s.id)} onChange={() => setCompared((c) => toggleCompared(c, s.id))}
                      disabled={!compared.includes(s.id) && compared.length >= COMPARE_MAX} aria-label={`Compare ${s.name}`} /></td>
                    <td><b>{s.name}</b>{s.note && <small className="mode-sub">{s.note}</small>}</td>
                    <td>{s.mine ? 'You' : s.by}<small className="mode-sub">{dayOf(s.at)}</small></td>
                    <td className="num">{fmt(s.outcome?.p50)}</td>
                    <td>{s.shared ? 'Shared' : 'Only you'}</td>
                    <td className="mode-acts">
                      {s.mine && <button type="button" className="btn btn--sm" onClick={() => share(s)} data-share>{s.shared ? 'Stop sharing' : 'Share'}</button>}
                      <button type="button" className="btn btn--sm" onClick={() => setChoosing(choosing === s.id ? '' : s.id)} data-choose>Choose</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {choosing && saved.some((s) => s.id === choosing) && (
          <ChooseForm scenario={saved.find((s) => s.id === choosing)} onChoose={(note) => choose(saved.find((s) => s.id === choosing), note)} onCancel={() => setChoosing('')} />
        )}
      </section>
      {picked.length > 1 && <Compare page={page} picked={picked} />}
      <section className="card" aria-label="Decision log">
        <header className="card-h"><div><h2>Decision log</h2><p>Which scenario was chosen, by whom, and why.</p></div></header>
        <Decisions decisions={library.data?.decisions || []} />
      </section>
    </div>
  );
}

export function Performance({ page }) {
  const library = useLibrary(page.id);
  const counts = decisionCounts(library.data);
  return (
    <section className="card" data-mode-performance="scenarios" aria-label="Decisions taken">
      <header className="card-h"><div><h2>Decisions taken</h2><p>The scenarios saved on {page.title} and the ones chosen.</p></div></header>
      {library.error && <p className="tile-err" role="alert"><Icon name="info" size={14} />{library.error.message}</p>}
      <div className="mode-stats">
        <div className="mode-stat" data-stat="yours"><small>Saved by you</small><b>{integer(counts.mine)}</b></div>
        <div className="mode-stat" data-stat="shared"><small>Shared</small><b>{integer(counts.shared)}</b></div>
        <div className="mode-stat" data-stat="decisions"><small>Decisions</small><b>{integer(counts.decisions)}</b></div>
      </div>
      <Decisions decisions={library.data?.decisions || []} />
    </section>
  );
}
