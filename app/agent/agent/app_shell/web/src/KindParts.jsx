import { Suspense, lazy, useEffect, useState } from 'react';
import { getRecords } from './api.js';
import { formatValue, integer, numberOf } from './format.js';
import { CLOSED_STATUSES, actError, listAsOf, matchOf, recordKeyOf, statusLabel } from './records.js';
import { useActs } from './Work.jsx';
import { useList } from './Layouts.jsx';
import { Icon } from './icons.jsx';
import { Skeleton } from './ui.jsx';
import { genieOn } from './genieAsk.js';
import { plural } from './hub.js';
import { AskGenie } from './AskGenie.jsx';
import { RowGenie, columnOf } from './DataTable.jsx';
import { fieldsOf, tableContext } from './explain.js';
import './styles/kindparts.css';

export const LIST_ROWS = 60;
export const SEGMENT_CARDS = 12;
export const EFFECT_CARDS = 6;
export const SIGNIFICANT = 0.05;
export const LAZY_CHARTS = ['treemap', 'radar', 'sankey'];
export const SKIP_REASONS = ['Not a fit for them', 'They already have it', 'Bad timing', 'Too many offers already'];
export const TREATMENT_NOTE = 'Treatment';
export const UNTREATED = { column_filters: { action_status: ['New'] } };

const ExtraCharts = lazy(() => import('./echartsKinds.js').then(() => ({ default: ({ children }) => children })));

export function ChartsReady({ page, children }) {
  if (!(page.charts || []).some((c) => LAZY_CHARTS.includes(c.type))) return children;
  return <Suspense fallback={<section className="card"><Skeleton height={240} /></section>}><ExtraCharts>{children}</ExtraCharts></Suspense>;
}

const wordsOf = (text) => String(text ?? '').toLowerCase().match(/[a-z0-9]+/g) || [];

export function suggestedChoice(choices, text) {
  const words = wordsOf(text);
  const at = (c) => [c.id, ...wordsOf(c.label)].map((w) => words.indexOf(w)).filter((i) => i >= 0);
  const found = (choices || []).map((c) => [c, Math.min(...at(c))]).filter(([, i]) => Number.isFinite(i)).sort((a, b) => a[1] - b[1]);
  return found.length ? found[0][0] : null;
}

export function choiceValues(choice, detail = '') {
  const note = detail ? `${choice.label}: ${detail}` : choice.label;
  return choice.status === 'Dismissed' ? { action_status: 'Dismissed', dismiss_reason: note } : { action_status: choice.status, note };
}

export function treatmentValues(treatment) {
  return { action_status: 'In progress', note: `${TREATMENT_NOTE}: ${treatment}` };
}

export function groupByEntity(rows, entity, rank, perEntity) {
  const groups = new Map();
  rows.forEach((row) => {
    const name = String(row[entity] ?? 'Unknown');
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  });
  return [...groups].map(([name, items]) => [name, [...items].sort((a, b) => numberOf(a[rank]) - numberOf(b[rank])).slice(0, perEntity)]);
}

export function effectVerdict(row) {
  const p = row.p_value == null ? null : numberOf(row.p_value);
  const pText = p == null ? 'unknown' : p < 0.001 ? '<0.001' : p.toFixed(3);
  const crosses = row.lower != null && row.upper != null && numberOf(row.lower) <= 0 && numberOf(row.upper) >= 0;
  const below = row.upper != null ? numberOf(row.upper) < 0 : p != null && p < SIGNIFICANT && numberOf(row.effect) < 0;
  if (below) return { state: 'loses', real: false, text: `It loses: the whole range is below no lift, p = ${pText}` };
  if (p != null && p < SIGNIFICANT && !crosses) return { state: 'real', real: true, text: `The lift is real: p = ${pText}` };
  return { state: 'unproven', real: false, text: crosses ? 'Not proven: the range includes no lift at all' : `Not proven: p = ${pText}` };
}

export function pickedIn(filters, filter, value) {
  return !!filter && (filters?.[filter] || []).map(String).includes(String(value));
}

function PickButton({ filter, value, label, filters, onPick, what }) {
  if (!filter || !onPick) return <h3>{label}</h3>;
  const on = pickedIn(filters, filter, value);
  return (
    <h3><button type="button" className="pick-title" aria-pressed={on} data-pick={value} title={on ? `Show every ${what} again` : `Show only ${label}`}
      onClick={() => onPick(filter, value)}>{label}</button></h3>
  );
}

const isClosed = (row) => CLOSED_STATUSES.includes(row._inspire_status || row.action_status);
const decidedText = (row) => row._inspire_closed_note || row._inspire_closed_reason || statusLabel(row._inspire_status || row.action_status);
const columnsOf = (table) => Object.fromEntries((table?.columns || []).map((c) => [c.column, c]));
const shown = (meta, value) => formatValue(value, meta?.format, meta?.currency);
const reasonsOf = (value) => (Array.isArray(value) ? value : value ? String(value).split(/\s*[;|]\s*/) : []).filter(Boolean).slice(0, 3);
const sectionTable = (page, section) => (page.tables || []).find((t) => t.section === section);

const specFields = (row, columns) => fieldsOf(row, (columns || []).map((c) => columnOf(c)));
const nameOf = (page, row) => String(row[page.records?.label] ?? recordKeyOf(row));

function choiceFields(page, row) {
  const meta = page.records || {};
  const reasons = reasonsOf(row[meta.reasons]);
  return { Name: nameOf(page, row), ...specFields(row, meta.columns), ...(row[meta.action] ? { Suggested: row[meta.action] } : {}),
    ...(reasons.length ? { Reasons: reasons.join('; ') } : {}) };
}

function useChoices(page, onChanged) {
  const labelOf = (s) => String(s?.label ?? s?.record_key ?? '');
  const acts = useActs({ pageId: page.id, similarBy: [], onActed: onChanged, labelOf });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const run = async (key, body, values, said) => {
    setBusy(key);
    setError('');
    try {
      await acts.act(body, values, { said });
    } catch (e) {
      setError(actError(e));
    } finally {
      setBusy('');
    }
  };
  const choose = (row, choice, detail = '') => {
    const key = String(recordKeyOf(row));
    return run(key, { record_keys: [key], seen: { [key]: String(row._inspire_version) } }, choiceValues(choice, detail),
      `${choice.label}: ${row[page.records?.label] ?? key}`);
  };
  const takeAll = async (rows, suggest) => {
    const byChoice = new Map();
    rows.forEach((r) => {
      const choice = suggest(r);
      if (!choice || isClosed(r) || !r._inspire_version) return;
      const group = byChoice.get(choice.id) || { choice, picked: [] };
      group.picked.push(r);
      byChoice.set(choice.id, group);
    });
    for (const { choice, picked } of byChoice.values()) {
      const keys = picked.map((r) => String(recordKeyOf(r)));
      await run('all', { record_keys: keys, seen: Object.fromEntries(picked.map((r) => [String(recordKeyOf(r)), String(r._inspire_version)])) },
        choiceValues(choice, 'the ★ suggestion'), `${choice.label} on ${plural(keys.length, '★ suggestion')}`);
    }
  };
  return { choose, takeAll, busy, error, run };
}

function ChoiceRow({ page, app, row, choices, suggested, canAct, busy, onChoose, detail, children }) {
  const [skipping, setSkipping] = useState(null);
  const key = String(recordKeyOf(row));
  const closed = isClosed(row);
  return (
    <li className="choice-row" data-choice-row={key}>
      <div className="choice-main">
        <b>{row[page.records?.label] ?? key}</b>
        {detail}
        {children}
      </div>
      <div className="choice-act" role="group" aria-label={`Decide ${row[page.records?.label] ?? key}`}>
        {closed && <span className="choice-done" data-decided><Icon name="check" size={13} />{decidedText(row)}</span>}
        {!closed && canAct && choices.map((c) => (
          <button key={c.id} type="button" className={`btn btn--sm ${suggested?.id === c.id ? 'btn--pri' : ''}`} disabled={!!busy} data-choice={c.id}
            onClick={() => (c.status === 'Dismissed' ? setSkipping(c) : onChoose(row, c))}>
            {suggested?.id === c.id && <span aria-hidden="true">★ </span>}{c.label}
          </button>
        ))}
        {!closed && !canAct && <span className="muted">Read only{suggested ? `, suggested: ${suggested.label}` : ''}</span>}
        <RowGenie about={genieOn(app, page.id) ? { pageId: page.id, recordKey: key, label: nameOf(page, row) } : null}
          element={{ title: nameOf(page, row), page: page.id, context: { hint: `A line of ${page.records?.title || page.title}.`, fields: choiceFields(page, row) } }} />
      </div>
      {skipping && (
        <div className="choice-why" role="group" aria-label={`Why ${skipping.label.toLowerCase()}`}>
          <span>Why?</span>
          {SKIP_REASONS.map((r) => (
            <button key={r} type="button" className="chip" disabled={!!busy} onClick={() => { setSkipping(null); onChoose(row, skipping, r); }}>{r}</button>
          ))}
          <button type="button" className="link" onClick={() => setSkipping(null)}>Cancel</button>
        </div>
      )}
    </li>
  );
}

function ListShell({ page, title, hint, section, list, empty, actions, error, children }) {
  return (
    <section className="card card--table choices" aria-label={title} data-part={section}>
      <header className="card-h"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div>{actions}
        <AskGenie kind="table" title={title} context={tableContext(hint || '', list.data?.rows || [], (row) => choiceFields(page, row), list.data?.total)} /></header>
      {!list.data && !list.error && <div style={{ padding: 16 }}><Skeleton height={22} /></div>}
      {list.error && <p className="tile-err"><Icon name="info" size={14} />The list could not load: {list.error}</p>}
      {error && <p className="tile-err" role="alert"><Icon name="info" size={14} />{error}</p>}
      {list.data && !(list.data.rows || []).length && <p className="empty">{empty}</p>}
      {children}
    </section>
  );
}

const canDecide = (app, list) => !!(app?.options?.decisions && list?.actions);

function TakeAll({ count, busy, onClick }) {
  if (!count) return null;
  return <button type="button" className="btn btn--sm btn--pri" disabled={!!busy} onClick={onClick} data-take-all>{count === 1 ? 'Take the ★ suggestion' : `Take all ${integer(count)} ★ suggestions`}</button>;
}

function Lookup({ label, value, onLook }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <form className="rec-look" role="search" onSubmit={(e) => { e.preventDefault(); onLook(text.trim()); }}>
      <input type="search" aria-label={`Look up a ${label}`} placeholder={`Look up a ${label}`} value={text} onChange={(e) => setText(e.target.value)} data-rec-search />
      <button type="submit" className="btn btn--sm">Look up</button>
      {value && <button type="button" className="link" onClick={() => onLook('')}>Show all</button>}
    </form>
  );
}

export function RecList({ page, app, filters, ready, nonce, onChanged }) {
  const [search, setSearch] = useState('');
  const list = useList(page.id, filters, ready, nonce, LIST_ROWS, true, search ? { search } : null);
  const choices = page.choices || [];
  const recs = page.recs || {};
  const meta = page.records || {};
  const rows = list.data?.rows || [];
  const can = canDecide(app, list.data);
  const decide = useChoices(page, onChanged);
  const suggest = (row) => suggestedChoice(choices, row[meta.action]);
  const groups = groupByEntity(rows, recs.entity, meta.rank, recs.per_entity || 3);
  const shownRows = groups.flatMap(([, items]) => items);
  const open = shownRows.filter((r) => !isClosed(r) && suggest(r)).length;
  const scoreMeta = (meta.columns || []).find((c) => c.column === recs.score);
  const who = String((meta.columns || []).find((c) => c.column === recs.entity)?.label || 'name').toLowerCase();
  return (
    <ListShell page={page} title={meta.title || 'Recommendations'} hint={meta.hint} section="rec_list" list={list} error={decide.error}
      empty={search ? `Nothing matches ${search}.` : 'No recommendations for these filters.'}
      actions={<><Lookup label={who} value={search} onLook={setSearch} />{can && <TakeAll count={open} busy={decide.busy} onClick={() => decide.takeAll(shownRows, suggest)} />}</>}>
      {groups.map(([entity, items]) => (
        <div key={entity} className="rec-entity" data-rec-entity={entity}>
          <h3>{entity}<AskGenie kind="recommendation" title={entity} context={tableContext(`The top offers for ${entity}, best first.`, items, (row) => choiceFields(page, row))} /></h3>
          <ol className="choice-list">
            {items.map((row) => (
              <ChoiceRow key={recordKeyOf(row)} page={page} app={app} row={row} choices={choices} suggested={suggest(row)} canAct={can} busy={decide.busy}
                onChoose={decide.choose}
                detail={row[recs.score] != null && <span className="choice-score">{scoreMeta?.label || 'Score'} {shown(scoreMeta || { format: 'number' }, row[recs.score])}</span>}>
                {reasonsOf(row[meta.reasons]).length > 0 && <div className="reasons">{reasonsOf(row[meta.reasons]).map((t) => <span key={t} className="chip chip--static">{t}</span>)}</div>}
              </ChoiceRow>
            ))}
          </ol>
        </div>
      ))}
    </ListShell>
  );
}

export function ChoiceList({ page, app, filters, ready, nonce, onChanged }) {
  const list = useList(page.id, filters, ready, nonce, LIST_ROWS);
  const choices = page.choices || [];
  const meta = page.records || {};
  const rows = list.data?.rows || [];
  const can = canDecide(app, list.data);
  const decide = useChoices(page, onChanged);
  const suggest = (row) => suggestedChoice(choices, row[meta.action]);
  const open = rows.filter((r) => !isClosed(r) && suggest(r)).length;
  return (
    <ListShell page={page} title={meta.title || 'Decide each one'} hint={meta.hint} section="keep_scale_stop" list={list} error={decide.error}
      empty="Nothing to decide for these filters." actions={can && <TakeAll count={open} busy={decide.busy} onClick={() => decide.takeAll(rows, suggest)} />}>
      <ol className="choice-list">
        {rows.map((row) => (
          <ChoiceRow key={recordKeyOf(row)} page={page} app={app} row={row} choices={choices} suggested={suggest(row)} canAct={can} busy={decide.busy}
            onChoose={decide.choose}
            detail={<span className="choice-cols">{(meta.columns || []).slice(0, 4).map((c) => <span key={c.column}>{c.label} <b>{shown(c, row[c.column])}</b></span>)}</span>}>
            {row[meta.action] && <p className="choice-why-text">{row[meta.action]}</p>}
          </ChoiceRow>
        ))}
      </ol>
    </ListShell>
  );
}

function useSegmentCounts(page, ids, ready, nonce) {
  const filter = page.segments?.filter;
  const [counts, setCounts] = useState({});
  const key = ids.join('\u0001');
  useEffect(() => {
    if (!ready || !filter || !ids.length) return undefined;
    let live = true;
    getRecords({ page: page.id, filters: {}, offset: 0, limit: 1 })
      .then((probe) => {
        const view = probe.actions ? UNTREATED : {};
        return Promise.all(ids.map((id) => getRecords({ ...view, page: page.id, filters: { [filter]: [id] }, offset: 0, limit: 1 })
          .then((data) => [id, { waiting: data.total ?? 0, asOf: listAsOf(data), actions: !!data.actions, view }])
          .catch((e) => [id, { error: e.message }])));
      })
      .catch((e) => ids.map((id) => [id, { error: e.message }]))
      .then((pairs) => live && setCounts(Object.fromEntries(pairs)));
    return () => { live = false; };
  }, [page.id, filter, key, ready, nonce]);
  return counts;
}

export function SegmentCards({ page, app, ready, nonce, filters, onChanged, onPick, data, records }) {
  const table = sectionTable(page, 'segment_cards');
  const result = table ? data?.tables?.[table.id] : null;
  const failed = table ? data?.errors?.[`table:${table.id}`] : '';
  const rows = (result?.rows || []).slice(0, SEGMENT_CARDS);
  const cols = columnsOf(table);
  const block = page.segments || {};
  const ids = rows.map((r) => String(r.segment_id));
  const counts = useSegmentCounts(page, ids, ready, nonce);
  const decide = useChoices(page, onChanged);
  const [picked, setPicked] = useState({});
  const can = !!app?.options?.decisions;
  const choose = async (row, treatment) => {
    const id = String(row.segment_id);
    const c = counts[id] || {};
    if (!c.asOf || !c.waiting) return;
    setPicked((all) => ({ ...all, [id]: treatment }));
    await decide.run(`seg:${id}`, { match: matchOf({ ...c.view, filters: { [block.filter]: [id] } }, c.asOf) }, treatmentValues(treatment),
      `${treatment} chosen for ${integer(c.waiting)} members of ${row.label}`);
  };
  const suggestedOf = (row) => (block.suggest && (block.treatments || []).find((t) => t.toLowerCase() === String(row[block.suggest] ?? '').toLowerCase())) || null;
  const waiting = rows.filter((r) => suggestedOf(r) && (counts[String(r.segment_id)]?.waiting || 0) > 0 && !picked[String(r.segment_id)]);
  return (
    <>
      <section className="card segments" aria-label={table?.title || 'Segments'} data-part="segment_cards">
        <header className="card-h"><div><h2>{table?.title || 'Segments'}</h2>
          <p>{table?.hint || 'Choose a treatment for each segment once: every member of the segment gets it.'}</p></div>
          {can && waiting.length > 0 && <TakeAll count={waiting.length} busy={decide.busy} onClick={async () => { for (const r of waiting) await choose(r, suggestedOf(r)); }} />}
          <AskGenie kind="table" title={table?.title || 'Segments'} context={tableContext(table?.hint || '', rows, (row) => specFields(row, table?.columns))} />
        </header>
        {!result && !failed && <div style={{ padding: 16 }}><Skeleton height={90} /></div>}
        {failed && <p className="tile-err"><Icon name="info" size={14} />The segments could not load: {failed}</p>}
        {decide.error && <p className="tile-err" role="alert"><Icon name="info" size={14} />{decide.error}</p>}
        {result && !rows.length && <p className="empty">No segments for these filters.</p>}
        <div className="seg-cards">
          {rows.map((row) => {
            const id = String(row.segment_id);
            const c = counts[id] || {};
            const star = suggestedOf(row);
            const chosen = picked[id];
            const done = c.actions && c.waiting === 0;
            return (
              <article key={id} className={`seg-card${pickedIn(filters, block.filter, id) ? ' is-picked' : ''}`} data-card={`segment:${id}`} data-segment={id}>
                <header><PickButton filter={block.filter} value={id} label={row.label} filters={filters} onPick={onPick} what="segment" /><AskGenie kind="segment" title={row.label} context={{ hint: row.profile != null ? String(row.profile) : '',
                  fields: { ...specFields(row, table?.columns), ...(c.waiting != null ? { 'Members waiting': c.waiting } : {}), ...(star ? { Suggested: star } : {}) } }} /></header>
                <dl>
                  <div><dt>{cols.size?.label || 'Size'}</dt><dd>{shown(cols.size || { format: 'integer' }, row.size)}</dd></div>
                  <div><dt>{cols.value?.label || 'Value'}</dt><dd>{shown(cols.value || { format: 'number' }, row.value)}</dd></div>
                </dl>
                {row.profile != null && <p className="seg-profile">{String(row.profile).slice(0, 160)}</p>}
                <p className="seg-wait" data-seg-open>{c.error ? c.error : c.waiting == null ? 'Counting members…'
                  : !c.actions ? `${plural(c.waiting, 'member')} in the decision list` : done ? 'Every member has a treatment or a decision'
                  : `${integer(c.waiting)} of ${shown(cols.size || { format: 'integer' }, row.size)} members still need a treatment`}</p>
                {chosen && <p className="choice-done" data-decided><Icon name="check" size={13} />{TREATMENT_NOTE}: {chosen}</p>}
                {can && c.actions && (
                  <div className="seg-act" role="group" aria-label={`Treatment for ${row.label}`}>
                    {(block.treatments || []).map((t) => (
                      <button key={t} type="button" className={`btn btn--sm ${star === t ? 'btn--pri' : ''}`} disabled={!!decide.busy || !c.asOf || !c.waiting}
                        data-treatment={t} onClick={() => choose(row, t)}>{star === t && <span aria-hidden="true">★ </span>}{t}</button>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
      {records}
    </>
  );
}

export function EffectCard({ page, data, filters, onPick }) {
  const table = sectionTable(page, 'effect_card');
  const result = table ? data?.tables?.[table.id] : null;
  const failed = table ? data?.errors?.[`table:${table.id}`] : '';
  const rows = (result?.rows || []).slice(0, EFFECT_CARDS);
  const cols = columnsOf(table);
  return (
    <section className="card effects" aria-label={table?.title || 'Effect'} data-part="effect_card">
      <header className="card-h"><div><h2>{table?.title || 'Effect'}</h2>{table?.hint && <p>{table.hint}</p>}
        {table?.so_what && <p className="so-what" data-so-what><b>So what:</b> {table.so_what}</p>}</div>
        <AskGenie kind="table" title={table?.title || 'Effect'} context={tableContext(table?.hint || '', rows, (row) => specFields(row, table?.columns))} /></header>
      {!result && !failed && <div style={{ padding: 16 }}><Skeleton height={90} /></div>}
      {failed && <p className="tile-err"><Icon name="info" size={14} />The effect could not load: {failed}</p>}
      {result && !rows.length && <p className="empty">No measured effect for these filters.</p>}
      <div className="effect-cards">
        {rows.map((row, i) => {
          const verdict = effectVerdict(row);
          return (
            <article key={`${row.intervention}:${i}`} className={`effect is-${verdict.state}${pickedIn(filters, cols.intervention?.filter, row.intervention) ? ' is-picked' : ''}`}
              data-card={`effect:${row.intervention}`}>
              <header><PickButton filter={cols.intervention?.filter} value={row.intervention} label={row.intervention} filters={filters} onPick={onPick} what="intervention" /><AskGenie kind="effect" title={String(row.intervention)} context={{ hint: verdict.text, fields: specFields(row, table?.columns) }} /></header>
              <p className="effect-lift"><b>{shown(cols.effect, row.effect)}</b> <span>{cols.effect?.label || 'Lift'}</span></p>
              <p className="effect-range">Range {shown(cols.lower || cols.effect, row.lower)} to {shown(cols.upper || cols.effect, row.upper)}</p>
              <p className="effect-verdict" data-verdict={verdict.state}>{verdict.text}</p>
              <dl>
                <div><dt>{cols.roi?.label || 'ROI'}</dt><dd>{shown(cols.roi || { format: 'percent' }, row.roi)}</dd></div>
                {cols.incremental_value && <div><dt>{cols.incremental_value.label}</dt><dd>{shown(cols.incremental_value, row.incremental_value)}</dd></div>}
                {cols.cost && <div><dt>{cols.cost.label}</dt><dd>{shown(cols.cost, row.cost)}</dd></div>}
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export const SECTION_PARTS = { segment_cards: SegmentCards, rec_list: RecList, keep_scale_stop: ChoiceList, effect_card: EffectCard };
