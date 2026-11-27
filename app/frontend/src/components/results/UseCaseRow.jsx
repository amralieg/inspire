import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, FileText, Heart, Sparkles, Star, ArrowRight, Loader2, Check } from 'lucide-react';
import MoreMenu from '../ui/MoreMenu';
import InspireScoreBadge from '../InspireScoreBadge';
import ValueBox from '../ValueBox';
import RoiBox from '../value/RoiBox';
import QualityBarChip from '../QualityBarChip';
import { UseCaseNameTitle, UseCaseRenameButton } from '../UseCaseNameEditor';
import { useUseCaseRename, NAME_TEXT_CLASS } from '../../lib/useCaseRename';
import { bestOfBestLabel } from '../../lib/v130UseCase';
import { KIND_INFORMATIONAL_LABEL, kindChipStyle } from '../../lib/useCaseKind';
import { cardTitlesOfUseCase, fieldOf, inspireScoreFromUc } from '../../lib/useCaseFields';

// REQ-511 / REQ-512 / REQ-516 (wireframe A7): the Review list row, a compact old card. One grid shared with the header in ResultsPage (ROW_GRID), so the columns line up:
// tick | # | favourite | card (name, badges, statement, chips, domain) | Build MVP over Generate docs (two header columns) | score box | value box | archive.
// Clicking the row (outside its buttons) opens the reader.
export const ROW_GRID = 'grid grid-cols-[22px_30px_22px_minmax(0,1fr)_124px_132px_136px_268px_28px] items-center gap-3 max-md:grid-cols-[repeat(12,minmax(0,1fr))] max-md:gap-x-2 max-md:gap-y-2';
// Below 768px the row stacks: tick, favourite, # and archive on top, then the whole card, Build MVP beside Generate docs, and the score beside the value box.

const BTN = 'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-semibold whitespace-nowrap transition-smooth disabled:opacity-60';
// Dark mode keeps the light red under white text (white on the dark-mode primary is 3.3:1).
const BTN_PRIMARY = `${BTN} border-primary-solid bg-primary-solid text-white hover:bg-primary-solid-hover`;
const BTN_OUTLINE = `${BTN} border-border bg-surface text-text-primary hover:bg-bg-subtle`;
const CHIP = 'inline-flex items-center gap-1 text-caption font-semibold px-2 py-0.5 rounded-md border shrink-0 leading-none';

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
  onGenerateDocs, docsMade = false, assetLinks = [], yearly = null, valueSummary = null, canCalculate = false, calculating = false, onCalculate, onEdit, onOpen, open = false, rowAttrs = {}, isArchived = false, onToggleArchive,
}) {
  const { title: titleProp, subtitle } = cardTitlesOfUseCase(uc, index);
  // The saved name shows at once; a refreshed use case takes over when its own name changes.
  const [saved, setSaved] = useState(null);
  useEffect(() => { setSaved(null); }, [titleProp]);
  const title = saved ?? titleProp;
  const rename = useUseCaseRename(title, onRename ? async (name) => { await onRename(name); setSaved(name); } : undefined);
  const v130 = uc._v130 || null;
  const str = (v) => (v == null ? '' : String(v).trim());
  const domainParts = [str(uc._domain || uc['Business Domain'] || uc.domain), str(uc.Subdomain)].filter(Boolean);
  const technique = str(fieldOf(uc, 'Analytics Technique', 'analytics_technique'));
  const kind = v130?.kind || null;
  // REQ-562: once documents exist the same button offers to make them again.
  const docsLabel = docsMade ? 'Re-generate docs' : 'Generate docs';
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
      className={`${ROW_GRID} cursor-pointer rounded-xl border bg-surface px-2.5 py-2.5 shadow-sm transition-smooth hover:border-db-red/30 hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary-solid scroll-mt-10 ${open ? 'border-db-red/60 bg-db-red-50' : 'border-border/70'}`}
    >
      <div className="max-md:col-span-1 max-md:col-start-1 max-md:row-start-1">
        {selection && (
          <input type="checkbox" data-use-case-select="" aria-label={`Select ${title}`} checked={Boolean(selection.checked)} onChange={(e) => selection.onChange(e.target.checked)} />
        )}
      </div>
      <div className="text-[13px] font-bold tabular-nums text-text-tertiary max-md:col-start-3 max-md:row-start-1">{index + 1}</div>
      <div className="max-md:col-start-2 max-md:row-start-1">
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(); }} aria-pressed={isFavorite}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className={`transition-smooth ${isFavorite ? 'text-db-red-fg' : 'text-text-tertiary hover:text-db-red-fg'}`}>
          <Heart size={16} className={isFavorite ? 'fill-current' : ''} />
        </button>
      </div>
      <div className="min-w-0 max-md:col-span-12">
        {rename.editing ? <UseCaseNameTitle text={title} rename={rename} /> : (
          <div className="flex min-w-0 items-start gap-1">
            <h3 data-row-name="" dir="auto" title={title} className={`${NAME_TEXT_CLASS} min-w-0 break-words max-md:flex-1`}>{title}</h3>
            <UseCaseRenameButton text={title} rename={rename} />
          </div>
        )}
        <div className="mt-1 flex min-w-0 flex-nowrap gap-1.5 overflow-hidden max-md:flex-wrap [&>*]:min-w-0 [&>*]:max-w-full [&>*]:shrink [&>*]:truncate">
          {v130?.bestOfBest && (
            <span className={`${CHIP} border-warning/35 bg-warning-bg uppercase tracking-wide text-warning-fg`} title={bestOfBestLabel(v130.bestOfBest)}>
              <Star size={14} className="fill-current" />Best of Best{v130.bestOfBest.rank ? ` #${v130.bestOfBest.rank}` : ''}
            </span>
          )}
          <QualityBarChip uc={uc} />
        </div>
        {subtitle && <p data-row-statement="" dir="auto" title={subtitle} className="mt-1 line-clamp-2 text-[13.5px] leading-[19px] text-text-secondary">{subtitle}</p>}
        <div className="mt-1.5 flex min-w-0 flex-nowrap gap-1.5 overflow-hidden [&>*]:min-w-0 [&>*]:max-w-full [&>*]:shrink [&>*]:truncate">
          {kind && (
            <span data-kind-chip={kind.id} data-kind-family={kind.family} className={`${CHIP} border-border text-text-primary`} style={kindChipStyle(kind.color)} title={`${kind.familyLabel}: ${kind.question}`}>
              {kind.familyLabel} · {kind.label}
            </span>
          )}
          {kind?.informational && <span data-kind-informational="" className={`${CHIP} border-border bg-bg-subtle text-text-secondary`}>{KIND_INFORMATIONAL_LABEL}</span>}
          {kind && technique && <span data-technique-chip={technique} dir="auto" className={`${CHIP} border-border text-text-secondary`} style={kindChipStyle(kind.color)}>{technique}</span>}
        </div>
        {domainParts.length > 0 && (
          <p data-row-domain="" className="mt-1 truncate text-xs leading-4 text-text-tertiary">
            {domainParts.map((part, i) => <span key={i}>{i > 0 && ' · '}<bdi>{part}</bdi></span>)}
          </p>
        )}
      </div>
      <div className="col-span-2 flex flex-col items-center gap-1.5 max-md:col-span-12 max-md:flex-row max-md:items-start">
        <button type="button" disabled={!build.run} onClick={(e) => { e.stopPropagation(); build.run?.(); }} className={`${build.primary ? BTN_PRIMARY : BTN_OUTLINE} max-w-[148px] max-md:max-w-none max-md:flex-1`}>
          <BuildIcon size={14} className={build.busy ? 'animate-spin' : ''} aria-hidden />{build.label}
        </button>
        <div className="flex w-full max-w-[148px] flex-col items-stretch gap-1 max-md:max-w-none max-md:flex-1">
          {assetLinks.length > 0 ? (
            // REQ-516 / REQ-510 L5: a built row keeps 7 controls, so Generate docs and the asset links share one More menu.
            <div data-row-more="" className="flex justify-center" onClick={(e) => e.stopPropagation()}>
              <MoreMenu label="More" items={[
                { label: docsLabel, onSelect: onGenerateDocs, disabled: !onGenerateDocs },
                ...assetLinks.map((link) => ({ label: link.label, onSelect: () => window.open(link.url, '_blank', 'noopener,noreferrer') })),
              ]} />
            </div>
          ) : (
            <button type="button" disabled={!onGenerateDocs} onClick={(e) => { e.stopPropagation(); onGenerateDocs?.(); }} className={BTN_OUTLINE}>
              <FileText size={14} aria-hidden />{docsLabel}
            </button>
          )}
          {docsMade && <span data-docs-made="" className="inline-flex items-center justify-center gap-1 text-caption font-medium text-success-fg"><Check size={14} aria-hidden />Docs made</span>}
        </div>
      </div>
      <div className="flex justify-center max-md:col-span-6 max-md:justify-start max-md:pb-3"><InspireScoreBadge row score={inspireScoreFromUc(uc)} /></div>
      <div className="flex justify-start gap-3 max-md:col-span-6 max-md:justify-end max-md:pb-3"><div className="flex w-[136px] shrink-0 justify-center"><ValueBox inset yearly={yearly} summary={valueSummary} canCalculate={canCalculate} calculating={calculating} onCalculate={calculate} onEdit={onEdit} /></div><RoiBox inset yearly={yearly} /></div>
      <div className="flex justify-end max-md:col-start-12 max-md:row-start-1">
        {typeof onToggleArchive === 'function' && (
          <button type="button" data-row-archive={isArchived ? 'archived' : 'active'} onClick={(e) => { e.stopPropagation(); onToggleArchive(); }}
            aria-label={isArchived ? 'Move this row back to Active' : 'Move this row to Archived'} title={isArchived ? 'Unarchive: move it back to Active' : 'Archive: hide it from the Active list'}
            className="text-text-tertiary transition-smooth hover:text-text-primary">
            {isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
