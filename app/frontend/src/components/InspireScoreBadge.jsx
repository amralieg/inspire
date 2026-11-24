import { BOX } from './ValueBox';

// REQ-438: the score box, solid red with white text, the same size as the value box beside it. Undo of a refined score sits under it.
export default function InspireScoreBadge({ score, refinedFrom = null, onUndo = null }) {
  if (score == null) return null;
  const from = refinedFrom == null || refinedFrom === '' ? null : Number(refinedFrom);
  const refined = Number.isFinite(from) && from !== score;
  return (
    <div className="shrink-0 flex flex-col items-center gap-1">
      <div
        data-score-box=""
        className={`${BOX} border-primary-solid bg-primary-solid text-white shadow-sm`}
        title={refined ? `Inspire composite score. Refined from ${from}` : 'Inspire composite score'}
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] leading-none">Inspire</span>
        <span className="mt-1 text-3xl font-extrabold tabular-nums leading-none">{refined ? score.toFixed(2) : score.toFixed(1)}</span>
        <span className="mt-1 text-[10px]">score</span>
      </div>
      {refined && onUndo && (
        <button type="button" aria-label="Undo refined score" title={`Restore the first score, ${from}`} className="text-[10px] font-semibold text-db-red-fg underline"
          onClick={(e) => { e.stopPropagation(); onUndo(); }}>Undo</button>
      )}
    </div>
  );
}
