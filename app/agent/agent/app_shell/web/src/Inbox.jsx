import { useCallback, useEffect, useRef, useState } from 'react';
import { getRecords } from './api.js';
import { Icon } from './icons.jsx';
import { PlainNote, Popover } from './ui.jsx';
import { shortDay } from './hub.js';
import { visitedAt } from './prefs.js';
import { useMyView } from './MyView.jsx';
import { NOT_IN_RUN } from './records.js';
import { INBOX_GROUPS, badgeText, inboxAsks, inboxCount, inboxGroups } from './inbox.js';

const EMPTY = { changed: 'Nothing changed since your last visit.', assigned: 'You own no open item.', due: 'Nothing of yours is due soon.', due_owner: 'Nothing of yours, and nothing nobody owns, is due soon.' };

function useLastVisit(pageId) {
  const { prefs } = useMyView();
  const [first] = useState(() => visitedAt(prefs, pageId));
  return first;
}

function useInbox(page, lastVisit) {
  const [state, setState] = useState({ loading: true, error: '', groups: null });
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    const asks = inboxAsks(page);
    getRecords(asks.changed).then((changed) => (changed?.actions === false ? [changed]
      : Promise.all([changed, getRecords(asks.mine), asks.unowned ? getRecords(asks.unowned) : null]))).then(([changed, owned, nobody]) => {
      if (mine !== seq.current) return;
      if (changed?.actions === false) {
        setState({ loading: false, error: '', groups: null, none: true });
        return;
      }
      const today = owned?.window?.today || new Date().toISOString().slice(0, 10);
      setState({ loading: false, error: '', groups: inboxGroups({ changed: changed?.rows, mine: owned?.rows, unowned: nobody?.rows, meta: page.records, lastVisit, today }) });
    }).catch((e) => { if (mine === seq.current) setState({ loading: false, error: e.message, groups: null }); });
  }, [page, lastVisit]);
  useEffect(() => { setState({ loading: true, error: '', groups: null }); load(); }, [load]);
  return { ...state, reload: load };
}

function Item({ item, onOpen }) {
  return (
    <li>
      <button type="button" className="inbox-i" onClick={() => onOpen(item.key)} data-inbox-item={item.key} aria-label={`Open ${item.label} in Work`}>
        <span className="inbox-t"><b><bdi>{item.label}</bdi></b>{item.fresh && <span className="chg-b chg-b--you">New</span>}{item.kept && <span className="chg-b chg-b--missing">{NOT_IN_RUN}</span>}</span>
        <small>{[item.status, item.due ? `${item.late ? 'Overdue since' : 'Due'} ${shortDay(item.due)}` : '', item.unowned ? 'Nobody owns it yet' : ''].filter(Boolean).join(' · ')}</small>
      </button>
    </li>
  );
}

function Inbox({ page, onOpen }) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => new Set());
  const lastVisit = useLastVisit(page.id);
  const inbox = useInbox(page, lastVisit);
  const count = inbox.groups ? inboxCount(inbox.groups, seen) : 0;
  const toggle = () => {
    if (!open) inbox.reload();
    setOpen(!open);
  };
  useEffect(() => { if (open && inbox.groups) setSeen((s) => new Set([...s, ...inbox.groups.keys])); }, [open, inbox.groups]);
  const pick = (key) => { setOpen(false); onOpen(page.id, key); };
  if (inbox.none) return null;
  const since = lastVisit > 0 ? `Your last visit to Work was ${shortDay(new Date(lastVisit).toISOString().slice(0, 10))}.` : 'This is your first visit to Work on this device, so nothing counts as new yet.';
  return (
    <>
      <button ref={anchor} type="button" className="ibtn inbox-btn" onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        aria-label={count ? `Inbox, ${count} new` : 'Inbox'} data-inbox>
        <Icon name="bell" size={17} />
        {count > 0 && <span className="inbox-n" data-inbox-count={count}>{badgeText(count)}</span>}
      </button>
      {open && (
        <Popover anchor={anchor.current} onClose={() => setOpen(false)} label="Inbox" width={380}>
          <div className="inbox-pop" data-inbox-panel>
            <p className="faint">{since}</p>
            {inbox.error && <PlainNote text={inbox.error} prefix="The inbox could not load: " className="tile-err" role="alert" />}
            {!inbox.groups && !inbox.error && <p className="more">Loading…</p>}
            {inbox.groups && INBOX_GROUPS.map(([id, title]) => (
              <section key={id} className="inbox-g" data-inbox-group={id} aria-label={title}>
                <h3>{title}<span className="faint">{` ${inbox.groups.groups[id].length}`}</span></h3>
                {inbox.groups.groups[id].length ? <ul>{inbox.groups.groups[id].map((item) => <Item key={item.key} item={item} onOpen={pick} />)}</ul>
                  : <p className="faint">{EMPTY[id === 'due' && page.is_owner === true ? 'due_owner' : id]}</p>}
              </section>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

export default function InboxBell({ page, on, onOpen }) {
  if (!page || !on) return null;
  return <Inbox key={page.id} page={page} onOpen={onOpen} />;
}
