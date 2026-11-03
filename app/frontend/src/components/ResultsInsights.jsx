import { useState } from 'react';
import { ChevronRight, Compass, Eye, Layers, Lock, MessageSquareText } from 'lucide-react';
import {
  FEEDBACK_EMPTY_TEXT, FEEDBACK_OFF_TEXT, KPI_TRACKING_NOT_MEASURED, STRATEGY_PATH_SEPARATOR, dataAccessSummary, excludedFeedbackText, feedbackLabel,
  formatBaseline, trackedKpiNote, trackedKpiValue,
} from '../lib/v130UseCase';
import { scoreText } from '../lib/reviewFigures';
import { plural } from '../lib/plural';
import DataGrid from './DataGrid';
import { placeholderWords } from '../lib/placeholderWords';

const LIST_PREVIEW = 5;
const COVERAGE_PREVIEW = 8;

function ShowAll({ total, shown, open, onToggle, noun = '' }) {
  if (total <= shown) return null;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="text-[11px] font-medium text-db-red-fg hover:underline">
      {open ? 'Show fewer' : `Show all ${total}${noun ? ` ${noun}` : ''}`}
    </button>
  );
}

function usePreview(items, size, noun = '') {
  const [open, setOpen] = useState(false);
  const list = Array.isArray(items) ? items : [];
  return {
    shown: open ? list : list.slice(0, size),
    toggle: <ShowAll total={list.length} shown={size} open={open} noun={noun} onToggle={() => setOpen((o) => !o)} />,
  };
}

export function SidebarFilterPanel({ title, subtitle, icon, open, onToggle, allLabel, allCount, options, value, onChange }) {
  const Icon = icon;
  const selected = options.find((o) => o.value === value);
  const allActive = value === 'all';
  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full shrink-0 items-start gap-2 border-b border-border bg-gradient-to-b from-db-red-50 to-surface px-3 py-3 text-left transition-smooth hover:from-db-red-50/80"
      >
        <ChevronRight
          size={14}
          className={`mt-0.5 shrink-0 text-text-tertiary transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        />
        <Icon size={14} className="mt-0.5 shrink-0 text-db-red-fg" />
        <div className="min-w-0 flex-1">
          <span className="text-xs font-bold text-text-primary">{title}</span>
          <p className="text-[10px] text-text-tertiary mt-0.5">{subtitle}</p>
          {!open && !allActive && (
            <p className="mt-1 truncate text-[10px] font-medium text-db-red-fg" title={selected?.title || selected?.label || value}>
              Filter: {selected?.label || value}
            </p>
          )}
        </div>
      </button>
      {open && (
        <div className="p-1.5 space-y-0.5">
          <button
            type="button"
            onClick={() => onChange('all')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-smooth ${
              allActive ? 'bg-db-red-50 border border-db-red/20' : 'hover:bg-bg-subtle border border-transparent'
            }`}
          >
            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${allActive ? 'bg-db-red/10' : 'bg-bg-subtle'}`}>
              <Icon size={10} className={allActive ? 'text-db-red-fg' : 'text-text-tertiary'} />
            </div>
            <span className={`text-[11px] font-semibold flex-1 truncate ${allActive ? 'text-db-red-fg' : 'text-text-primary'}`}>
              {allLabel}
            </span>
            <span className={`text-[10px] font-mono shrink-0 ${allActive ? 'text-db-red-fg' : 'text-text-tertiary'}`}>{allCount}</span>
          </button>
          {options.map((o) => {
            const active = value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(active ? 'all' : o.value)}
                title={o.title || o.label}
                style={o.depth ? { paddingLeft: `${0.75 + o.depth * 0.75}rem` } : undefined}
                className={`w-full flex items-start gap-2 px-3 py-2 rounded-lg text-left transition-smooth ${
                  active ? 'bg-db-red-50 border border-db-red/20' : 'hover:bg-bg-subtle border border-transparent'
                }`}
              >
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${active ? 'bg-db-red/10' : 'bg-bg-subtle'}`}>
                  <Icon size={10} className={active ? 'text-db-red-fg' : 'text-text-tertiary'} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`text-[11px] font-semibold block truncate ${active ? 'text-db-red-fg' : 'text-text-primary'}`}>{o.label}</span>
                  <span className="text-[9px] text-text-tertiary font-mono mt-0.5 block">
                    {o.count} use case{o.count !== 1 ? 's' : ''}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InsightCard({ icon, title, summary, children }) {
  const Icon = icon;
  return (
    <section aria-label={title} data-insight={title} className="w-full min-w-0 rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <Icon size={14} className="mt-0.5 shrink-0 text-db-red-fg" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-bold text-text-primary">{title}</h3>
          <p className="text-[11px] text-text-secondary mt-0.5">{summary}</p>
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">{children}</div>
    </section>
  );
}

export function DataAccessBadge({ results }) {
  const access = dataAccessSummary(results);
  if (!access) return null;
  if (!access.deep) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-[11px] text-text-secondary shadow-sm">
        <Lock size={13} className="mt-0.5 shrink-0 text-success-fg" />
        <span>
          <span className="font-semibold text-text-primary">Standard discovery: no data read.</span> Inspire used table and column
          metadata, metric views, lineage and access counts only.
        </span>
      </div>
    );
  }
  const skipped = Object.entries(access.tablesSkipped);
  return (
    <details className="mb-4 rounded-xl border border-border bg-surface shadow-sm">
      <summary className="flex cursor-pointer items-start gap-2 px-3 py-2.5 text-[11px] text-text-secondary">
        <Eye size={13} className="mt-0.5 shrink-0 text-db-red-fg" />
        <span>
          <span className="font-semibold text-text-primary">Deep discovery:</span> read aggregates from{' '}
          {plural(access.tablesReadCount, 'table')} in {plural(access.statements, 'statement')}.{' '}
          {access.piiColumnsExcluded > 0 && `${plural(access.piiColumnsExcluded, 'personal column')} counted only. `}
          {access.rowsSentToAi} rows sent to the AI.
        </span>
      </summary>
      <div className="px-4 pb-3 space-y-2">
        {access.tablesRead.length > 0 && (
          <ul className="grid gap-0.5 sm:grid-cols-2">
            {access.tablesRead.map((t) => (
              <li key={t} className="truncate font-mono text-[10px] text-text-secondary" title={t}>{t}</li>
            ))}
          </ul>
        )}
        {skipped.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-text-tertiary">Not read</p>
            <ul className="space-y-0.5">
              {skipped.map(([table, reason]) => (
                <li key={table} className="text-[10px] text-text-tertiary">
                  <span className="font-mono">{table}</span>: {String(reason)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

const showsCoverage = (coverage) => !!coverage && Array.isArray(coverage.entries);
const showsFoundations = (foundations) => Array.isArray(foundations);

export function StrategyCoveragePanel({ coverage, onSelectPath, onSelectNotAligned }) {
  const entries = usePreview(coverage?.entries, COVERAGE_PREVIEW);
  const shownPriorities = usePreview(coverage?.priorities, LIST_PREVIEW);
  if (!showsCoverage(coverage)) return null;
  const gaps = Array.isArray(coverage.gaps) ? coverage.gaps : [];
  const gapIds = new Set(gaps.map((g) => g.id));
  const priorities = Array.isArray(coverage.priorities) ? coverage.priorities : [];
  const priorityGaps = new Set(coverage.priority_gaps || []);
  const summary = `${coverage.aligned ?? 0} of ${coverage.use_cases ?? 0} use cases aligned · ${plural(gaps.length, 'gap')}` +
    (priorities.length ? ` · ${priorities.length - priorityGaps.size} of ${priorities.length} priorities covered` : '');
  return (
    <InsightCard icon={Compass} title="Strategy coverage" summary={summary}>
      {coverage.source !== 'customer' && (
        <p className="text-[11px] text-text-secondary">No strategy was given, so Inspire used its built-in goals.</p>
      )}
      <ul className="space-y-1" aria-label="Strategy entries">
        {entries.shown.map((e) => {
          const parts = String(e.path || '').split(STRATEGY_PATH_SEPARATOR);
          const isGap = gapIds.has(e.id);
          const count = Number(e.use_cases) || 0;
          return (
            <li key={e.id} style={{ paddingLeft: `${(parts.length - 1) * 0.9}rem` }} className="flex items-center gap-2">
              <button
                type="button"
                disabled={!count || !onSelectPath}
                onClick={() => onSelectPath?.(e.path)}
                title={e.path}
                className="min-w-0 flex-1 truncate text-left text-[11px] text-text-primary enabled:hover:text-db-red-fg disabled:cursor-default"
              >
                {parts[parts.length - 1]}
                {e.level && <span className="ml-1 text-[9px] text-text-tertiary"> {e.level}</span>}
              </button>
              {isGap && (
                <span
                  className="shrink-0 rounded border border-warning/35 bg-warning-bg px-1.5 py-0.5 text-[9px] font-semibold text-warning-fg"
                  title={gaps.find((g) => g.id === e.id)?.reason || ''}
                >
                  Gap
                </span>
              )}
              <span className={`shrink-0 font-mono text-[10px] ${count ? 'text-text-secondary' : 'text-text-tertiary'}`}>{count}</span>
            </li>
          );
        })}
      </ul>
      {entries.toggle}
      {gaps.length > 0 && (
        <p className="text-[11px] text-text-secondary">{gaps[0].reason}. A gap is never filled with a made-up use case.</p>
      )}
      {(coverage.not_aligned ?? 0) > 0 && (
        <button type="button" onClick={onSelectNotAligned} className="text-[11px] font-medium text-db-red-fg hover:underline">
          {plural(coverage.not_aligned, 'use case')} not aligned to any entry
        </button>
      )}
      {priorities.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary mb-1">Business priorities</p>
          <ul className="space-y-1" aria-label="Business priorities">
            {shownPriorities.shown.map((p) => (
              <li key={p.priority} className="flex items-center gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-text-primary" title={placeholderWords(p.priority)}>{placeholderWords(p.priority)}</span>
                {priorityGaps.has(p.priority) && (
                  <span className="shrink-0 rounded border border-warning/35 bg-warning-bg px-1.5 py-0.5 text-[9px] font-semibold text-warning-fg">Gap</span>
                )}
                <span className="shrink-0 font-mono text-[10px] text-text-secondary">{p.use_cases}</span>
              </li>
            ))}
          </ul>
          {shownPriorities.toggle}
        </div>
      )}
    </InsightCard>
  );
}

function UseCaseLink({ entry, onOpen }) {
  if (!entry.useCase || !onOpen) return <span className="min-w-0 break-words text-text-primary">{entry.name}</span>;
  return (
    <button type="button" onClick={() => onOpen(entry.useCase)} title={`Open ${entry.name} in the list`}
      className="min-w-0 text-left break-words text-text-primary hover:text-db-red-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red/30 rounded">
      {entry.name}
    </button>
  );
}

function FoundationCard({ foundation, describe, onOpenUseCase }) {
  const ids = Array.isArray(foundation.use_cases) ? foundation.use_cases : [];
  const list = usePreview(ids, LIST_PREVIEW);
  return (
    <li className="rounded-lg border border-border bg-bg p-3" data-foundation={foundation.id}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-text-primary">{foundation.id} · {foundation.name}</span>
        <span className="shrink-0 text-[10px] text-text-secondary">{plural(foundation.use_case_count ?? ids.length, 'use case')}</span>
      </div>
      <p className="mt-1 font-mono text-[10px] text-text-secondary [overflow-wrap:anywhere]">{(foundation.tables || []).join(', ')}</p>
      {(foundation.joins || []).map((j) => (
        <p key={`${j.left}=${j.right}`} className="font-mono text-[10px] text-text-secondary [overflow-wrap:anywhere]">
          {j.left} = {j.right} <span className="font-sans whitespace-nowrap">({j.source})</span>
        </p>
      ))}
      <ul className="mt-2 space-y-1 text-[11px]" aria-label={`Use cases on ${foundation.name || foundation.id}`}>
        {list.shown.map((id) => <li key={id}><UseCaseLink entry={describe(id)} onOpen={onOpenUseCase} /></li>)}
      </ul>
      <div className="mt-1">{list.toggle}</div>
    </li>
  );
}

function BuildOrder({ order, describe, onOpenUseCase }) {
  const list = usePreview(order, LIST_PREVIEW);
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary mb-1">Suggested build order</p>
      <ol className="space-y-1 text-[11px]" aria-label="Suggested build order">
        {list.shown.map((id, i) => {
          const entry = describe(id);
          return (
            <li key={id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-x-2">
              <span className="font-mono text-[10px] text-text-secondary tabular-nums">{i + 1}.</span>
              <span className="min-w-0">
                <UseCaseLink entry={entry} onOpen={onOpenUseCase} />
                {entry.domain && <span className="block text-[10px] text-text-secondary">{entry.domain}</span>}
              </span>
              <span className="font-mono text-[10px] text-text-secondary tabular-nums" title="Inspire Score">{scoreText(entry.score)}</span>
            </li>
          );
        })}
      </ol>
      <div className="mt-1">{list.toggle}</div>
      <p className="mt-1 text-[11px] text-text-secondary">Ordered by shared foundation, then Inspire Score. The pace is yours to set.</p>
    </div>
  );
}

export function FoundationsPanel({ foundations, deliveryOrder, describe, onOpenUseCase }) {
  const shown = usePreview(foundations, 3, 'foundations');
  if (!showsFoundations(foundations)) return null;
  const unlocked = new Set(foundations.flatMap((f) => f.use_cases || [])).size;
  const order = Array.isArray(deliveryOrder) ? deliveryOrder : [];
  return (
    <InsightCard
      icon={Layers}
      title="Data foundations"
      summary={foundations.length
        ? `${plural(foundations.length, 'shared foundation')} · ${plural(unlocked, 'use case')} build on them`
        : 'No table is shared by two or more use cases'}
    >
      {foundations.length > 0 && (
        <>
          <ul className="space-y-2" aria-label="Shared foundations">
            {shown.shown.map((f) => <FoundationCard key={f.id} foundation={f} describe={describe} onOpenUseCase={onOpenUseCase} />)}
          </ul>
          {shown.toggle}
        </>
      )}
      {order.length > 0 && <BuildOrder order={order} describe={describe} onOpenUseCase={onOpenUseCase} />}
    </InsightCard>
  );
}

function pointValue(point) {
  return point && point.value != null && Number.isFinite(Number(point.value)) ? Number(point.value) : null;
}

function valueText(point) {
  const value = pointValue(point);
  return value == null ? 'n/a' : formatBaseline(value);
}

function nowText(t) {
  if (t.status === 'measured') return valueText(t.current);
  return t.status === 'query_only' ? 'Query only' : t.status === 'not_measured' ? KPI_TRACKING_NOT_MEASURED : 'Unavailable';
}

const TRACKING_COLUMNS = [
  { key: 'title', label: 'Use case', className: 'py-1 pr-2 text-text-primary' },
  {
    key: 'kpi', label: 'KPI', className: 'py-1 pr-2 text-text-secondary',
    render: (t) => {
      const note = trackedKpiNote(t);
      return <>{t.kpi}{note && <span data-tracking-note="" className="block text-[10px] text-text-secondary">{note}</span>}</>;
    },
  },
  { key: 'baseline', label: 'Baseline', kind: 'number', value: (t) => pointValue(trackedKpiValue(t).baseline), render: (t) => valueText(trackedKpiValue(t).baseline) },
  { key: 'now', label: 'Now', kind: 'number', value: (t) => (t.status === 'measured' ? pointValue(t.current) : null), render: nowText },
  {
    key: 'change', label: 'Change', kind: 'number', className: 'py-1 font-mono text-text-secondary', value: (t) => trackedKpiValue(t).change,
    render: (t) => {
      const { change } = trackedKpiValue(t);
      return change != null ? formatBaseline(change) : 'n/a';
    },
  },
];

function feedbackParts(results, feedback) {
  const excluded = Array.isArray(results?.excluded_by_feedback) ? results.excluded_by_feedback : [];
  const snapshot = Array.isArray(results?.portfolio_history) ? results.portfolio_history : [];
  const tracking = Array.isArray(results?.value_tracking) ? results.value_tracking : [];
  const live = feedback?.available ? feedback.latest || [] : null;
  const history = live || snapshot;
  const hasData = !!(excluded.length || history.length || tracking.length);
  const note = feedback?.available === false ? FEEDBACK_OFF_TEXT : feedback?.available === true && !hasData ? FEEDBACK_EMPTY_TEXT : '';
  return { excluded, tracking, live, history, hasData, note, shows: hasData || Boolean(note) };
}

export function FeedbackPanel({ results, feedback }) {
  const { excluded, tracking, live, history, hasData, note, shows } = feedbackParts(results, feedback);
  if (!shows) return null;
  if (!hasData) {
    return (
      <section aria-label="Feedback and value" data-insight="Feedback and value" data-compact=""
        className="flex w-full min-w-0 items-start gap-2 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
        <MessageSquareText size={14} className="mt-0.5 shrink-0 text-db-red-fg" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-text-primary">Feedback and value</h3>
          <p data-feedback-note="" className="mt-0.5 text-[11px] text-text-secondary">{note}</p>
        </div>
      </section>
    );
  }
  return (
    <InsightCard
      icon={MessageSquareText}
      title="Feedback and value"
      summary={`${excluded.length} hidden by feedback · ${plural(history.length, 'use case')} with feedback · ${plural(tracking.length, 'KPI')} tracked`}
    >
      {note && <p data-feedback-note="" className="text-[11px] text-text-secondary">{note}</p>}
      {excluded.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary mb-1">Hidden by feedback</p>
          <ul className="space-y-0.5">
            {excluded.map((e, index) => (
              <li key={`${e.use_case_key}|${e.use_case_id ?? index}`} className="text-[11px] text-text-secondary">
                {excludedFeedbackText(e)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {history.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary mb-1">
            {live ? 'Latest feedback' : 'Feedback at the time of this run'}
          </p>
          <ul className="space-y-0.5">
            {history.map((h) => (
              <li key={h.use_case_key} className="flex items-baseline gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-text-primary" title={h.use_case_title || h.title}>{h.use_case_title || h.title}</span>
                <span className="shrink-0 text-text-secondary">{feedbackLabel(h.status)}</span>
                <span className="shrink-0 font-mono text-[9px] text-text-tertiary">{String(h.updated_at || '').slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tracking.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary mb-1">Value of implemented use cases</p>
          <DataGrid label="Value of implemented use cases" grid="results:value_tracking" columns={TRACKING_COLUMNS} rows={tracking}
            rowKey={(t, i) => `${t.use_case_key}-${i}`} rowProps={(t) => ({ 'data-tracking-status': t.status || '' })} tableClassName="w-full text-[11px]"
            headRowClassName="text-left text-[9px] uppercase tracking-[0.14em] text-text-tertiary" headClassName="py-1 pr-2 font-semibold" rowClassName={() => 'border-t border-border align-top'}
            cellClassName="py-1 pr-2 font-mono text-text-secondary" />
          {tracking.some((t) => t.status === 'query_only' && t.query) && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] text-text-tertiary">A Standard run never reads data. Run these queries to measure the KPIs now.</p>
              {tracking.filter((t) => t.status === 'query_only' && t.query).map((t, i) => (
                <details key={`${t.use_case_key}-q-${i}`} className="rounded border border-border bg-bg">
                  <summary className="cursor-pointer px-2 py-1 text-[10px] text-text-secondary">{t.title}: {t.kpi}</summary>
                  <pre className="overflow-x-auto px-2 pb-2 font-mono text-[10px] text-text-primary whitespace-pre-wrap">{t.query}</pre>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </InsightCard>
  );
}

export function InsightsGrid({ results, feedback, describe, onOpenUseCase, onSelectPath, onSelectNotAligned }) {
  const big = [
    showsCoverage(results?.strategy_coverage) && (
      <StrategyCoveragePanel key="strategy" coverage={results.strategy_coverage} onSelectPath={onSelectPath} onSelectNotAligned={onSelectNotAligned} />
    ),
    showsFoundations(results?.foundations) && (
      <FoundationsPanel key="foundations" foundations={results.foundations} deliveryOrder={results.delivery_order} describe={describe} onOpenUseCase={onOpenUseCase} />
    ),
  ].filter(Boolean);
  const notes = feedbackParts(results, feedback).shows ? <FeedbackPanel key="feedback" results={results} feedback={feedback} /> : null;
  const count = big.length + (notes ? 1 : 0);
  if (!count) return null;
  if (big.length === 2) {
    return (
      <div data-insights-grid={count} data-insights-columns="2" className="grid grid-cols-1 md:grid-cols-2 items-start gap-3 mb-4">
        <div className="flex min-w-0 flex-col gap-3">{big[0]}{notes}</div>
        <div className="flex min-w-0 flex-col gap-3">{big[1]}</div>
      </div>
    );
  }
  return (
    <div data-insights-grid={count} data-insights-columns="1" className="flex min-w-0 flex-col gap-3 mb-4">
      {big}
      {notes}
    </div>
  );
}