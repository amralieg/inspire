import { Placed } from './Blocks.jsx';
import { slotsOf } from './blocks.js';
import FilterBar from './FilterBar.jsx';
import { Icon } from './icons.jsx';
import { PlainNote, Skeleton } from './ui.jsx';
import { integer } from './format.js';
import { FOCUSES, tabCount, workTabs } from './links.js';

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

export default function WorkPage({ meta, state, onState, onRetryMeta = null, pageId, reasons, plan, tab, choices, counts, onTab, focus, onClearFocus, children }) {
  return (
    <section className="work-sec" aria-label="Work" data-work>
      {!meta && <section className="fbar"><Skeleton height={34} width="70%" /></section>}
      <FilterBar meta={meta?.filters} columns={meta?.columns} state={state || { range: {}, sel: {} }} onState={onState} pageId={pageId} reasons={reasons} />
      {meta?.error && <PlainNote text={meta.error} prefix="The filters could not load, so the list shows all its records: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={onRetryMeta} />}
      {focus && FOCUSES[focus] && (
        <p className="work-focus" role="status" data-focus={focus}>
          <span>Only open records {FOCUSES[focus].toLowerCase()}</span>
          <button type="button" className="chip" onClick={onClearFocus} aria-label={`Show every record, not only ${FOCUSES[focus].toLowerCase()}`}>
            Show every record<Icon name="x" size={12} />
          </button>
        </p>
      )}
      {tab && <WorkTabs tab={tab} choices={choices} counts={counts} onTab={onTab} />}
      <Placed slots={slotsOf(plan, 'records')}>{children}</Placed>
    </section>
  );
}
