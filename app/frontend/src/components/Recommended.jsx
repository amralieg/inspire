import { RECOMMENDED } from '../lib/recommended';

export function BestOf({ best, label }) {
  if (!best || !label) return null;
  return (
    <p data-best-of="" className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-text-secondary">
      <span className="font-medium text-text-primary">{label}</span>
      <Recommended best={best} id={best.id} />
    </p>
  );
}

export default function Recommended({ best, id, why = true }) {
  if (!best || best.id !== id) return null;
  return (
    <span data-recommended={String(id)} title={why ? undefined : best.reason || undefined} className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span className="rounded-full bg-success-bg border border-success/30 px-1.5 py-px text-[10px] font-semibold text-success-fg whitespace-nowrap">{RECOMMENDED}</span>
      {why && best.reason && <span data-recommended-why="" className="text-[11px] font-normal text-text-secondary">{best.reason}</span>}
    </span>
  );
}
