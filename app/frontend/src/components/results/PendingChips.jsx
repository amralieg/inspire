import { PENDING_LABEL, PENDING_TEXT } from '../../lib/candidates';

const CHIP = 'inline-flex items-center gap-1 text-caption font-semibold px-2 py-0.5 rounded-md border shrink-0 leading-none border-border bg-bg-subtle text-text-secondary';

/** REQ-581 U4: the artifacts the Discover run left for Implement, one chip per kind. The row and the reader card share this. */
export default function PendingChips({ kinds = [], className = 'mt-1' }) {
  if (!kinds.length) return null;
  return (
    <div className={`${className} flex min-w-0 flex-wrap gap-1.5`}>
      {kinds.map((k) => (
        <span key={k} data-pending-artifact={k} className={CHIP}>{PENDING_LABEL[k]} {PENDING_TEXT}</span>
      ))}
    </div>
  );
}
