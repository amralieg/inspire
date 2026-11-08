import { useState } from 'react';
import DataTable, { RowGenie } from './DataTable.jsx';
import { fieldsOf, tableContext } from './explain.js';
import { AskGenie } from './AskGenie.jsx';
import { genieOn } from './genieAsk.js';
import { hueVars } from './theme.js';
import { compact, compareValues, countOf, integer, money, stakeName, wholeMoney } from './format.js';
import { Icon } from './icons.jsx';
import { NOT_IN_RUN, missingSince, statusClass, statusLabel } from './records.js';
import Fx from './Fx.jsx';
import { moneyOf } from './money.js';
import { WindowChips, useMyView } from './MyView.jsx';
import { pickedWindow } from './prefs.js';
import { NOT_MEASURED, REVIEW, WORK_SHOWN, doneDay, doneTodayOf, dueText, hubItems, limitText, initialsOf, isMine, measured, myWork, myWorkText, ownerName, pageCurrency, pageKind, scopeNoteText, scopedPages, tickOf, visiblePages, weekBars, windowNoteText } from './hub.js';

export const REVIEW_LABEL = 'Open in Inspire Review';

const reviewable = (page) => !!(page.review && page.use_case_id);

export function reviewItem(page, app) {
  if (!reviewable(page)) return null;
  const inside = app.inside === true;
  return { label: REVIEW_LABEL, icon: <Icon name="external" size={14} />, run: () => window.open(page.review, inside ? '_top' : '_blank', inside ? undefined : 'noopener,noreferrer') };
}

export function ReviewLink({ page, app }) {
  if (!reviewable(page)) return null;
  const inside = app.inside === true;
  return (
    <a className="btn review top-ic" data-more="tight" href={page.review} target={inside ? '_top' : '_blank'} rel={inside ? undefined : 'noopener noreferrer'} data-review={page.id}
      aria-label={REVIEW_LABEL}
      title={`Opens ${page.use_case_id} on Inspire's Review page${inside ? '' : ' in a new tab'}`}>
      <Icon name="external" size={15} /><span>{REVIEW_LABEL}</span>
    </a>
  );
}

export function UseCaseName({ page, wrap = false, children }) {
  return <span className={`ucn ${wrap ? 'wr' : ''}`} style={hueVars(page.hue || 'blue')}><i />{page.title}{children}</span>;
}

export function Owner({ owner }) {
  const name = ownerName(owner);
  return name
    ? <span className="owner" title={owner}><i aria-hidden="true">{initialsOf(name)}</i>{name}</span>
    : <span className="owner is-none">Nobody yet</span>;
}

export function hubToday(hub) {
  return hub?.today || new Date().toISOString().slice(0, 10);
}

export function ScopeNote({ pages, summaries }) {
  const text = scopeNoteText(scopedPages(pages, summaries));
  return text ? <p className="note" data-scope><Icon name="info" size={14} />{text}</p> : null;
}

export function HubExplainNote({ app }) {
  return app.pages.length > 1 && app.genie.enabled ? <p className="note"><Icon name="info" size={14} />{app.genie.note}</p> : null;
}

export function hubExplain(app, onExplain, page) {
  return genieOn(app, page) && onExplain ? (kind, title, context) => onExplain({ kind, page, title, context }) : null;
}

export function weekCard(pairs, pages, summaries, loading, hint) {
  const counted = pairs.filter(([, e]) => measured([e]).length);
  const weeks = weekBars(counted.map(([, e]) => e));
  const stakes = counted.map(([id]) => [pageCurrency(pages.find((p) => p.id === id), summaries?.[id]), pageKind(pages.find((p) => p.id === id), summaries?.[id])]);
  const currencies = new Set(stakes.map((stake) => JSON.stringify(stake)));
  const [currency, kind] = stakes[0] || ['', ''];
  return {
    id: 'saved_weeks', title: 'Saved per week', hint, vertical: true, loading, hue: 'green', x: 'Week', measure: 'Saved',
    bars: currencies.size > 1 ? [] : (weeks || []).map((w, i, all) => ({
      ...w, text: currency ? money(w.value, currency, 0, kind) : compact(w.value, 0), tick: tickOf(w.label, i, all.length),
      formula: `${stakeName(currency, kind)} when fixed, less what a later run still finds, on the fixes a later run confirmed in the week of ${w.label}, added up = ${wholeMoney(w.value, currency, kind)}`,
    })),
    empty: currencies.size > 1 ? 'The use cases save in different currencies or units, so the weeks are not added up.' : NOT_MEASURED,
  };
}

function ThingMoney({ r }) {
  const shown = moneyOf(r.model, r, r.currency, r.kind);
  return <Fx formula={shown.formula}>{wholeMoney(r.money, r.currency, r.kind)}</Fx>;
}

const thingName = (r) => String(r.label || r.key);

function thingColumns(today, mine, genie) {
  const shown = [
    {
      key: 'label', label: 'What', sortValue: thingName,
      render: (r) => <div className="it"><b>{r.label || r.key}{r.tier === REVIEW && <span className="look">worth a look</span>}{missingSince(r) && <span className="chg-b chg-b--missing">{NOT_IN_RUN}</span>}</b>{r.why && <small>{r.why}</small>}</div>,
    },
    { key: 'use_case', label: 'Use case', className: 'c-uc', sortValue: (r) => r.page.title, render: (r) => <UseCaseName page={r.page} wrap /> },
    mine
      ? { key: 'status', label: 'Status', className: 'nw c-status', sortValue: (r) => statusLabel(r.status || 'New'), render: (r) => <span className={statusClass(r.status || 'New')}>{statusLabel(r.status || 'New')}</span> }
      : { key: 'owner', label: 'Owner', className: 'nw c-owner', sortValue: (r) => ownerName(r.owner) || 'Nobody yet', render: (r) => <Owner owner={r.owner} /> },
    {
      key: 'due', label: 'Due', date: true, className: 'nw c-due', cellClass: (r) => { const due = dueText(r.due, today); return [due.late ? 'late' : '', due.none ? 'faint' : ''].filter(Boolean).join(' '); },
      render: (r) => dueText(r.due, today).text,
    },
    { key: 'money', label: 'Could save', num: true, className: 'money c-money', render: (r) => (r.money == null ? NOT_MEASURED : <ThingMoney r={r} />) },
  ];
  return [...shown, {
    key: '_ask', label: 'Ask Genie', hideLabel: true, fixed: true, className: 'c-ask',
    render: (r) => <RowGenie about={genie?.(r.page.id) ? { pageId: r.page.id, recordKey: String(r.key), label: thingName(r) } : null}
      element={{ title: thingName(r), page: r.page.id, context: { hint: `A record ${mine ? 'on your work list' : 'to fix'} from ${r.page.title}.`, fields: fieldsOf(r, shown) } }} />,
  }];
}

function ThingRows({ rows, today, user, onRecord, genie, mine = false }) {
  const open = (r) => onRecord(r.page.id, r.key);
  return (
    <DataTable label={mine ? 'Your work' : 'Things to fix'} tableClass={`tbl--work ${mine ? 'tbl--mine' : 'tbl--things'}`} columns={thingColumns(today, mine, genie)} rows={rows}
      rowKey={(r) => `${r.page.id}:${r.key}`} paged={false} grid={mine ? 'overview:mine' : 'overview:things'} onRow={open}
      rowClass={(r) => [isMine(r.owner, user) ? 'is-mine' : '', dueText(r.due, today).late ? 'is-late' : ''].filter(Boolean).join(' ')}
      rowProps={(r) => ({ tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(r); }, 'aria-label': `Open ${thingName(r)} in ${r.page.title}` })} />
  );
}

function Things({ rows, filtered, onClear, ...rest }) {
  if (!rows.length) {
    return (
      <div className="nomatch">
        {filtered ? <>Nothing matches these filters. <button className="lnk" onClick={onClear}>Clear filters</button></> : 'Nothing to fix right now.'}
      </div>
    );
  }
  return <ThingRows rows={rows} {...rest} />;
}

export const NO_OWNERS = 'Nobody owns a record yet, so nothing is assigned to you. Open a use case list and press Assign them to me to take the records you will work on.';

function workEmpty({ failed, signedIn, owners, partial }) {
  if (failed) return 'Your work could not load.';
  if (!signedIn) return 'Sign in to see what is assigned to you.';
  if (!owners) return NO_OWNERS;
  return partial ? 'Nothing is assigned to you in the use cases that loaded.' : 'Nothing is assigned to you right now.';
}

export function yourWorkProps(app, hub, hubError, summaries) {
  const pages = visiblePages(app.pages, hub);
  const pairs = pages.filter((p) => hub?.pages?.[p.id]).map((p) => [p.id, hub.pages[p.id]]);
  const title = (id) => app.pages.find((p) => p.id === id)?.title || id;
  const kept = hub?.window?.limit ? pairs.filter(([, e]) => !e.window_note && compareValues(countOf(e.total), e.items?.length || 0) > 0) : [];
  const keptIds = new Set(kept.map(([id]) => id));
  return {
    items: hubItems(pages, hub, summaries), user: app.user, today: hubToday(hub), loading: !hub && !hubError, failed: !hub && !!hubError,
    owners: pairs.some(([, e]) => e.tracked), partial: Object.keys(hub?.errors || {}).length > 0,
    cut: pairs.some(([id, e]) => e.truncated && !keptIds.has(id)), done: doneTodayOf(pairs.map(([, e]) => e), hub?.time_zone),
    unwindowed: pairs.filter(([, e]) => e.window_note).map(([id]) => title(id)), capped: limitText(kept.map(([id, e]) => [title(id), e.items.length, e.total])),
    genie: (id) => genieOn(app, id),
  };
}

export function YourWork({ items, user, today, loading, failed, owners, partial, cut, done, unwindowed, capped, genie, onRecord }) {
  const [all, setAll] = useState(false);
  const { prefs } = useMyView();
  const work = myWork(items, user, today);
  const signedIn = !!(user?.email || user?.name);
  return (
    <section className="card card--table" aria-label="Your work">
      <header className="card-h">
        <div><h2>Your work</h2><p data-today>{work.rows.length ? myWorkText(work, done) : 'Things assigned to you, overdue and due today first'}</p></div>
        <div className="tbar">
          {owners && signedIn && <WindowChips />}
          <AskGenie kind="table" title="Your work" context={tableContext('The records assigned to you, overdue and due today first.', work.rows, (r) => fieldsOf(r, thingColumns(today, true)))} />
        </div>
      </header>
      {loading && <p className="more">Loading your work…</p>}
      {!loading && !work.rows.length && (
        <div className="nomatch">{workEmpty({ failed, signedIn, owners, partial })}{done?.n ? ` You marked ${integer(done.n)} done ${doneDay(done)}.` : ''}</div>
      )}
      {!loading && work.rows.length > 0 && (
        <ThingRows rows={all ? work.rows : work.rows.slice(0, WORK_SHOWN)} today={today} user={user} onRecord={onRecord} genie={genie} mine />
      )}
      {!loading && work.rows.length > WORK_SHOWN && (
        <p className="more"><button className="lnk" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${integer(work.rows.length)}`}</button></p>
      )}
      {!loading && capped && <p className="more" data-limit>{capped}</p>}
      {!loading && owners && unwindowed?.length > 0 && pickedWindow(prefs) && <p className="more" data-window-note>{windowNoteText(unwindowed)}</p>}
      {!loading && cut && owners && (
        <p className="more">Each use case sends My work its biggest open records only. Open the use case, go to Work and pick Mine to see all of yours.</p>
      )}
    </section>
  );
}
