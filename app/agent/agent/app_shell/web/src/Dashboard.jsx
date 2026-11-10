import { useState } from 'react';
import { ColumnFilterStatus, withColumnFilters } from './ColumnFilters.jsx';
import { addCounts, cap, integer, largestFirst, savedVerb, wholeMoney } from './format.js';
import { ITEM_KINDS, fieldsOf, rowTitle, tableContext } from './explain.js';
import { Block, Placed } from './Blocks.jsx';
import { slotsOf } from './blocks.js';
import { GenieMark, Icon } from './icons.jsx';
import FilterBar from './FilterBar.jsx';
import { Tiles } from './Kpis.jsx';
import { BarsCard } from './ChartCard.jsx';
import DataTable, { RowDetails, columnOf } from './DataTable.jsx';
import { PlainNote, Skeleton, SoWhat, useRetry } from './ui.jsx';
import MoneyCard from './Money.jsx';
import { LayoutSections, TodoNow } from './Layouts.jsx';
import { backendNotes } from './freshness.js';
import { AskGenie } from './AskGenie.jsx';
import { SectionHelp } from './SectionHelp.jsx';
import { helpLine } from './help.js';
import { CardFailure, PageFailure, useShared } from './PageFailure.jsx';
import {
  FIX_TIERS, NOT_MEASURED, capacityText, couldSaveFormula, couldSaveText, hubView, isMine, moneyText, nothingReason, nothingText, pageCurrency, pageKind, pickReason, plural,
  reasonFilters, reliableText, savedTile, shortDay, shownTiers, totals, useCaseState, viewWords,
} from './hub.js';

export function TableCard({ table, result, error, loading, onFilter, pageId, filters, values, onColumn, onClear, sort, onSort }) {
  const columns = withColumnFilters(table.columns.map((c) => columnOf(c, onFilter)), filters, values, onColumn, pageId, table.id);
  const cut = !!result?.truncated;
  const retry = useRetry();
  const served = cut || !!sort ? { sort: sort ? { key: sort.key, dir: sort.dir === 'desc' ? -1 : 1 } : null, onSort: (s) => onSort({ key: s.key, dir: s.dir > 0 ? 'asc' : 'desc' }) } : {};
  const [opened, setOpened] = useState(null);
  const shared = useShared(error);
  const element = (row) => ({ kind: ITEM_KINDS[table.section], title: rowTitle(row, columns), context: { hint: `A row of the table "${table.title}".`, fields: fieldsOf(row, columns) } });
  return (
    <section className="card card--table" aria-label={table.title}>
      <header className="card-h">
        <div><h2>{table.title}</h2>{table.hint && <p>{table.hint}</p>}<SoWhat text={table.so_what} /></div>
        {filters?.length > 0 && <div className="tbar"><ColumnFilterStatus filters={filters} values={values} onClear={onClear} /></div>}
        <SectionHelp title={table.title} steps={[{ title: table.title, text: helpLine(table.hint, table.so_what && `So what: ${table.so_what}`, 'Click a row to open its details beside the table.') }]} />
        {!shared && <AskGenie kind="table" title={table.title} context={tableContext(table.hint || '', result?.rows || [], (row) => fieldsOf(row, columns))} />}
      </header>
      {loading && <div style={{ padding: 16, display: 'grid', gap: 10 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={22} />)}</div>}
      <CardFailure text={error} prefix="This table could not load: " onRetry={retry} />
      {!loading && !error && <DataTable label={table.title} columns={columns} rows={result?.rows || []} filtering="server" grid={`page:${pageId}:table:${table.id}`} {...served}
        askRow={element} onRow={(row) => setOpened((o) => (o === row ? null : row))}
        detail={(row) => (row === opened ? <RowDetails title={rowTitle(row, columns)} fields={fieldsOf(row, columns)} element={element(row)} onClose={() => setOpened(null)} /> : null)} />}
      {!loading && !error && cut && <p className="more" data-cut>Showing the first {integer(result.rows.length)} rows. Sorting and the column filters use every row.</p>}
    </section>
  );
}

function hubTiles(page, entry, summary, fix, user, stale, onFix) {
  const done = entry?.done || {};
  const mine = fix.filter((i) => isMine(i.owner, user)).length;
  const fixing = onFix && fix.length > 0;
  const tiles = [
    { id: 'fix', label: 'To fix', value: integer(fix.length), sub: fix.length ? `${mine} of them ${mine === 1 ? 'is' : 'are'} yours` : 'Nothing to fix right now',
      action: fixing ? { label: 'Fix this', run: () => onFix({ tiers: FIX_TIERS }) } : null },
    { id: 'save', label: 'Could save', value: entry?.money ? moneyText(totals(fix)) : NOT_MEASURED,
      sub: entry?.money ? couldSaveText(fix) : 'This use case puts no amount at stake on its records yet', tone: entry?.money ? 'green' : '',
      formula: entry?.money ? couldSaveFormula(fix) : '', action: fixing && entry?.money ? { label: 'Fix this', run: () => onFix({ tiers: FIX_TIERS, money: true }) } : null },
    { id: 'fixed', label: 'Fixed so far', value: entry?.tracked ? integer(done.fixed) : NOT_MEASURED,
      sub: !entry?.tracked ? 'This use case keeps no fixes yet' : done.first_fixed ? `since ${shortDay(done.first_fixed)}` : 'Nobody marked one done yet' },
    { id: 'saved', label: `${cap(savedVerb(pageCurrency(page, summary), pageKind(page, summary)))} so far`,
      ...savedTile(entry ? [[page.id, entry]] : [], [page], { [page.id]: summary }, 'saved', null) },
  ];
  return stale ? tiles.slice(2) : tiles;
}

function reasonBars(rows, page) {
  const by = new Map();
  rows.forEach((r) => {
    const at = by.get(r.reason) || { key: r.reason, label: r.reason, hue: page.hue || 'blue', value: 0, n: 0, currency: r.currency, kind: r.kind };
    at.value = addCounts([at.value, r.money]);
    at.n += 1;
    by.set(r.reason, at);
  });
  return [...by.values()].sort((a, b) => largestFirst(a.value, b.value)).map((b) => ({
    ...b, text: `${wholeMoney(b.value, b.currency, b.kind)} on ${plural(b.n, 'record')}`, formula: couldSaveFormula(rows.filter((r) => r.reason === b.key), ` the AI groups as ${b.label}`),
  }));
}

function NothingToFix({ reason, latest, onRuns }) {
  return (
    <section className="card nothing-fix" role="status" data-nothing-fix="">
      <h2>Nothing to fix</h2>
      {reason && <p data-nothing="">{nothingText(reason)}</p>}
      <p className="nothing-run" data-latest-run="">{latest}</p>
      {onRuns && <button type="button" className="lnk" onClick={onRuns}>See the runs</button>}
    </section>
  );
}

export function HubTop({ entry, live, summary, latest, onRuns, fixing, onRetry = null, onRetrySummary = null }) {
  const status = useCaseState(entry || live.data, summary);
  const run = summary?.run;
  if (status.kind === 'wait') {
    const said = status.unreliable ? <b>{reliableText(status.reason)}</b> : <><b>{status.title}</b>{nothingText(status.reason)}</>;
    return <div className="uc-status is-wait" role="status" data-unreliable={status.unreliable ? '' : undefined}>{said}{status.next ? ` It is checked again on ${shortDay(status.next)}.` : ''}</div>;
  }
  const nothing = nothingReason(entry || live.data, summary);
  const capacity = status.kind !== 'stale' ? capacityText(run) : '';
  return (
    <>
      {status.kind === 'stale' && <div className="uc-status is-bad" role="status"><b>{status.title}</b>{status.reason}</div>}
      {status.kind !== 'stale' && run?.summary && (
        <div className="sum"><span className="ai-badge"><GenieMark size={12} />AI summary</span><p>{run.summary}</p>
          <AskGenie kind="text" title="AI summary" context={{ hint: run.summary }} /></div>
      )}
      {status.kind !== 'stale' && summary && !summary.error && !run?.summary && (
        <p className="note no-sum" role="status"><Icon name="info" size={14} />{run ? 'The last run wrote no AI summary.' : 'No run has written an AI summary yet.'}</p>
      )}
      {fixing && status.kind !== 'stale' && nothing && <NothingToFix reason={nothing} latest={latest} onRuns={onRuns} />}
      {capacity && <p className="note" role="status" data-capacity=""><Icon name="info" size={14} />{capacity}</p>}
      {summary?.error && <PlainNote text={summary.error} prefix="The AI summary could not load: " icon={<Icon name="info" size={14} />} className="note" role="status" onRetry={onRetrySummary} />}
      {live.error && <PlainNote text={live.error} prefix="The things to fix could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={onRetry} />}
    </>
  );
}

function Drivers({ drivers, cards }) {
  if (!drivers || !cards.length) return null;
  return (
    <section className="drivers" aria-label={drivers.title} data-drivers>
      <header className="drivers-h"><h2>{drivers.title}</h2><p>{drivers.guide}</p></header>
      <div className="charts">{cards}</div>
    </section>
  );
}

export function hubChartsOnTop(entry, live, summary) {
  return !['wait', 'stale'].includes(useCaseState(entry || live.data, summary).kind);
}

export const NO_SLOTS = { before: [], after: [], left: [], right: [] };

export function chartSlots(plan, top, more) {
  const slots = slotsOf(plan, 'charts');
  if (top && more) return [{ ...slots, after: [] }, { ...NO_SLOTS, after: slots.after }];
  return [top ? slots : NO_SLOTS, more ? slots : NO_SLOTS];
}

function HubBody({ app, page, entry, live, summary, state, onState, view, onView, meta, pageId, charts, explain, genieBusy, nonce,
  onChanged, plan, topSlots, onFix }) {
  const status = useCaseState(entry || live.data, summary);
  const waiting = status.kind === 'wait';
  const current = live.data || entry;
  const { fix, shown: rows } = hubView(page, current, summary, view, app.user);
  const reasons = reasonFilters(entry || live.data, summary);
  const first = reasons[0];
  const picked = first && state?.ai?.[first.name]?.length === 1 ? state.ai[first.name][0] : null;
  const loading = !current;
  return (
    <>
      {slotsOf(plan, '@top').after.map((b) => <Block key={b.id} block={b} />)}
      {!waiting && (
        <Placed slots={slotsOf(plan, 'kpis')}><Tiles tiles={hubTiles(page, current, summary, fix, app.user, status.kind === 'stale', onFix)} loading={loading} /></Placed>
      )}
      {!waiting && current?.money && <MoneyCard pageId={pageId} nonce={nonce} onChanged={onChanged} />}
      {!waiting && current?.truncated && <p className="more">These numbers count the {integer(current.items.length)} biggest of {current.total_more ? 'at least ' : ''}{integer(current.total)} open records.</p>}
      {!meta && <section className="fbar"><Skeleton height={34} width="70%" /></section>}
      <Placed slots={slotsOf(plan, 'filters')}>
        <FilterBar meta={meta?.filters} state={state || { range: {}, sel: {} }} onState={onState} pageId={pageId} reasons={reasons} view={view} onView={onView} />
      </Placed>
      {hubChartsOnTop(entry, live, summary) && (
        <Placed slots={topSlots}>
          <section className="charts">
            {charts(
              <BarsCard id="by_reason" title="Could save, by reason" hint="The AI groups each item by reason." action="Click a bar to filter." loading={loading}
                bars={first && current?.money ? reasonBars(rows, page) : []} picked={first ? picked : undefined} onPick={first ? (value) => onState(pickReason(state, first.name, value)) : undefined}
                empty={!first ? 'The AI gives no reasons for this use case yet.' : !current?.money ? NOT_MEASURED : 'Nothing to fix for these filters.'}
                x={first?.label} measure="Could save" filters={viewWords(view, reasons, state)} onExplain={explain} genieBusy={genieBusy}
                onFix={first && onFix ? (value) => onFix({ tiers: shownTiers(view.show), reason: { name: first.name, value }, money: true }) : undefined} />,
            )}
          </section>
        </Placed>
      )}
    </>
  );
}

export default function Dashboard({ app, page, meta, state, onState, view, onView, hubPage, laidOut, work, hubEntry, live, summary, latestRun, onRuns, data, error, failures,
  plan, topSlots, moreSlots, more, kpisCard, kpisOf, chartCards, hubCharts, tableCard, recordsCard, explain, genieBusy, nonce, onChanged, onAsk, genie, ready, filters,
  onPick, onFix, onWork, trends, onRun, running, onRetry = null, onRetryMeta = null, onRetrySummary = null }) {
  return (
    <>
      {backendNotes(app.backend, data).map((n) => <p key={n} className="note" role="status" data-backend-note><Icon name="info" size={14} />{n}</p>)}
      {hubPage && <HubTop entry={hubEntry} live={live} summary={summary} latest={latestRun} onRuns={onRuns} fixing onRetry={onRetry} onRetrySummary={onRetrySummary} />}
      {!laidOut && work && <TodoNow page={page} app={app} ready={ready} nonce={nonce} filters={filters} onAsk={onAsk} onRecords={onWork} />}
      {hubPage && (
        <HubBody app={app} page={page} entry={hubEntry} live={live} summary={summary} state={state} onState={onState} view={view} onView={onView} meta={meta}
          pageId={page.id} charts={hubCharts} explain={explain} genieBusy={genieBusy} nonce={nonce} onChanged={onChanged} plan={plan} topSlots={topSlots} onFix={onFix} />
      )}
      {trends}
      {!hubPage && slotsOf(plan, '@top').after.map((b) => <Block key={b.id} block={b} />)}
      {!hubPage && !meta && <section className="fbar"><Skeleton height={34} width="70%" /></section>}
      {!hubPage && (
        <Placed slots={slotsOf(plan, 'filters')}>
          <FilterBar meta={meta?.filters} state={state || { range: {}, sel: {} }} onState={onState} pageId={page.id} />
        </Placed>
      )}
      {meta?.error && <PlainNote text={meta.error} prefix="The filters could not load, so the page shows all its data: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={onRetryMeta} />}
      <PageFailure failures={failures} onRetry={onChanged} onRuns={onRuns} />
      {error && !failures?.whole && <PlainNote text={error} icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={onRetry} />}
      {laidOut && (
        <LayoutSections page={page} app={app} ready={ready} nonce={nonce} filters={filters} onChanged={onChanged} onAsk={onAsk}
          kpisOf={kpisOf} records={recordsCard} chartCards={(charts) => chartCards(charts)} tableCard={tableCard} data={data || (failures?.whole ? { errors: failures.errors } : null)} onPick={onPick} genie={genie}
          onRun={onRun} running={running} />
      )}
      {!hubPage && !laidOut && <Placed slots={slotsOf(plan, 'kpis')}>{kpisCard}</Placed>}
      {!hubPage && !laidOut && <Placed slots={moreSlots}><section className="charts" data-tour="view">{chartCards(page.charts.filter((c) => !c.driver))}</section></Placed>}
      {hubPage && more.some((c) => !c.driver) && (
        <Placed slots={moreSlots}><section className="charts charts--more" aria-label="More charts">{chartCards(more.filter((c) => !c.driver))}</section></Placed>
      )}
      {!laidOut && <Drivers drivers={page.drivers} cards={chartCards((hubPage ? more : page.charts).filter((c) => c.driver))} />}
      {!laidOut && page.tables.map((table) => <Placed key={table.id} slots={slotsOf(plan, table.id)}>{tableCard(table)}</Placed>)}
      {slotsOf(plan, '@bottom').after.map((b) => <Block key={b.id} block={b} />)}
    </>
  );
}
