import { useState } from 'react';
import { BarsCard } from './ChartCard.jsx';
import { RunningNow } from './Freshness.jsx';
import { TopTools } from './TopBar.jsx';
import { Tiles } from './Kpis.jsx';
import FilterBar from './FilterBar.jsx';
import DataTable, { RowGenie } from './DataTable.jsx';
import { fieldsOf, tableContext } from './explain.js';
import { AskGenie } from './AskGenie.jsx';
import { genieOn } from './genieAsk.js';
import { hueVars } from './theme.js';
import { addCounts, compact, compareValues, countOf, integer, largestFirst, money, stakeName, wholeMoney } from './format.js';
import { Icon } from './icons.jsx';
import { NOT_IN_RUN, missingSince, statusClass, statusLabel } from './records.js';
import Fx from './Fx.jsx';
import { moneyOf } from './money.js';
import { FoldScope, WindowChips, useMyView } from './MyView.jsx';
import { pickedWindow } from './prefs.js';
import SettingsPanel, { SettingsButton } from './Settings.jsx';
import {
  DEFAULT_VIEW, NOT_MEASURED, REVIEW, WORK_SHOWN, couldSaveFormula, couldSaveText, doneDay, doneTodayOf, dueText, hubItems, limitText, initialsOf, isMine, isOverdue,
  measured, moneyText, myWork, myWorkText, nothingReason, nothingText, ownerName, pageCurrency, pageKind, plural, reliableText, savedTile, scopeNoteText, scopedPages, tickOf, totals,
  useCaseState, viewIsDefault, viewRows, viewWords, visiblePages, weekBars, windowNoteText,
} from './hub.js';
import { PlainNote, useRetry } from './ui.jsx';

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
      title={`Opens ${page.title} on Inspire's Review page${inside ? '' : ' in a new tab'}`}>
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

function useCaseBars(rows) {
  const by = new Map();
  rows.forEach((r) => {
    const at = by.get(r.page.id) || { key: r.page.id, label: r.page.title, hue: r.page.hue || 'blue', value: 0, currency: r.currency, kind: r.kind, priced: false };
    if (r.money != null) at.priced = true;
    at.value = addCounts([at.value, r.money]);
    by.set(r.page.id, at);
  });
  return [...by.values()].filter((b) => b.priced).sort((a, b) => largestFirst(a.value, b.value)).map((b) => ({
    ...b, text: wholeMoney(b.value, b.currency, b.kind), formula: couldSaveFormula(rows.filter((r) => r.page.id === b.key), ` in ${b.label}`),
  }));
}

function quietUseCases(pages, hub, summaries) {
  return pages.map((page) => {
    const entry = hub?.pages?.[page.id];
    const state = useCaseState(entry, summaries?.[page.id]);
    if (state.unreliable) return { page, text: reliableText(state.reason) };
    return { page, text: ['fix', 'wait'].includes(state.kind) ? nothingText(nothingReason(entry, summaries?.[page.id])) : '' };
  }).filter((q) => q.text);
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

export function YourWork({ items, user, today, loading, failed, owners, partial, cut, done, unwindowed, capped, genie, onRecord, onMore }) {
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
          {onMore && <button type="button" className="btn" onClick={onMore} data-my-work-open><Icon name="right" size={14} />See all your work</button>}
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
        <p className="more">Each use case sends the Overview its biggest open records only. Open a use case and pick My actions to see all of yours.</p>
      )}
    </section>
  );
}

export default function Home({ app, hub, hubError, summaries, view, onView, onOpen, onRecord, onChanges, onMyWork }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const retry = useRetry();
  const pages = visiblePages(app.pages, hub);
  const entries = pages.map((p) => hub?.pages?.[p.id]).filter(Boolean);
  const pairs = pages.filter((p) => hub?.pages?.[p.id]).map((p) => [p.id, hub.pages[p.id]]);
  const items = hubItems(pages, hub, summaries);
  const { owned, fix, shown } = viewRows(items, view, app.user);
  const today = hubToday(hub);
  const loading = !hub && !hubError;
  const priced = entries.some((e) => e.tracked && e.money);
  const tracked = entries.some((e) => e.tracked);
  const mine = fix.filter((i) => isMine(i.owner, app.user)).length;
  const late = owned.filter((i) => isOverdue(i, today)).length;
  const tiles = [
    { id: 'fix', label: 'To fix', value: integer(fix.length), sub: fix.length ? `${mine} of them ${mine === 1 ? 'is' : 'are'} yours` : 'Nothing to fix right now' },
    { id: 'save', label: 'Could save', value: priced ? moneyText(totals(fix)) : NOT_MEASURED, sub: priced ? couldSaveText(fix) : 'No use case puts an amount at stake on its records yet', tone: priced ? 'green' : '',
      formula: priced ? couldSaveFormula(fix) : '' },
    { id: 'late', label: 'Overdue', value: tracked ? integer(late) : NOT_MEASURED, sub: tracked ? 'past their due date' : 'No use case keeps due dates yet', tone: late ? 'red' : '' },
    { id: 'saved', label: 'Saved this quarter', ...savedTile(pairs, pages, summaries, 'saved_q', hub?.quarter) },
  ];
  const weeks = weekCard(pairs, pages, summaries, loading, 'Measured on fixes a later run confirmed, by week');
  const problems = Object.entries(hub?.errors || {}).map(([id, message]) => [app.pages.find((p) => p.id === id)?.title || id, message]);
  const cut = pairs.filter(([, e]) => e.truncated).map(([id, e]) => [app.pages.find((p) => p.id === id)?.title || id, e]);
  const quiet = loading ? [] : quietUseCases(pages, hub, summaries);
  const body = (
    <div className="page hub">
      <TopTools more={[{ label: 'Settings', icon: <Icon name="sliders" size={14} />, run: () => setSettingsOpen((o) => !o), more: 'narrow' }]}>
        <SettingsButton open={settingsOpen} onOpen={setSettingsOpen} owned={false} />
      </TopTools>
      <div className="pg-h">
        <div><h1>Overview</h1><p>Everything across your use cases, yours first, then the biggest saving.</p></div>
      </div>
      {settingsOpen && <SettingsPanel pageId={null} data={null} onClose={() => setSettingsOpen(false)} />}
      <RunningNow pages={app.pages} hub={hub} onSeeChanged={onChanges} />
      {hubError && <PlainNote text={hubError} prefix="The Overview could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={retry} />}
      {problems.map(([title, message]) => <PlainNote key={title} text={message} prefix={`${title} could not load: `} icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={retry} />)}
      <Tiles tiles={tiles} loading={loading} />
      <ScopeNote pages={pages} summaries={summaries} />
      <YourWork {...yourWorkProps(app, hub, hubError, summaries)} onRecord={onRecord} onMore={onMyWork} />
      <FilterBar view={view} onView={onView} />
      <section className="charts">
        <BarsCard id="by_use_case" title="Could save, by use case" action="Click a bar to open the use case" loading={loading} onPick={onOpen}
          bars={priced ? useCaseBars(fix) : []} empty={priced ? 'Nothing to fix for these filters.' : NOT_MEASURED}
          x="Use case" measure="Could save" filters={viewWords(view)} />
        <BarsCard {...weeks} />
      </section>
      <HubExplainNote app={app} />
      <section className="card card--table" aria-label="Things to fix">
        <header className="card-h">
          <div><h2>Things to fix</h2><p>Click one to see why it was flagged and what to do</p></div>
          <AskGenie kind="table" title="Things to fix" context={tableContext('The records to fix across the use cases, for these filters.', shown, (r) => fieldsOf(r, thingColumns(today, false)))} />
        </header>
        {cut.map(([title, e]) => <p key={title} className="more">Showing the {integer(e.items.length)} biggest of {e.total_more ? 'at least ' : ''}{integer(e.total)} in {title}.</p>)}
        {loading ? <p className="more">Loading the things to fix…</p>
          : <Things rows={shown} today={today} user={app.user} onRecord={onRecord} genie={(id) => genieOn(app, id)} filtered={!viewIsDefault(view)} onClear={() => onView(DEFAULT_VIEW)} />}
      </section>
      {quiet.length > 0 && (
        <section className="card card--table" aria-label="Nothing to act on yet">
          <header className="card-h">
            <div><h2>Nothing to act on yet</h2><p>{plural(quiet.length, 'use case')} with nothing to fix, and why</p></div>
            <AskGenie kind="table" title="Nothing to act on yet" context={tableContext('The use cases with nothing to fix, and why.', quiet, (q) => ({ 'Use case': q.page.title, Why: q.text }))} />
          </header>
          <div className="nothing">
            {quiet.map(({ page, text }) => <p key={page.id} data-nothing={page.id}><UseCaseName page={page} /> {text}</p>)}
          </div>
        </section>
      )}
    </div>
  );
  return <FoldScope pageId="overview">{body}</FoldScope>;
}
