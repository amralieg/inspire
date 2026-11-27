import { RUN_CHIP_KEYS } from '../lib/reviewFigures';

// REQ-575: the counts of a run card as chips. A chip with a number filters the run list to the runs that have it; the pressed chip is the active filter.
// The chips sit beside the card's open button, never inside it, so each is its own keyboard stop.
const CHIP = 'inline-flex items-baseline gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2';
const IDLE = 'border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text-primary';
const ON = 'border-db-red/40 bg-db-red-50 text-db-red-fg';

export default function RunCountChips({ items, active, onToggle }) {
  if (!items.length) return null;
  return (
    <ul data-run-counts="" aria-label="Counts for this run" className="relative z-10 flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {items.map((item) => {
        const label = item.text ? item.text : <><span className="font-semibold tabular-nums">{(item.n ?? 0).toLocaleString('en-US')}</span> {item.label}</>;
        if (item.n == null) return <li key={item.key} data-run-count={item.key} data-count-off="" className="text-xs text-text-secondary">{`${item.label} not counted`}</li>;
        if (!RUN_CHIP_KEYS.includes(item.key)) return <li key={item.key} data-run-count={item.key} className="text-xs text-text-secondary">{label}</li>;
        const pressed = active === item.key;
        return (
          <li key={item.key}>
            <button type="button" data-run-count={item.key} data-run-chip={item.key} aria-pressed={pressed} onClick={() => onToggle(item.key)}
              className={`${CHIP} ${pressed ? ON : IDLE}`}>
              {label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
