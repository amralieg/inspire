import { Briefcase, FolderOpen, Layers } from 'lucide-react';
import { RESULTS_VIEWS } from '../../lib/resultsView';

const ICONS = { usecases: Layers, business: Briefcase, assets: FolderOpen };

/**
 * The tabs of the run results: Use cases, Business, Assets, across the top of the page content at every width. `children` is the use case
 * browser's rail (the Domains tree and the other filters); it shows under the tabs, as the left rail of the Use cases view only.
 * Renders two grid items (tabs, rail) for the parent grid.
 */
export default function ResultsNav({ view, onView, useCaseCount, stickyClass = '', children }) {
  const onKeyDown = (e) => {
    const i = RESULTS_VIEWS.findIndex((v) => v.id === view);
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
    let next = i;
    if (dir) next = (i + (rtl ? -dir : dir) + RESULTS_VIEWS.length) % RESULTS_VIEWS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = RESULTS_VIEWS.length - 1;
    else return;
    e.preventDefault();
    const list = e.currentTarget;
    onView(RESULTS_VIEWS[next].id);
    requestAnimationFrame(() => list.querySelector(`[data-results-nav-item="${RESULTS_VIEWS[next].id}"]`)?.focus());
  };
  return (
    <>
      <div className="col-span-full min-w-0">
        <nav aria-label="Results sections" data-results-nav="">
          <ul role="tablist" aria-label="Results sections" onKeyDown={onKeyDown} className="grid grid-cols-3 gap-1.5 sm:mx-auto sm:flex sm:max-w-xl sm:justify-center">
            {RESULTS_VIEWS.map(({ id, label }) => {
              const Icon = ICONS[id];
              const current = view === id;
              return (
                <li key={id} role="presentation" className="contents sm:block sm:flex-1">
                  <button
                    type="button"
                    role="tab"
                    data-results-nav-item={id}
                    aria-selected={current}
                    aria-current={current ? 'page' : undefined}
                    tabIndex={current ? 0 : -1}
                    onClick={() => onView(id)}
                    className={`flex w-full items-center justify-center gap-2 rounded-lg border px-2 py-2 text-xs font-semibold transition-smooth sm:px-3 ${
                      current ? 'border-db-red/20 bg-db-red-50 text-db-red-fg' : 'border-border bg-surface text-text-secondary hover:bg-bg-subtle'
                    }`}
                  >
                    <Icon size={14} aria-hidden className="shrink-0" />
                    <span className="truncate">{label}</span>
                    {id === 'usecases' && <span className="text-[10px] font-mono tabular-nums">{useCaseCount}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      {view === 'usecases' && (
        <div data-results-nav-body="" className={`z-10 flex min-h-0 min-w-0 flex-col gap-3 md:sticky md:self-start md:overflow-y-auto md:pe-1 ${stickyClass}`}>
          {children}
        </div>
      )}
    </>
  );
}
