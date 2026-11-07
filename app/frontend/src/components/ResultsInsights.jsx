import { useState } from 'react';
import { ChevronRight, Eye, ListOrdered, Lock, MessageSquareText } from 'lucide-react';
import {
  FEEDBACK_EMPTY_TEXT, FEEDBACK_OFF_TEXT, KPI_TRACKING_NOT_MEASURED, dataAccessSummary, excludedFeedbackText, feedbackLabel,
  formatBaseline, trackedKpiNote, trackedKpiValue,
} from '../lib/v130UseCase';
import { scoreText } from '../lib/reviewFigures';
import { plural } from '../lib/plural';
import DataGrid from './DataGrid';

const LIST_PREVIEW = 5;

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
        className="flex w-full shrink-0 items-start gap-2 border-b border-border bg-gradient-to-b from-db-red-50 to-surface px-3 py-3 text-start transition-smooth hover:from-db-red-50/80"
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
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-start transition-smooth ${
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
                style={o.depth ? { paddingInlineStart: `${0.75 + o.depth * 0.75}rem` } : undefined}
                className={`w-full flex items-start gap-2 px-3 py-2 rounded-lg text-start transition-smooth ${
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
  if (!access.dataRead) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-[11px] text-text-secondary shadow-sm">
        <Lock size={13} className="mt-0.5 shrink-0 text-success-fg" />
        <span>
          <span className="font-semibold text-text-primary">{access.type}: no data read.</span> Inspire used table and column
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
          <span className="font-semibold text-text-primary">{access.type}:</span> read summary figures (counts and totals) from{' '}
          {plural(access.tablesReadCount, 'table')} in {plural(access.statements, 'statement')}.{' '}
          {access.piiColumnsExcluded > 0 && `${plural(access.piiColumnsExcluded, 'personal column')} counted only. `}
          {access.aiSeesAggregates ? 'The AI also saw these summary figures' : 'None of these summary figures was sent to the AI'};{' '}
          {plural(access.rowsSentToAi, 'data row')} sent to the AI.
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

function UseCaseLink({ entry, onOpen }) {
  if (!entry.useCase || !onOpen) return <span dir="auto" className="min-w-0 break-words text-text-primary">{entry.name}</span>;
  return (
    <button type="button" dir="auto" onClick={() => onOpen(entry.useCase)} title={`Open ${entry.name} in the list`}
      className="min-w-0 text-start break-words text-text-primary hover:text-db-red-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red/30 rounded">
      {entry.name}
    </button>
  );
}

function BuildOrder({ order, describe, onOpenUseCase }) {
  const list = usePreview(order, LIST_PREVIEW);
  return (
    <div>
      <ol className="space-y-1 text-[11px]" aria-label="Suggested build order">
        {list.shown.map((id, i) => {
          const entry = describe(id);
          return (
            <li key={id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-x-2">
              <span className="font-mono text-[10px] text-text-secondary tabular-nums">{i + 1}.</span>
              <span className="min-w-0">
                <UseCaseLink entry={entry} onOpen={onOpenUseCase} />
                {entry.domain && <span dir="auto" className="block text-[10px] text-text-secondary">{entry.domain}</span>}
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

export function BuildOrderPanel({ deliveryOrder, describe, onOpenUseCase }) {
  const order = Array.isArray(deliveryOrder) ? deliveryOrder : [];
  if (!order.length || typeof describe !== 'function') return null;
  return (
    <InsightCard icon={ListOrdered} title="Suggested build order" summary={plural(order.length, 'use case')}>
      <BuildOrder order={order} describe={describe} onOpenUseCase={onOpenUseCase} />
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
  { key: 'title', label: 'Use case', className: 'py-1 pe-2 text-text-primary' },
  {
    key: 'kpi', label: 'KPI', className: 'py-1 pe-2 text-text-secondary',
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
            headRowClassName="text-start text-[9px] uppercase tracking-[0.14em] text-text-tertiary" headClassName="py-1 pe-2 font-semibold" rowClassName={() => 'border-t border-border align-top'}
            cellClassName="py-1 pe-2 font-mono text-text-secondary" />
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

export function InsightsGrid({ results, feedback, describe, onOpenUseCase }) {
  const order = Array.isArray(results?.delivery_order) && results.delivery_order.length > 0 && typeof describe === 'function'
    ? <BuildOrderPanel key="order" deliveryOrder={results.delivery_order} describe={describe} onOpenUseCase={onOpenUseCase} />
    : null;
  const notes = feedbackParts(results, feedback).shows ? <FeedbackPanel key="feedback" results={results} feedback={feedback} /> : null;
  const count = (order ? 1 : 0) + (notes ? 1 : 0);
  if (!count) return null;
  return (
    <div data-insights-grid={count} data-insights-columns="1" className="flex min-w-0 flex-col gap-3 mb-4">
      {order}
      {notes}
    </div>
  );
}
