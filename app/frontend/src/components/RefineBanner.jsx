import { valueChips } from '../lib/valueLedger';
import { ratioText, scoreText } from '../lib/scoreRefine';
import ValueDisclaimer from './ValueDisclaimer';

// REQ-433: asks right away to refine an out-of-order score (Apply, Keep), and after Apply offers Undo. REQ-434: carries the full disclaimer.
const money = (pair, amount) => valueChips([{ kind: pair.kind, unit: pair.unit, amount }], 1).shown[0]?.text || '';
const btn = 'rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-60';

export default function RefineBanner({ view, busy, error, onApply, onUndo, onKeep }) {
  if (!view) return null;
  const { applied, pairs, changes, names } = view;
  return (
    <section aria-label="Score refinement" data-score-refine="" className="mb-3 rounded-xl border border-warning-fg/40 bg-surface px-4 py-3">
      {applied ? (
        <p className="text-sm text-text-primary">{`Refined ${changes.length === 1 ? '1 score' : `${changes.length} scores`} so the order follows the value.`}</p>
      ) : (
        <ul className="space-y-1.5 text-sm text-text-primary">
          {pairs.map((pair) => {
            const to = changes.find((c) => c.id === pair.lower.id)?.to;
            return (
              <li key={pair.lower.id}>
                {`${pair.lower.name} (${scoreText(pair.lower.start)}, ${money(pair, pair.lowerAmount)}) is worth ${ratioText(pair.ratio)} ${pair.higher.name} (${scoreText(pair.higher.start)}, ${money(pair, pair.higherAmount)}). `}
                {`Refine ${pair.lower.name}'s score to ${scoreText(to)} so the order follows the value?`}
                <span data-refine-preview="" className="ms-2 tabular-nums text-text-secondary">{`${scoreText(pair.lower.start)} → ${scoreText(to)}`}</span>
              </li>
            );
          })}
        </ul>
      )}
      {applied && (
        <ul className="mt-1 space-y-0.5 text-xs text-text-secondary">
          {changes.map((c) => <li key={c.id} className="tabular-nums">{`${names[c.id] || c.id}: ${scoreText(c.from)} → ${scoreText(c.to)}`}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-error-fg">{error}</p>}
      <div className="mt-2 flex gap-2">
        {applied ? (
          <button type="button" disabled={busy} onClick={onUndo} className={`${btn} border-border text-text-primary`}>Undo</button>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={onApply} className={`${btn} border-db-red/40 bg-db-red-50 text-db-red-fg`}>Apply</button>
            <button type="button" disabled={busy} onClick={onKeep} className={`${btn} border-border text-text-primary`}>Keep</button>
          </>
        )}
      </div>
      <ValueDisclaimer className="mt-2" />
    </section>
  );
}
