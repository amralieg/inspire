import { provisionalCardsOf } from '../../lib/candidates';

// REQ-581 U3: one card per eligible candidate, in provisional rank order, until its final use case card arrives.
export default function ProvisionalCards({ candidates, useCases }) {
  const cards = provisionalCardsOf(candidates, useCases);
  if (!cards.length) return null;
  return (
    <ul role="list" aria-label="Provisional use cases" className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => (
        <li key={c.candidate_id} data-candidate-card={c.candidate_id} data-provisional="true"
          data-provisional-rank={Number.isFinite(Number(c.provisional_rank)) && c.provisional_rank !== null ? String(c.provisional_rank) : ''}
          className="min-w-0 rounded-lg border border-dashed border-border bg-bg p-3">
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-caption font-semibold text-text-secondary">Provisional</span>
          </div>
          <p className="mt-1 text-sm font-medium leading-snug text-text-primary break-words">{c.name || c.candidate_id}</p>
        </li>
      ))}
    </ul>
  );
}
