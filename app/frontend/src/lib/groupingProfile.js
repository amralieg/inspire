import { useEffect, useRef, useState } from 'react';
import { FIRST_RUN_LABEL, GROUP_BY, GROUP_ALL, groupByColumns, groupsReadNeeded } from './runScope.js';

export const GROUPING_PROFILE_ROUTE = '/api/grouping/profile';
export const PROFILE_READING = `Inspire is reading the table to suggest Data groups and an ${FIRST_RUN_LABEL}.`;
export const PROFILE_WAITING = 'Reading the table';

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

export function useGroupingProfile({ apiPostJson, inspireDatabase, sessionId, useCaseId, warehouseId, enabled = true, groupBy = '', table = '' }) {
  const key = profileKey({ inspireDatabase, sessionId, useCaseId, warehouseId, enabled, groupBy, table });
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
  return { ...profileState(key, got), key, wait };
}

export function useScopeProfiles({ groupBy = '', ...ask }) {
  const base = useGroupingProfile(ask);
  const reread = base.state === 'ready' && groupsReadNeeded(base.profile, groupBy);
  const chosen = useGroupingProfile({ ...ask, enabled: ask.enabled !== false && reread, groupBy });
  return { ...base, firstRun: reread ? chosen : base };
}
