import { ShieldAlert } from 'lucide-react';
import TechnicalDetails from './TechnicalDetails';
import { DROPPED_GROUP_NOTE, DROPPED_GROUP_TITLE, qualityGateDropsOf } from '../lib/qualityGateDrops';

export default function QualityGateDrops({ results }) {
  const drops = qualityGateDropsOf(results);
  if (!drops.length) return null;
  return (
    <details data-quality-gate-drops="" className="mt-4 rounded-xl border border-border/70 bg-surface shadow-elevated">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-db-red">
        <ShieldAlert size={15} aria-hidden="true" className="shrink-0 text-text-tertiary" />
        <span>{DROPPED_GROUP_TITLE}</span>
        <span className="ms-auto rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] tabular-nums text-text-secondary">{drops.length}</span>
      </summary>
      <div className="border-t border-border/70 px-4 py-3">
        <p dir="auto" className="mb-3 text-[12px] text-text-secondary">{DROPPED_GROUP_NOTE}</p>
        <ul className="space-y-3">
          {drops.map((drop) => (
            <li key={drop.key} data-dropped-use-case={drop.no || drop.name} className="min-w-0 rounded-lg border border-border/60 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p dir="auto" className="min-w-0 break-words text-[13px] font-semibold text-text-primary">{drop.name}</p>
                {drop.gateScore != null && (
                  <span data-dropped-score="" className="shrink-0 text-[11px] tabular-nums text-text-secondary">{drop.gateScore} / 10</span>
                )}
              </div>
              {drop.where && <p dir="auto" className="text-[11px] text-text-tertiary">{drop.where}</p>}
              <p dir="auto" data-dropped-reason="" className="mt-1 text-[12px] text-text-secondary">{drop.reason}</p>
              <TechnicalDetails items={[`Quality gate ${drop.gate}`]} />
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
