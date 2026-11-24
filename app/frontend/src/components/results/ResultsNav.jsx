import { Briefcase, FolderOpen, Layers } from 'lucide-react';
import { RESULTS_VIEWS } from '../../lib/resultsView';
import Tabs, { tabPanel } from '../ui/Tabs';

const NAV_ID = 'results';
/** Props for the panel under the Results tabs: role=tabpanel, hidden unless it is the current view, fades in. */
export const resultsPanel = (id, view) => tabPanel(NAV_ID, id, view);
const ICONS = { usecases: Layers, business: Briefcase, assets: FolderOpen };

/**
 * The tabs of the run results: Use cases, Business, Assets, across the top of the page content at every width. `children` is the use case
 * browser's rail (the Domains tree and the other filters); it shows under the tabs, as the left rail of the Use cases view only.
 * Renders two grid items (tabs, rail) for the parent grid.
 */
export default function ResultsNav({ view, onView, useCaseCount, stickyClass = '', children }) {
  return (
    <>
      <div className="col-span-full min-w-0">
        <nav aria-label="Results sections" data-results-nav="">
          <Tabs label="Results sections" idBase={NAV_ID} current={view} onPick={onView} className="justify-center"
            tabs={RESULTS_VIEWS.map(({ id, label }) => ({ id, label, icon: ICONS[id], count: id === 'usecases' ? useCaseCount : undefined }))}
            tabAttrs={(t, on) => ({ 'data-results-nav-item': t.id, 'aria-current': on ? 'page' : undefined })} />
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
