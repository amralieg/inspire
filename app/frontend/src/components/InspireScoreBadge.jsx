import { BOX, ROW_BOX } from './ValueBox';

// REQ-516, REQ-524: the score box is uncoloured (surface, border token, primary text) in the Review row and in the side panel; the value box beside it is the filled one.
// The row box is the compact size, the side panel box is the card size.
export default function InspireScoreBadge({ score, row = false }) {
  if (score == null) return null;
  return (
    <div className="shrink-0 flex flex-col items-center gap-1">
      <div
        data-score-box=""
        className={`${row ? ROW_BOX : BOX} border-border-strong bg-surface text-text-primary shadow-sm`}
        title="Inspire composite score"
      >
        <span className="text-caption font-bold uppercase tracking-[0.12em] leading-none">Inspire</span>
        <span className={`${row ? 'mt-0.5 text-2xl' : 'mt-1 text-3xl'} font-extrabold tabular-nums leading-none`}>{score.toFixed(1)}</span>
        <span className={`${row ? 'mt-0.5' : 'mt-1'} text-caption`}>score</span>
      </div>
    </div>
  );
}
