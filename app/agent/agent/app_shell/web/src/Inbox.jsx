import { useCallback, useEffect, useRef, useState } from 'react';
import { getFeedback, getRecords } from './api.js';
import { visitedAt } from './prefs.js';
import { useMyView } from './MyView.jsx';
import { inboxAsks, inboxGroups, recordsInbox } from './inbox.js';

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
      getRecords(asks.changed).then((changed) => (changed?.actions === false ? [changed]
        : Promise.all([changed, getRecords(asks.mine), asks.unowned ? getRecords(asks.unowned) : null])))
        .then(([changed, owned, nobody]) => settle(() => ({ records: changed?.actions === false || owned?.actions === false ? { none: true }
          : { changed: changed?.rows, mine: owned?.rows, unowned: nobody?.rows, today: owned?.window?.today } })))
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
  const built = inboxGroups({ changed: records.changed, mine: records.mine, unowned: records.unowned, meta: page.records, lastVisit, today, fix, runs, reports: reads.reports, records: !!reads.records?.mine });
  const off = !!reads.records?.none && !reads.errors.records && page.is_owner !== true;
  return { ...built, ready: reads.ready && !!runs, errors: reads.errors, lastVisit, off };
}
