import { useMemo, useState } from 'react';
import { liveCountText } from '../../lib/liveUseCases';

// REQ-511 Monitor C: the live use cases as cards, with one chip per domain that filters them.
const CARD_CAP = 60;
const PRIORITY_TONE = [
  [/ultra|very high/i, 'text-db-red-fg bg-db-red-50'],
  [/high/i, 'text-error-fg bg-error-bg'],
  [/medium/i, 'text-warning-fg bg-warning-bg'],
];
const toneOf = (priority) => (PRIORITY_TONE.find(([re]) => re.test(priority || '')) || [null, 'text-text-secondary bg-bg-subtle'])[1];

export default function ArrivingNow({ useCases, live, empty }) {
  const [domain, setDomain] = useState('');
  const domains = useMemo(() => {
    const counts = new Map();
    for (const uc of useCases) if (uc.domain) counts.set(uc.domain, (counts.get(uc.domain) || 0) + 1);
    return [...counts.entries()];
  }, [useCases]);
  const active = domains.some(([name]) => name === domain) ? domain : '';
  const cards = active ? useCases.filter((uc) => uc.domain === active) : useCases;
  return (
    <section aria-label="Arriving now" className="min-w-0 rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-text-primary">Arriving now</h2>
        <span className="ms-auto text-xs text-text-secondary tabular-nums">
          {useCases.length > 0 && <span data-testid="live-use-case-count">{liveCountText(useCases.length)}</span>}
          {live && <span className="ms-1.5 inline-block h-1.5 w-1.5 rounded-full bg-db-red animate-pulse align-middle" aria-hidden="true" />}
        </span>
      </div>
      {domains.length > 0 && (
        <div role="group" aria-label="Filter by domain" className="mb-3 flex flex-wrap gap-1.5">
          {domains.map(([name, n]) => (
            <button key={name} type="button" data-domain-chip="" aria-pressed={active === name} onClick={() => setDomain(active === name ? '' : name)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-smooth ${
                active === name ? 'border-text-primary bg-text-primary text-surface' : 'border-border text-text-secondary hover:bg-bg-subtle'}`}>
              {name}<span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
      )}
      {useCases.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">{empty}</p>
      ) : (
        <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.slice(0, CARD_CAP).map((uc, i) => (
            <li key={uc.id || `${uc.name}-${i}`} data-live-use-case="" className="min-w-0 rounded-lg border border-border bg-bg p-3">
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <span className="font-mono tabular-nums">{uc.id || `#${i + 1}`}</span>
                {uc.priority && <span className={`ms-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneOf(uc.priority)}`}>{uc.priority}</span>}
              </div>
              <p className="mt-1 text-sm font-medium leading-snug text-text-primary break-words">{uc.label || uc.name}</p>
              <p className="mt-1 flex items-center gap-2 text-xs text-text-secondary">
                {uc.domain && <span className="truncate">{uc.domain}</span>}
                {uc.quality && <span className="ms-auto shrink-0 rounded-full bg-bg-subtle px-1.5 py-0.5 text-[11px]">Quality {uc.quality}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
      {cards.length > CARD_CAP && <p className="mt-3 text-center text-xs text-text-tertiary">+{cards.length - CARD_CAP} more use cases. Pick a domain to narrow them.</p>}
    </section>
  );
}
