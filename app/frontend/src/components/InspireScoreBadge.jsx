export default function InspireScoreBadge({ score, refinedFrom = null, onUndo = null }) {
  if (score == null) return null;
  const from = refinedFrom == null || refinedFrom === '' ? null : Number(refinedFrom);
  const refined = Number.isFinite(from) && from !== score;
  return (
    <div className="shrink-0 flex flex-col items-end gap-1">
    <div
      className="shrink-0 flex flex-col items-center justify-center rounded-2xl px-3.5 py-2 min-w-[4.25rem] bg-db-red-50 border border-db-red/20 shadow-sm"
      title={refined ? `Inspire composite score. Refined from ${from}` : 'Inspire composite score'}
    >
      <span className="text-[8px] font-semibold text-db-red-fg uppercase tracking-[0.18em] leading-none">
        Inspire
      </span>
      <span className="text-2xl font-extrabold text-db-red-fg tabular-nums tracking-tight leading-none mt-1.5">
        {refined ? score.toFixed(2) : score.toFixed(1)}
      </span>
    </div>
    {refined && onUndo && (
      <button type="button" aria-label="Undo refined score" title={`Restore the first score, ${from}`} className="text-[10px] font-semibold text-db-red-fg underline"
        onClick={(e) => { e.stopPropagation(); onUndo(); }}>Undo</button>
    )}
    </div>
  );
}
