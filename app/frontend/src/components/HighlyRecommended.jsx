import { HIGHLY_RECOMMENDED } from '../lib/highlyRecommended';

export function BestOf({ best, label }) {
  if (!best || !label) return null;
  return (
    <p data-best-of="" className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-text-secondary">
      <span className="font-medium text-text-primary">{label}</span>
      <HighlyRecommended best={best} id={best.id} />
    </p>
  );
}

export default function HighlyRecommended({ best, id, why = true }) {
  if (!best || best.id !== id) return null;
  return (
    <span data-highly-recommended="" className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span className="rounded-full bg-success-bg border border-success/30 px-1.5 py-px text-[10px] font-semibold text-success-fg whitespace-nowrap">{HIGHLY_RECOMMENDED}</span>
      {why && best.reason && <span data-highly-recommended-why="" className="text-[11px] font-normal text-text-secondary">{best.reason}</span>}
    </span>
  );
}
