import { useEffect, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PORTFOLIO_GROUPS, portfolioCardAction } from '../lib/reviewFigures';
import { PlainMessage } from './TechnicalDetails';

const STATS_OPEN_KEY = 'inspire_start_stats_open';

const GROUP_COLUMNS = { 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-3 lg:grid-cols-6' };
const CARD = 'flex h-full w-full min-w-0 flex-col items-start rounded-lg border px-3 py-2 text-start';

export function usePortfolio(apiFetch, inspireDatabase, warehouseId, tick = 0) {
  const [state, setState] = useState({ portfolio: null, error: '' });
  useEffect(() => {
    if (!inspireDatabase || !warehouseId) return undefined;
    let cancelled = false;
    const q = new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId });
    apiFetch(`/api/inspire/portfolio?${q}`)
      .then((data) => { if (!cancelled) setState({ portfolio: data, error: '' }); })
      .catch((err) => { if (!cancelled) setState((prev) => ({ portfolio: prev.portfolio, error: String(err?.message || err) })); });
    return () => { cancelled = true; };
  }, [apiFetch, inspireDatabase, warehouseId, tick]);
  return state;
}

function CardFigure({ card, totals }) {
  return (
    <>
      <span data-card-label="" className="block w-full truncate text-[11px] text-text-secondary">{card.label}</span>
      <span data-card-value="" className="block text-xl font-bold tabular-nums tracking-tight text-text-primary">
        {totals ? (Number(totals[card.key]) || 0).toLocaleString('en-US') : <span aria-label="Loading" className="skeleton inline-block h-5 w-10 align-middle" />}
      </span>
    </>
  );
}

function useStatsOpen() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(STATS_OPEN_KEY) !== '0'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(STATS_OPEN_KEY, open ? '1' : '0'); } catch { /* storage off: the choice lasts this visit */ }
  }, [open]);
  return [open, setOpen];
}

export default function PortfolioCards({ portfolio, error, sessions, active = '', onCard }) {
  const totals = portfolio?.totals;
  const [open, setOpen] = useStatsOpen();
  const bodyId = useId();
  return (
    <section aria-label="Across all runs" data-portfolio="" className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 ${open ? 'border-b border-border' : ''}`}>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
          <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md uppercase tracking-[0.18em] hover:text-text-primary">
            <ChevronDown size={12} aria-hidden className={`transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} />
            Across all runs in this Inspire Database
          </button>
        </h2>
        {portfolio?.truncated && <p className="text-[11px] text-text-secondary">The run list holds 1,000 runs; the totals count every run.</p>}
      </div>
      <div id={bodyId} hidden={!open}>
      {error ? (
        <PlainMessage text={`Inspire could not count across the runs: ${error}`} role="alert" className="px-4 py-3 text-[12px] text-error-fg" />
      ) : (
        <div className="divide-y divide-border">
          {PORTFOLIO_GROUPS.map((group) => (
            <div key={group.id} role="group" aria-label={group.label} className="px-4 py-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">{group.label}</p>
              <ul className={`grid grid-cols-2 gap-2 ${GROUP_COLUMNS[group.cards.length]}`}>
                {group.cards.map((card) => {
                  const action = portfolioCardAction(card.key, portfolio, sessions);
                  const on = active === card.key;
                  return (
                    <li key={card.key} className="min-w-0">
                      {action.live ? (
                        <button
                          type="button"
                          data-portfolio-card={card.key}
                          aria-label={action.label}
                          aria-pressed={card.opens === 'runs' ? on : undefined}
                          onClick={() => onCard(card.key)}
                          className={`${CARD} transition-smooth ${
                            on ? 'border-db-red/50 bg-db-red-50' : 'border-border bg-bg hover:border-db-red/40 hover:bg-db-red-50/40'}`}
                        >
                          <CardFigure card={card} totals={totals} />
                        </button>
                      ) : (
                        <div data-portfolio-card={card.key} data-card-off="" className={`${CARD} border-border bg-bg`}>
                          <CardFigure card={card} totals={totals} />
                          {action.why && <PlainMessage as="span" text={action.why} data-card-why="" className="mt-0.5 block text-[10px] leading-snug text-text-secondary" />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}
