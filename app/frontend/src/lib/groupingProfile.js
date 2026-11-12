import { useEffect, useRef, useState } from 'react';
import { FIRST_RUN_LABEL, GROUP_BY, GROUP_ALL, groupByColumns, groupsReadNeeded, withGroupingDefault } from './runScope.js';

export const GROUPING_PROFILE_ROUTE = '/api/grouping/profile';
export const PROFILE_READING = `Inspire is reading the table to suggest Data groups and a ${FIRST_RUN_LABEL}.`;
export const PROFILE_WAITING = 'Reading the table';
export const noMainTableText = (name) => `${String(name ?? '').trim() || 'This use case'} names no main table as catalog.schema.table, so Inspire cannot read it for Data groups.`;

export function profileKey({ inspireDatabase, sessionId, useCaseId, warehouseId, enabled = true, groupBy = '', table = '' }) {
  const [db, sid, uc, wh, main] = [inspireDatabase, sessionId, useCaseId, warehouseId, table].map((part) => String(part ?? '').trim());
  if (!enabled || !db || !sid || !uc) return '';
  const columns = groupByColumns(groupBy).filter((c) => c.toLowerCase() !== GROUP_ALL);
  return new URLSearchParams({ inspire_database: db, session_id: sid, use_case_id: uc, warehouse_id: wh, ...(main ? { table: main } : {}),
    ...(columns.length ? { [GROUP_BY]: columns.join(', ') } : {}) }).toString();
}

export function profileBody(key) {
  return Object.fromEntries(new URLSearchParams(key));
}

export function profileState(key, got) {
  if (!key) return { state: 'off', profile: null, error: '' };
  if (!got || got.key !== key) return { state: 'loading', profile: null, error: '' };
  if (got.profile) return { state: 'ready', profile: got.profile, error: '' };
  return { state: got.status === 404 ? 'none' : 'error', profile: null, error: got.error };
}

export function useGroupingProfile({ apiPostJson, inspireDatabase, sessionId, useCaseId, warehouseId, enabled = true, groupBy = '', table = '', noMainTable = '' }) {
  const key = profileKey({ inspireDatabase, sessionId, useCaseId, warehouseId, enabled: enabled && !noMainTable, groupBy, table });
  const [got, setGot] = useState(null);
  const post = useRef(apiPostJson);
  const pending = useRef({ key: '', promise: null });
  useEffect(() => {
    post.current = apiPostJson;
  }, [apiPostJson]);
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const promise = post.current(GROUPING_PROFILE_ROUTE, profileBody(key))
      .then((profile) => ({ key, profile: profile && typeof profile === 'object' ? profile : null, error: '', status: 200 }))
      .catch((e) => ({ key, profile: null, error: String(e?.message || e), status: Number(e?.status) || 0 }));
    pending.current = { key, promise };
    promise.then((answer) => { if (live) setGot(answer); });
    return () => { live = false; };
  }, [key]);
  const wait = async () => {
    if (!key) return profileState(key, null);
    if (got?.key === key) return profileState(key, got);
    return profileState(key, pending.current.key === key ? await pending.current.promise : null);
  };
  if (noMainTable) return { state: 'no_table', profile: null, error: noMainTable, key: '', wait: async () => ({ state: 'no_table', profile: null, error: noMainTable }) };
  return { ...profileState(key, got), key, wait };
}

export function useScopeProfiles({ groupBy = '', defaultGrouping = false, ...ask }) {
  const base = useGroupingProfile(ask);
  const shown = defaultGrouping && base.state === 'ready' ? withGroupingDefault({ [GROUP_BY]: groupBy }, base.profile, groupBy)[GROUP_BY] : groupBy;
  const reread = base.state === 'ready' && groupsReadNeeded(base.profile, shown);
  const chosen = useGroupingProfile({ ...ask, enabled: ask.enabled !== false && reread, groupBy: shown });
  return { ...base, firstRun: reread ? chosen : base };
}
