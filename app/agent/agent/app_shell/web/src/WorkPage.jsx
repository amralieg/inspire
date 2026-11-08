import { Placed } from './Blocks.jsx';
import { slotsOf } from './blocks.js';
import FilterBar from './FilterBar.jsx';
import { Icon } from './icons.jsx';
import { Skeleton } from './ui.jsx';
import { integer } from './format.js';
import { tabCount, workTabs } from './links.js';

export function WorkTabs({ tab, choices, counts, onTab }) {
  return (
    <div className="work-tabs" role="tablist" aria-label="Records by status">
      {workTabs(choices).map(([id, label]) => {
        const n = tabCount(counts, id);
        return (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`work-t ${tab === id ? 'is-on' : ''}`} onClick={() => onTab(id)} data-tab={id}>
            {label}{n != null && <small data-count>{integer(n)}</small>}
          </button>
        );
      })}
    </div>
  );
}

export default function WorkPage({ meta, state, onState, pageId, reasons, plan, tab, choices, counts, onTab, children }) {
  return (
    <section className="work-sec" aria-label="Work" data-work>
      {!meta && <section className="fbar"><Skeleton height={34} width="70%" /></section>}
      <FilterBar meta={meta?.filters} state={state || { range: {}, sel: {} }} onState={onState} pageId={pageId} reasons={reasons} />
      {meta?.error && <p className="tile-err" role="alert"><Icon name="info" size={14} />The filters could not load, so the list shows all its records: {meta.error}</p>}
      {tab && <WorkTabs tab={tab} choices={choices} counts={counts} onTab={onTab} />}
      <Placed slots={slotsOf(plan, 'records')}>{children}</Placed>
    </section>
  );
}
