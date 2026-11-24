import {
  AlertCircle, ArrowDown, CheckCircle2, ChevronDown, Clock, Eye, EyeOff, Filter, Layers, Loader2, Search, XCircle,
} from 'lucide-react';
import { useState } from 'react';
import ModalDialog from '../ModalDialog';
import Button from '../ui/Button';
import { PlainMessage } from '../TechnicalDetails';
import { stepCategory } from '../../lib/monitorState';
import { splitTechnical } from '../../lib/plainText';
import { nameOfUseCase } from '../../lib/useCaseFields';

// REQ-511: "Every step" replaces the inline Detailed Steps log. The same stage list, search, status filter and step rows, in a dialog.
export const STATUS_FILTERS = [
  { key: 'all', label: 'All', color: 'text-text-secondary' },
  { key: 'running', label: 'In Progress', color: 'text-info-fg' },
  { key: 'success', label: 'Success', color: 'text-success-fg' },
  { key: 'warning', label: 'Warning', color: 'text-warning-fg' },
  { key: 'error', label: 'Error', color: 'text-error-fg' },
  { key: 'open', label: 'No end recorded', color: 'text-text-secondary' },
];

export default function EveryStepDialog({
  onClose, steps, stages, stageNames, totalCount, filteredCount, statusCounts, isStaleSession, stepsLive,
  stageFilter, setStageFilter, statusFilter, setStatusFilter, searchQuery, setSearchQuery, autoScroll, setAutoScroll,
  collapsedStages, toggleStage, hasActiveFilters, follow,
}) {
  return (
    <ModalDialog titleId="every-step-title" title="Every step" onClose={onClose} widthClass="max-w-6xl" bare
      header={(
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 pt-5 pb-3">
          <h2 id="every-step-title" className="min-w-0 flex-1 text-base font-bold text-text-primary">
            Every step
            <span className="ms-2 text-xs font-normal text-text-tertiary">{totalCount} step{totalCount !== 1 ? 's' : ''} in {stageNames.length} stage{stageNames.length !== 1 ? 's' : ''}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="shrink-0 rounded-md p-1.5 text-text-secondary hover:bg-bg-subtle">&times;</button>
        </div>
      )}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
    <div className="flex gap-4">
      {/* ── Left Sidebar: Stages ── */}
      <div className="w-56 shrink-0">
        <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden sticky top-6">
          {/* Sidebar header */}
          <div className="px-4 py-3 border-b border-border bg-linear-to-b from-db-red-50 to-surface">
            <div className="flex items-center gap-2">
              <Layers size={14} className="text-db-red-fg" />
              <span className="text-xs font-bold text-text-primary">Stages</span>
            </div>
            <p className="text-caption text-text-tertiary mt-0.5">
              {stageNames.length} stage{stageNames.length !== 1 ? 's' : ''} &middot; {totalCount} steps
            </p>
          </div>

          {/* Stage list */}
          <div className="p-1.5 space-y-0.5 max-h-[60vh] overflow-y-auto">
            {/* All stages option */}
            <button
              onClick={() => setStageFilter('all')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-start transition-smooth ${
                stageFilter === 'all'
                  ? 'bg-db-red-50 border border-db-red/20'
                  : 'hover:bg-bg-subtle border border-transparent'
              }`}
            >
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                stageFilter === 'all' ? 'bg-db-red/10' : 'bg-bg-subtle'
              }`}>
                <Layers size={14} className={stageFilter === 'all' ? 'text-db-red-fg' : 'text-text-tertiary'} />
              </div>
              <div className="flex-1 min-w-0">
                <span className={`text-caption font-semibold block ${
                  stageFilter === 'all' ? 'text-db-red-fg' : 'text-text-primary'
                }`}>
                  All Stages
                </span>
              </div>
              <span className={`text-caption font-mono ${stageFilter === 'all' ? 'text-db-red-fg' : 'text-text-tertiary'}`}>
                {totalCount}
              </span>
            </button>

            {/* Individual stages */}
            {stageNames.map((name) => {
              const allStageSteps = isStaleSession ? [] : steps.filter((s) => (s.stage_name || 'Pipeline') === name);
              const done = allStageSteps.filter((s) => isStepDone(s.status)).length;
              const errors = allStageSteps.filter((s) => stepCategory(s.status, stepsLive) === 'error').length;
              const running = allStageSteps.filter((s) => stepCategory(s.status, stepsLive) === 'running').length;
              const active = stageFilter === name;
              const total = allStageSteps.length;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;

              return (
                <button
                  key={name}
                  onClick={() => setStageFilter(active ? 'all' : name)}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-start transition-smooth ${
                    active
                      ? 'bg-db-red-50 border border-db-red/20'
                      : 'hover:bg-bg-subtle border border-transparent'
                  }`}
                >
                  {/* Status indicator */}
                  {errors > 0 ? (
                    <div className="w-5 h-5 rounded-full bg-error-bg flex items-center justify-center shrink-0 mt-0.5">
                      <XCircle size={14} className="text-error-fg" />
                    </div>
                  ) : running > 0 ? (
                    <div className="w-5 h-5 rounded-full bg-info-bg flex items-center justify-center shrink-0 mt-0.5">
                      <Loader2 size={14} className="animate-spin text-info-fg" />
                    </div>
                  ) : done === total && total > 0 ? (
                    <div className="w-5 h-5 rounded-full bg-success-bg flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle2 size={14} className="text-success-fg" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-bg-subtle flex items-center justify-center shrink-0 mt-0.5">
                      <Clock size={14} className="text-text-tertiary" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <span className={`text-caption font-semibold block truncate ${
                      active ? 'text-db-red-fg' : 'text-text-primary'
                    }`}>
                      {name}
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1 bg-bg rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-[width,background-color] duration-500 ${
                            errors > 0 ? 'bg-error' : done === total && total > 0 ? 'bg-success' : 'bg-db-red'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-caption font-mono text-text-tertiary shrink-0">{done}/{total}</span>
                    </div>
                    {errors > 0 && (
                      <span className="text-caption text-error-fg font-medium mt-0.5 block">
                        {errors} error{errors > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Right: Search/Filters + Steps Timeline ── */}
      <div className="flex-1 min-w-0">
        {/* Filter toolbar */}
        <div className="bg-surface border border-border rounded-xl mb-4 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input dir="auto" aria-label="Search steps"
                type="search"
                placeholder="Search steps, messages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full ps-9 pe-3 py-1.5 text-xs border border-border rounded-lg bg-bg text-text-primary placeholder:text-text-tertiary focus:border-db-red/30 transition-smooth"
              />
            </div>

            {/* Status pills */}
            <div role="radiogroup" aria-label="Filter by status" className="flex items-center gap-1">
              {STATUS_FILTERS.map((f) => {
                const count = statusCounts[f.key] || 0;
                const active = statusFilter === f.key;
                if (f.key !== 'all' && count === 0) return null;
                return (
                  <button
                    key={f.key} type="button" role="radio" aria-checked={active}
                    onClick={() => setStatusFilter(active ? 'all' : f.key)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-caption font-medium transition-smooth border ${
                      active
                        ? 'border-db-red/30 bg-db-red-50 text-db-red-fg'
                        : 'border-transparent text-text-secondary hover:bg-bg-subtle'
                    }`}
                  >
                    {f.label}
                    <span className={`text-caption font-mono ${active ? 'text-db-red-fg' : 'text-text-tertiary'}`}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Auto-scroll */}
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`p-1.5 rounded-lg transition-smooth border ${
                autoScroll ? 'border-db-red/20 bg-db-red-50 text-db-red-fg' : 'border-transparent text-text-tertiary hover:bg-bg-subtle'
              }`}
              aria-label={autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
            >
              {autoScroll ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>

            {hasActiveFilters && (
              <button
                onClick={() => { setSearchQuery(''); setStatusFilter('all'); setStageFilter('all'); }}
                className="text-caption text-db-red-fg hover:underline font-medium shrink-0"
                aria-label="Clear all filters"
              >
                Clear
              </button>
            )}
          </div>

          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="px-4 py-2 bg-db-red-50/50 border-t border-border flex items-center gap-2 flex-wrap">
              <Filter size={14} className="text-db-red-fg shrink-0" />
              <span className="text-caption text-text-secondary">
                <span className="font-semibold text-text-primary">{filteredCount}</span> of{' '}
                <span className="font-semibold text-text-primary">{totalCount}</span> steps
              </span>
              {statusFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-caption font-medium border border-db-red/20">
                  {STATUS_FILTERS.find((f) => f.key === statusFilter)?.label}
                  <button onClick={() => setStatusFilter('all')} aria-label="Remove status filter" className="hover:text-db-red-fg">&times;</button>
                </span>
              )}
              {stageFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-caption font-medium border border-db-red/20">
                  {stageFilter}
                  <button onClick={() => setStageFilter('all')} aria-label="Remove stage filter" className="hover:text-db-red-fg">&times;</button>
                </span>
              )}
              {searchQuery && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-caption font-medium border border-db-red/20">
                  "{searchQuery}"
                  <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="hover:text-db-red-fg">&times;</button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Steps list */}
        {Object.keys(stages).length > 0 ? (
          <div className="space-y-3">
            {Object.entries(stages).map(([stageName, stageSteps]) => {
              const collapsed = collapsedStages[stageName] !== false;
              const doneCount = stageSteps.filter((s) => isStepDone(s.status)).length;
              const errorCount = stageSteps.filter((s) => stepCategory(s.status, stepsLive) === 'error').length;
              const runningCount = stageSteps.filter((s) => stepCategory(s.status, stepsLive) === 'running').length;

              return (
                <div key={stageName} className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
                  <button
                    onClick={() => toggleStage(stageName)}
                    className="w-full px-4 py-3 border-b border-border bg-panel flex items-center gap-3 hover:bg-bg-subtle transition-smooth text-start"
                  >
                    <div className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
                      <ChevronDown size={14} className="text-text-tertiary" />
                    </div>
                    {errorCount > 0 ? (
                      <div className="w-5 h-5 rounded-full bg-error-bg flex items-center justify-center"><XCircle size={14} className="text-error-fg" /></div>
                    ) : runningCount > 0 ? (
                      <div className="w-5 h-5 rounded-full bg-info-bg flex items-center justify-center"><Loader2 size={14} className="animate-spin text-info-fg" /></div>
                    ) : doneCount === stageSteps.length ? (
                      <div className="w-5 h-5 rounded-full bg-success-bg flex items-center justify-center"><CheckCircle2 size={14} className="text-success-fg" /></div>
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-bg-subtle flex items-center justify-center"><Clock size={14} className="text-text-tertiary" /></div>
                    )}
                    <h3 className="text-xs font-bold text-text-primary flex-1">{stageName}</h3>
                    <div className="flex items-center gap-2">
                      {errorCount > 0 && (
                        <span className="text-caption font-medium px-1.5 py-0.5 rounded bg-error-bg text-error-fg">
                          {errorCount} error{errorCount > 1 ? 's' : ''}
                        </span>
                      )}
                      <span className="text-caption text-text-tertiary font-mono">{doneCount}/{stageSteps.length}</span>
                      <div className="w-16 h-1.5 bg-bg rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-[width,background-color] duration-500 ${
                            errorCount > 0 ? 'bg-error' : doneCount === stageSteps.length ? 'bg-success' : 'bg-db-red'
                          }`}
                          style={{ width: `${stageSteps.length > 0 ? (doneCount / stageSteps.length) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </button>
                  {!collapsed && (
                    <div className="divide-y divide-border-subtle">
                      {stageSteps.map((step) => (
                        <StepRow key={step.step_id} step={step} live={stepsLive} searchQuery={searchQuery} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={follow.ref} data-steps-end="" />
            {follow.unseen && (
              <div className="fixed bottom-6 start-1/2 -translate-x-1/2 z-40 pointer-events-none">
                <Button size="sm" onClick={follow.jump} className="pointer-events-auto gap-1 rounded-full shadow-lg">
                  <ArrowDown size={14} /> New steps
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl p-8 text-center shadow-sm">
            <Search size={20} className="text-text-tertiary mx-auto mb-3" />
            <p className="text-sm text-text-secondary">No steps match your filters</p>
            <button
              onClick={() => { setSearchQuery(''); setStatusFilter('all'); setStageFilter('all'); }}
              className="text-xs text-db-red-fg hover:underline mt-2 font-medium"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>
    </div>
      </div>
    </ModalDialog>
  );
}

export function getStepStyle(category) {
  switch (category) {
    case 'success':
      return { icon: <CheckCircle2 size={14} className="text-success-fg" />, badge: 'bg-success-bg text-success-fg', label: 'Success' };
    case 'running':
      return { icon: <Loader2 size={14} className="animate-spin text-info-fg" />, badge: 'bg-info-bg text-info-fg', label: 'In Progress' };
    case 'warning':
      return { icon: <AlertCircle size={14} className="text-warning-fg" />, badge: 'bg-warning-bg text-warning-fg', label: 'Warning' };
    case 'error':
      return { icon: <XCircle size={14} className="text-error-fg" />, badge: 'bg-error-bg text-error-fg', label: 'Error' };
    default:
      return { icon: <Clock size={14} className="text-text-tertiary" />, badge: 'bg-bg-subtle text-text-secondary', label: 'No end recorded' };
  }
}

export function isStepDone(status) {
  return status === 'ended_success' || status === 'ended_warning' || status === 'completed';
}

function highlightMatch(text, query) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-db-red-100 text-db-red-fg rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function StepRow({ step, live, searchQuery }) {
  const style = getStepStyle(stepCategory(step.status, live));
  const [expanded, setExpanded] = useState(false);
  const said = splitTechnical(step.message || '');
  const hasDetails = step.message || step.sub_step_name || (step.result_json && Object.keys(step.result_json).length > 0);

  return (
    <div className="hover:bg-bg-subtle/50 transition-smooth">
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        {style.icon}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary font-medium truncate">
            {highlightMatch(step.step_name || step.sub_step_name || 'Step', searchQuery)}
          </div>
          {step.message && !expanded && (
            <p className="text-caption text-text-tertiary mt-0.5 truncate">
              {highlightMatch(said.plain, searchQuery)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className={`text-caption font-medium px-2 py-0.5 rounded-full ${style.badge}`}>
            {style.label}
          </span>
          {hasDetails && (
            <ChevronDown size={14} className={`text-text-tertiary transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && hasDetails && (
        <div className="px-4 pb-3 ps-11 space-y-1.5">
          {step.sub_step_name && (
            <p className="text-xs text-text-secondary">
              <span className="text-text-tertiary">Sub-step:</span> {step.sub_step_name}
            </p>
          )}
          <PlainMessage text={step.message} className="text-xs text-text-secondary bg-bg-subtle rounded-lg p-2.5 leading-relaxed" />
          {step.result_json && Object.keys(step.result_json).length > 0 && (
            <ResultJsonDisplay resultJson={step.result_json} />
          )}
        </div>
      )}
    </div>
  );
}

function ResultJsonDisplay({ resultJson }) {
  if (!resultJson || typeof resultJson !== 'object') return null;
  const rj = resultJson;
  const prompt = rj.prompt_name || '';

  // Error display
  if (rj.error) {
    return (
      <div className="text-xs bg-error-bg/50 rounded-lg p-2.5 border border-error/10">
        <span className="text-error-fg font-semibold">Error:</span>{' '}
        <PlainMessage as="span" text={rj.error} className="text-text-secondary" />
      </div>
    );
  }

  // Use Case Generation
  if (prompt.endsWith('_USE_CASE_GEN_PROMPT') && Array.isArray(rj.use_cases)) {
    return (
      <div className="text-xs space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-success-bg text-success-fg font-semibold text-caption">
            {rj.use_cases_count || rj.use_cases.length} use cases
          </span>
          {rj.is_truncated && <span className="px-1.5 py-0.5 rounded bg-warning-bg text-warning-fg text-caption">truncated</span>}
        </div>
        <div className="flex flex-wrap gap-1">
          {rj.use_cases.slice(0, 10).map((uc, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full bg-bg-subtle text-text-secondary text-caption border border-border">
              {nameOfUseCase(uc) || `#${uc.id}`}
            </span>
          ))}
          {rj.use_cases.length > 10 && (
            <span className="px-2 py-0.5 rounded-full bg-bg-subtle text-text-tertiary text-caption">
              +{rj.use_cases.length - 10} more
            </span>
          )}
        </div>
      </div>
    );
  }

  // Scoring
  if (prompt === 'COMBINED_VALUE_QUALITY_SCORE_PROMPT' && Array.isArray(rj.scored_use_cases)) {
    return (
      <div className="text-xs space-y-1.5">
        <span className="px-1.5 py-0.5 rounded bg-info-bg text-info-fg font-semibold text-caption">
          {rj.scored_count || rj.scored_use_cases.length} scored
        </span>
        <div className="grid grid-cols-1 gap-0.5 max-h-28 overflow-y-auto">
          {rj.scored_use_cases.slice(0, 8).map((sc, i) => (
            <div key={i} className="flex items-center gap-2 text-caption py-0.5">
              <span className="text-text-primary font-medium truncate flex-1">{nameOfUseCase(sc) || `#${sc.id}`}</span>
              <span className={`px-1.5 py-0.5 rounded font-semibold ${
                ['Ultra High', 'Very High', 'High'].includes(sc.priority) ? 'bg-db-red-50 text-db-red-fg' : 'bg-bg-subtle text-text-secondary'
              }`}>{sc.priority}</span>
              <span className="text-text-tertiary">Q: {sc.quality}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Domain Clustering
  if (prompt === 'DOMAIN_FINDER_PROMPT' && Array.isArray(rj.domains)) {
    return (
      <div className="text-xs space-y-1.5">
        <span className="px-1.5 py-0.5 rounded bg-info-bg text-info-fg font-semibold text-caption">
          {rj.domains_count || rj.domains.length} domains
        </span>
        <div className="flex flex-wrap gap-1">
          {rj.domains.map((d, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full bg-bg-subtle text-text-secondary text-caption border border-border">
              {d.domain_name} ({(d.use_case_ids || []).length})
            </span>
          ))}
        </div>
      </div>
    );
  }

  // SQL Generation
  if (prompt === 'USE_CASE_SQL_GEN_PROMPT' && rj.sql_preview) {
    return (
      <div className="text-xs space-y-1">
        <span className="px-1.5 py-0.5 rounded bg-info-bg text-info-fg font-semibold text-caption">SQL Generated</span>
        <pre className="text-caption text-text-secondary bg-bg-subtle rounded p-2 font-mono max-h-20 overflow-hidden">
          {rj.sql_preview.slice(0, 200)}{rj.sql_preview.length > 200 ? '...' : ''}
        </pre>
      </div>
    );
  }

  // Summary
  if (prompt === 'SUMMARY_GEN_PROMPT') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="px-1.5 py-0.5 rounded bg-success-bg text-success-fg font-semibold text-caption">Summary generated</span>
        {rj.response_chars && <span className="text-text-tertiary text-caption">{rj.response_chars.toLocaleString()} chars</span>}
      </div>
    );
  }

  // Business Context
  if (prompt === 'BUSINESS_CONTEXT_WORKER_PROMPT' && rj.json) {
    const ctx = rj.json;
    return (
      <div className="text-xs space-y-1">
        {ctx.business_context && (
          <p className="text-text-secondary text-caption line-clamp-2">{ctx.business_context.slice(0, 200)}</p>
        )}
        {Array.isArray(ctx.strategic_goals) && ctx.strategic_goals.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {ctx.strategic_goals.map((g, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-bg-subtle text-text-secondary text-caption">{g}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Default: show key metrics as badges
  const metricKeys = ['response_chars', 'rows_count', 'use_cases_count', 'scored_count', 'domains_count', 'batch_rows'];
  const badges = metricKeys.filter((k) => rj[k] != null).map((k) => ({ key: k, val: rj[k] }));
  if (badges.length > 0) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {badges.map((b) => (
          <span key={b.key} className="px-1.5 py-0.5 rounded bg-bg-subtle text-text-tertiary text-caption font-mono">
            {b.key.replace(/_/g, ' ')}: {typeof b.val === 'number' ? b.val.toLocaleString() : b.val}
          </span>
        ))}
      </div>
    );
  }

  return null;
}

