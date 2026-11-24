import { useEffect, useRef, useState } from 'react';
import { FileText, Heart, Sparkles, Star, ArrowRight, Loader2, Check } from 'lucide-react';
import InspireScoreBadge from '../InspireScoreBadge';
import ValueBox from '../ValueBox';
import QualityBarChip from '../QualityBarChip';
import { UseCaseNameTitle, UseCaseRenameButton } from '../UseCaseNameEditor';
import { useUseCaseRename, NAME_TEXT_CLASS } from '../../lib/useCaseRename';
import { bestOfBestLabel } from '../../lib/v130UseCase';
import { KIND_INFORMATIONAL_LABEL, kindChipStyle } from '../../lib/useCaseKind';
import { cardTitlesOfUseCase, inspireScoreFromUc } from '../../lib/useCaseFields';

// REQ-511 / REQ-512 (wireframe A6): the Review list row. One grid shared with the header in ResultsPage (ROW_GRID), so the columns line up:
// tick | # | favourite | name | Build MVP | Generate docs | score box | value box. Clicking the row (outside its buttons) opens the reader.
export const ROW_GRID = 'grid grid-cols-[22px_30px_22px_minmax(0,1fr)_124px_132px_136px_136px] items-center gap-3 max-md:grid-cols-[20px_20px_minmax(0,1fr)_minmax(0,1fr)] max-md:gap-2';
// Below 768px the row is three lines: tick, favourite and name; then Build MVP beside Generate docs, and the score beside the value box. The # column is dropped.

const BTN = 'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-semibold whitespace-nowrap transition-smooth disabled:opacity-60';
const BTN_PRIMARY = `${BTN} border-db-red-solid bg-db-red-solid text-white hover:bg-db-red-solid-hover`;
const BTN_OUTLINE = `${BTN} border-border bg-surface text-text-primary hover:bg-bg-subtle`;
const CHIP = 'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border shrink-0 leading-none';

// What the Build MVP cell says and does, by the MVP state (D4: the status column is gone, the label carries it).
export function buildCell(status, { onImplement, onOpenMvp }) {
  const kind = status?.kind;
  if (kind === 'mvp' && status.group === 'in_progress') return { label: 'Building…', busy: true, run: onOpenMvp || null };
  if (kind === 'mvp' && status.group === 'failed') return { label: 'Rebuild MVP', run: onImplement || null };
  if (kind === 'mvp') return { label: 'Open MVP', run: onOpenMvp || onImplement || null, primary: true };
  return { label: 'Build MVP', run: onImplement || null };
}

export default function UseCaseRow({
  uc, index, selection = null, isFavorite = false, onToggleFavorite, onRename, implementStatus = null, onImplement, onOpenMvp,
  onGenerateDocs, docsMade = false, yearly = null, valueSummary = null, canCalculate = false, onCalculate, onEdit, onUndoRefine, onOpen, open = false, rowAttrs = {},
}) {
  const { title: titleProp, subtitle } = cardTitlesOfUseCase(uc, index);
  // The saved name shows at once; a refreshed use case takes over when its own name changes.
  const [saved, setSaved] = useState(null);
  useEffect(() => { setSaved(null); }, [titleProp]);
  const title = saved ?? titleProp;
  const rename = useUseCaseRename(title, onRename ? async (name) => { await onRename(name); setSaved(name); } : undefined);
  const v130 = uc._v130 || null;
  const kind = v130?.kind || null;
  const build = buildCell(implementStatus, { onImplement, onOpenMvp });
  const BuildIcon = build.busy ? Loader2 : build.primary ? ArrowRight : Sparkles;
  // The Calculate box is replaced by the value box once a value is saved, so the dialog hands focus back to the row, which stays.
  const rowRef = useRef(null);
  const calculate = () => { rowRef.current?.focus({ preventScroll: true }); onCalculate?.(); };
  const openRow = (e) => {
    if (e.target.closest('button, input, a, textarea, select, [role="button"]')) return;
    onOpen?.();
  };

  return (
    <div
      ref={rowRef} data-use-case-row="" {...rowAttrs} data-open={open ? '' : undefined} tabIndex={0}
      onClick={openRow}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen?.(); } }}
      className={`${ROW_GRID} cursor-pointer rounded-xl border bg-surface px-2.5 py-2.5 shadow-sm transition-smooth hover:border-db-red/30 hover:shadow-md focus-visible:outline-2 focus-visible:outline-db-red-solid scroll-mt-10 ${open ? 'border-db-red/60 bg-db-red-50' : 'border-border/70'}`}
    >
      <div>
        {selection && (
          <input type="checkbox" data-use-case-select="" aria-label={`Select ${title}`} checked={Boolean(selection.checked)} onChange={(e) => selection.onChange(e.target.checked)} />
        )}
      </div>
      <div className="text-[13px] font-bold tabular-nums text-text-tertiary max-md:hidden">{index + 1}</div>
      <div>
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(); }} aria-pressed={isFavorite}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className={`transition-smooth ${isFavorite ? 'text-db-red-fg' : 'text-text-tertiary hover:text-db-red-fg'}`}>
          <Heart size={16} className={isFavorite ? 'fill-current' : ''} />
        </button>
      </div>
      <div className="min-w-0 max-md:col-span-2">
        {rename.editing ? <UseCaseNameTitle text={title} rename={rename} /> : (
          <div className="flex min-w-0 items-center gap-1">
            <h3 data-row-name="" dir="auto" title={title} className={`${NAME_TEXT_CLASS} min-w-0 md:truncate max-md:flex-1 max-md:break-words`}>{title}</h3>
            <UseCaseRenameButton text={title} rename={rename} />
          </div>
        )}
        {subtitle && <p dir="auto" title={subtitle} className="truncate text-[13px] leading-[18px] text-text-secondary">{subtitle}</p>}
        <div className="mt-1 flex max-h-[22px] min-w-0 flex-wrap gap-1.5 overflow-hidden [&>*]:max-w-full [&>*]:truncate">
          {v130?.bestOfBest && (
            <span className={`${CHIP} border-warning/35 bg-warning-bg uppercase tracking-wide text-warning-fg`} title={bestOfBestLabel(v130.bestOfBest)}>
              <Star size={11} className="fill-current" />Best of Best{v130.bestOfBest.rank ? ` #${v130.bestOfBest.rank}` : ''}
            </span>
          )}
          <QualityBarChip uc={uc} />
          {kind && (
            <span data-kind-chip={kind.id} data-kind-family={kind.family} className={`${CHIP} border-border text-text-primary`} style={kindChipStyle(kind.color)} title={`${kind.familyLabel}: ${kind.question}`}>
              {kind.familyLabel} · {kind.label}
            </span>
          )}
          {kind?.informational && <span data-kind-informational="" className={`${CHIP} border-border bg-bg-subtle text-text-secondary`}>{KIND_INFORMATIONAL_LABEL}</span>}
        </div>
      </div>
      <div className="max-md:col-start-3">
        <button type="button" disabled={!build.run} onClick={(e) => { e.stopPropagation(); build.run?.(); }} className={build.primary ? BTN_PRIMARY : BTN_OUTLINE}>
          <BuildIcon size={13} className={build.busy ? 'animate-spin' : ''} aria-hidden />{build.label}
        </button>
      </div>
      <div className="flex flex-col items-stretch gap-1">
        <button type="button" disabled={!onGenerateDocs} onClick={(e) => { e.stopPropagation(); onGenerateDocs?.(); }} className={BTN_OUTLINE}>
          <FileText size={13} aria-hidden />Generate docs
        </button>
        {docsMade && <span data-docs-made="" className="inline-flex items-center justify-center gap-1 text-[11px] font-medium text-success-fg"><Check size={11} aria-hidden />Docs made</span>}
      </div>
      <div className="flex justify-center max-md:col-start-3"><InspireScoreBadge score={inspireScoreFromUc(uc)} refinedFrom={uc.refined_from} onUndo={onUndoRefine} /></div>
      <div className="flex justify-center max-md:[&_[data-value-box]]:w-full">
        <ValueBox inset yearly={yearly} summary={valueSummary} canCalculate={canCalculate} onCalculate={calculate} onEdit={onEdit} />
      </div>
    </div>
  );
}
