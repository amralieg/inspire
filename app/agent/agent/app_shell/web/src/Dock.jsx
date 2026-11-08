import { createContext, useContext, useRef } from 'react';
import { GenieMark, Icon } from './icons.jsx';
import { Resizer, useGenieWidth } from './Genie.jsx';

export const DockContext = createContext(null);
export const useDock = () => useContext(DockContext);

export function DockTabs({ tab, onTab }) {
  return (
    <div className="dock-tabs" role="tablist" aria-label="Side panel">
      <button type="button" role="tab" aria-selected={tab === 'record'} className={`dock-t ${tab === 'record' ? 'is-on' : ''}`} onClick={() => onTab('record')} data-dock-tab="record">
        <Icon name="box" size={14} />Record
      </button>
      <button type="button" role="tab" aria-selected={tab === 'genie'} className={`dock-t ${tab === 'genie' ? 'is-on' : ''}`} onClick={() => onTab('genie')} data-dock-tab="genie">
        <GenieMark size={14} />Ask Genie
      </button>
    </div>
  );
}

export function RecordDock({ tabs, onSlot, onClose, empty }) {
  const panel = useRef(null);
  const width = useGenieWidth(panel);
  return (
    <aside ref={panel} className="genie is-open dock" aria-label="Record" style={{ '--genie-w': `${width.shown}px` }} data-dock="record">
      <Resizer width={width} label="Resize the side panel" />
      {tabs}
      <div className="dock-b" ref={onSlot}>
        {empty && (
          <div className="dock-empty" data-dock-empty>
            <Icon name="box" size={28} />
            <p>Pick a record to see it here.</p>
            <button type="button" className="lnk" onClick={onClose}>Close the panel</button>
          </div>
        )}
      </div>
    </aside>
  );
}
