import { useCallback, useEffect, useRef, useState } from 'react';
import { getFeedback, getRecords } from './api.js';
import { PlainNote } from './ui.jsx';
import { shortDay } from './hub.js';
import { visitedAt } from './prefs.js';
import { useMyView } from './MyView.jsx';
import { NOT_IN_RUN } from './records.js';
import { INBOX_GROUPS, inboxAsks, inboxGroups, recordsInbox } from './inbox.js';

const EMPTY = {
  fix: 'Nothing to fix right now.', runs: 'No run failed since the last one that finished.', reports: 'No new report waits for you.',
  assigned: 'You own no open item.', due: 'Nothing of yours is due soon.', due_owner: 'Nothing of yours, and nothing nobody owns, is due soon.',
};

function useLastVisit(pageId) {
  const { prefs } = useMyView();
  const [first] = useState(() => visitedAt(prefs, pageId));
  return first;
}

function useInboxReads(app, page, nonce, on) {
  const [state, setState] = useState({ records: null, reports: null, errors: {} });
  const seq = useRef(0);
  const listed = on && recordsInbox(app, page);
  const owner = on && page.is_owner === true && !!page.history;
  const load = useCallback(() => {
    const mine = ++seq.current;
    const asks = inboxAsks(page);
    const settle = (patch) => { if (mine === seq.current) setState((s) => ({ ...s, ...patch(s) })); };
    if (listed) {
      Promise.all([getRecords(asks.mine), asks.unowned ? getRecords(asks.unowned) : null])
        .then(([owned, nobody]) => settle(() => ({ records: owned?.actions === false ? { none: true } : { mine: owned?.rows, unowned: nobody?.rows, today: owned?.window?.today } })))
        .catch((e) => settle((s) => ({ records: { none: true }, errors: { ...s.errors, records: e.message } })));
    }
    if (owner) {
      getFeedback(page.id).then((d) => settle(() => ({ reports: d })))
        .catch((e) => settle((s) => ({ reports: null, errors: { ...s.errors, reports: e.message } })));
    }
  }, [page, listed, owner]);
  useEffect(() => { setState({ records: null, reports: null, errors: {} }); load(); }, [load, nonce]);
  return { ...state, ready: (!listed || !!state.records) && (!owner || !!state.reports || !!state.errors.reports) };
}

export function useInbox({ app, page, fix, runs, nonce, on }) {
  const lastVisit = useLastVisit(page.id);
  const reads = useInboxReads(app, page, nonce, on);
  if (!on) return null;
  const records = reads.records && !reads.records.none ? reads.records : {};
  const today = records.today || new Date().toISOString().slice(0, 10);
  const built = inboxGroups({ mine: records.mine, unowned: records.unowned, meta: page.records, lastVisit, today, fix, runs, reports: reads.reports, records: !!reads.records?.mine });
  const off = !!reads.records?.none && !reads.errors.records && page.is_owner !== true;
  return { ...built, ready: reads.ready && !!runs, errors: reads.errors, lastVisit, off };
}

function Item({ item, onOpen }) {
  const what = item.kind === 'record' ? [item.status, item.due ? `${item.late ? 'Overdue since' : 'Due'} ${shortDay(item.due)}` : '', item.unowned ? 'Nobody owns it yet' : '']
    .filter(Boolean).join(' · ') : item.sub;
  return (
    <li>
      <button type="button" className="inbox-i" onClick={() => onOpen(item)} data-inbox-item={item.key} data-inbox-kind={item.kind}>
        <span className="inbox-t"><b><bdi dir="auto">{item.label}</bdi></b>{item.fresh && <span className="chg-b chg-b--you">New</span>}
          {item.kept && <span className="chg-b chg-b--missing">{NOT_IN_RUN}</span>}</span>
        {what && <small><bdi dir="auto">{what}</bdi></small>}
      </button>
    </li>
  );
}

export default function InboxSection({ page, inbox, onOpen }) {
  if (!inbox) return null;
  const since = inbox.lastVisit > 0 ? `Your last visit was ${shortDay(new Date(inbox.lastVisit).toISOString().slice(0, 10))}; items changed since then say New.`
    : 'This is your first visit on this device, so no item says New yet.';
  const shown = INBOX_GROUPS.filter(([id]) => inbox.on[id] || inbox.groups[id].length > 0);
  return (
    <section className="card inbox-page" aria-label="Inbox" aria-busy={!inbox.ready} data-inbox-panel>
      <header className="card-h">
        <div>
          <h2>Inbox</h2>
          <p>Everything that waits for you on {page.title}. Each item opens the page where you deal with it. {since}</p>
        </div>
      </header>
      {inbox.errors.records && <PlainNote text={inbox.errors.records} prefix="Your records could not load: " className="tile-err" role="alert" />}
      {inbox.errors.reports && <PlainNote text={inbox.errors.reports} prefix="The reported issues could not load: " className="tile-err" role="alert" />}
      {!inbox.ready && <p className="more" role="status">Loading…</p>}
      <div className="inbox-gs">
        {shown.map(([id, title]) => (
          <section key={id} className="inbox-g" data-inbox-group={id} aria-labelledby={`inbox-h-${id}`}>
            <h3 id={`inbox-h-${id}`}>{title}<span className="faint">{` ${inbox.groups[id].length}`}</span></h3>
            {inbox.groups[id].length ? <ul>{inbox.groups[id].map((item) => <Item key={`${item.kind}:${item.key}`} item={item} onOpen={onOpen} />)}</ul>
              : <p className="faint">{EMPTY[id === 'due' && page.is_owner === true ? 'due_owner' : id]}</p>}
          </section>
        ))}
      </div>
    </section>
  );
}
