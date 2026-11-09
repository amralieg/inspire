import { Placed } from './Blocks.jsx';
import { slotsOf } from './blocks.js';
import FilterBar from './FilterBar.jsx';
import { Icon } from './icons.jsx';
import { PlainNote, Skeleton } from './ui.jsx';
import { integer } from './format.js';
import { WORK_TABS, tabCount } from './links.js';

export function WorkTabs({ tab, counts, onTab }) {
  return (
    <div className="work-tabs" role="tablist" aria-label="Records by status">
      {WORK_TABS.map(([id, label]) => {
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

export default function WorkPage({ meta, state, onState, pageId, reasons, plan, tab, counts, onTab, children }) {
  return (
    <section className="work-sec" aria-label="Work" data-work>
      {!meta && <section className="fbar"><Skeleton height={34} width="70%" /></section>}
      <FilterBar meta={meta?.filters} state={state || { range: {}, sel: {} }} onState={onState} pageId={pageId} reasons={reasons} />
      {meta?.error && <PlainNote text={meta.error} prefix="The filters could not load, so the list shows all its records: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" />}
      {tab && <WorkTabs tab={tab} counts={counts} onTab={onTab} />}
      <Placed slots={slotsOf(plan, 'records')}>{children}</Placed>
    </section>
  );
}
