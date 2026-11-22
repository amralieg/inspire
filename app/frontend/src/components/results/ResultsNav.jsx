import { Briefcase, FolderOpen, Layers } from 'lucide-react';
import { RESULTS_VIEWS } from '../../lib/resultsView';

const ICONS = { usecases: Layers, business: Briefcase, assets: FolderOpen };

/**
 * The left panel of the run results: Use cases, Business, Assets. `children` is the use case browser's side rail (the Domains tree and the
 * other filters); it shows under "Use cases" only while that view is open. Under the md breakpoint the panel is a row of 3 tabs and the rail
 * follows below them, above the list.
 */
export default function ResultsNav({ view, onView, useCaseCount, stickyClass = '', children }) {
  return (
    <div className={`z-10 w-full shrink-0 min-h-0 md:sticky md:w-56 md:self-start md:overflow-y-auto md:pe-1 ${stickyClass}`}>
      <nav aria-label="Results sections" data-results-nav="">
        <ul className="grid grid-cols-3 gap-1.5 md:flex md:flex-col">
          {RESULTS_VIEWS.map(({ id, label }) => {
            const Icon = ICONS[id];
            const current = view === id;
            return (
              <li key={id} className="contents md:block">
                <button
                  type="button"
                  data-results-nav-item={id}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => onView(id)}
                  className={`flex w-full items-center justify-center gap-2 rounded-lg border px-2 py-2 text-xs font-semibold transition-smooth md:justify-start md:px-3 ${
                    current ? 'border-db-red/20 bg-db-red-50 text-db-red-fg' : 'border-border bg-surface text-text-secondary hover:bg-bg-subtle'
                  }`}
                >
                  <Icon size={14} aria-hidden className="shrink-0" />
                  <span className="truncate">{label}</span>
                  {id === 'usecases' && <span className="ms-auto text-[10px] font-mono tabular-nums">{useCaseCount}</span>}
                </button>
                {id === 'usecases' && current && (
                  <div data-results-nav-body="" className="col-span-3 mt-3 flex flex-col gap-3 max-md:order-last md:mt-2">
                    {children}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
