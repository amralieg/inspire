import { Archive, ArchiveRestore, Heart, Star } from 'lucide-react';
import ImplementCardActions from './ImplementCardActions';
import InspireScoreBadge from './InspireScoreBadge';
import UseCaseDetailBody from './UseCaseDetailBody';
import { FeedbackChip, StrategyChip } from './UseCaseStrategyDetail';
import QualityBarChip, { QualityBarReason } from './QualityBarChip';
import { bestOfBestLabel } from '../lib/v130UseCase';
import { KIND_INFORMATIONAL_LABEL, KIND_INFORMATIONAL_TITLE, kindChipStyle } from '../lib/useCaseKind';
import {
  cardTitlesOfUseCase,
  fieldOf,
  inspireScoreFromUc,
  isNumericPriorityString,
  priorityPillClass,
} from '../lib/useCaseFields';
import ValueEstimateLine from './ValueEstimateLine';
import UseCaseNameEditor from './UseCaseNameEditor';

const s = (v) => (v == null ? '' : String(v));

export default function UseCaseCard({
  uc,
  index,
  expanded,
  onToggle,
  isFavorite,
  onToggleFavorite,
  implementStatus = null,
  onImplement,
  onOpenMvp,
  notebookUrl = '',
  assetLinks = [],
  isArchived = false,
  onRename,
  onToggleArchive,
  v130 = null,
  feedbackCurrent,
  ...detailProps
}) {
  const card = uc && typeof uc === 'object' ? uc : null;
  if (!card) return null;
  const u = card;
  const { title: titlePlain, subtitle: subtitleText } = cardTitlesOfUseCase(u, index);
  const domain = s(u._domain || u['Business Domain'] || u.domain);
  const subdomain = s(u.Subdomain);
  const ucType = s(u.type);
  const technique = s(fieldOf(u, 'Analytics Technique', 'analytics_technique'));
  const priority = s(u.Priority || u.priority);
  const inspireScoreNum = inspireScoreFromUc(u);
  const showPriorityPill = !!(priority && inspireScoreNum == null && !isNumericPriorityString(priority));
  const kind = v130?.kind || null;

  return (
    <div className="bg-surface border border-border/70 rounded-xl overflow-hidden shadow-elevated lift-on-hover hover:border-db-red/25">
      <div className="flex items-center gap-0">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className={`ps-3 pe-1 py-4 shrink-0 transition-smooth ${isFavorite ? 'text-db-red-fg' : 'text-text-tertiary hover:text-db-red-fg'}`}
          aria-pressed={isFavorite}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart size={16} className={isFavorite ? 'fill-current' : ''} />
        </button>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse use case details' : 'Expand use case details'}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
          className="flex-1 flex items-center gap-3 px-3 py-4 text-start hover:bg-bg-subtle transition-smooth cursor-pointer"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 dir="auto" className="text-lg sm:text-xl font-bold text-text-primary leading-snug">
                    {titlePlain}
                  </h3>
                  {v130?.bestOfBest && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.14em] px-2 py-0.5 rounded-md border shrink-0 leading-none text-warning-fg border-warning/35 bg-warning-bg"
                      title={bestOfBestLabel(v130.bestOfBest)}
                    >
                      <Star size={11} className="fill-current text-warning-fg" />
                      Best of Best{v130.bestOfBest.rank ? ` #${v130.bestOfBest.rank}` : ''}
                    </span>
                  )}
                  <QualityBarChip uc={u} />
                </div>
                {subtitleText && (
                  <p dir="auto" className="text-xs sm:text-sm text-text-secondary mt-1.5 leading-snug line-clamp-2">
                    {subtitleText}
                  </p>
                )}
                <QualityBarReason uc={u} className="mt-1" />
                <ValueEstimateLine uc={u} className="mt-1" />
              </div>
              <InspireScoreBadge score={inspireScoreNum} />
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              {kind && (
                <span
                  data-kind-chip={kind.id}
                  data-kind-family={kind.family}
                  className="text-[10px] px-2 py-0.5 rounded-full border font-semibold leading-none text-text-primary border-border"
                  style={kindChipStyle(kind.color)}
                  title={`${kind.familyLabel}: ${kind.question}`}
                >
                  {kind.familyLabel} · {kind.label}
                </span>
              )}
              {kind?.informational && (
                <span
                  data-kind-informational=""
                  className="text-[10px] px-2 py-0.5 rounded-full border leading-none text-text-secondary border-border bg-bg-subtle"
                  title={KIND_INFORMATIONAL_TITLE}
                >
                  {KIND_INFORMATIONAL_LABEL}
                </span>
              )}
              {kind && technique && (
                <span
                  data-technique-chip={technique}
                  dir="auto"
                  className="text-[10px] px-2 py-0.5 rounded-full border leading-none text-text-secondary border-border"
                  style={kindChipStyle(kind.color)}
                >
                  {technique}
                </span>
              )}
              <StrategyChip info={v130} strategy={detailProps.strategy} />
              <FeedbackChip status={feedbackCurrent?.status || v130?.feedbackStatus} />
              {showPriorityPill && (
                <span dir="auto" className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${priorityPillClass(priority)}`}>
                  {priority}
                </span>
              )}
            </div>
            <div data-use-case-meta="" className="text-[10px] text-text-tertiary mt-1.5 leading-snug break-words">
              {[domain || 'Unknown', subdomain, (kind ? '' : technique) || ucType].filter(Boolean).map((part, i) => (
                <span key={i}>{i > 0 && ' · '}<bdi>{part}</bdi></span>
              ))}
            </div>
          </div>
        </div>
        {typeof onToggleArchive === 'function' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleArchive(); }}
            className="pe-3 ps-1 py-4 shrink-0 text-text-tertiary hover:text-text-primary transition-smooth"
            aria-label={isArchived ? 'Unarchive use case' : 'Archive use case'}
            title={isArchived ? 'Unarchive: move it back to Active' : 'Archive: hide it from the Active list'}
            data-card-archive={isArchived ? 'archived' : 'active'}
          >
            {isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          </button>
        )}
      </div>

      <ImplementCardActions status={implementStatus} onImplement={onImplement} onOpen={onOpenMvp} notebookUrl={notebookUrl} links={assetLinks} />

      {expanded && typeof onRename === 'function' && (
        <UseCaseNameEditor name={s(u.Name)} originalName={s(u.original_name)} onSave={onRename} />
      )}
      {expanded && (
        <UseCaseDetailBody
          uc={u}
          className="border-t border-border px-5 py-5 bg-panel space-y-4"
          v130={v130}
          feedbackCurrent={feedbackCurrent}
          {...detailProps}
        />
      )}
    </div>
  );
}
