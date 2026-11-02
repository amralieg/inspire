import { useEffect, useRef, useState } from 'react';

export const GROUPING_PROFILE_ROUTE = '/api/grouping/profile';
export const PROFILE_READING = 'Inspire is reading the table to suggest a grouping and a first run.';
export const PROFILE_WAITING = 'Reading the table';

export function profileKey({ inspireDatabase, sessionId, useCaseId, warehouseId, enabled = true }) {
  const parts = [inspireDatabase, sessionId, useCaseId, warehouseId].map((part) => String(part ?? '').trim());
  return enabled && parts[0] && parts[1] && parts[2] ? JSON.stringify(parts) : '';
}

export function profileBody(key) {
  const [inspireDatabase, sessionId, useCaseId, warehouseId] = JSON.parse(key);
  return { inspire_database: inspireDatabase, session_id: sessionId, use_case_id: useCaseId, warehouse_id: warehouseId };
}

export function profileState(key, got) {
  if (!key) return { state: 'off', profile: null, error: '' };
  if (!got || got.key !== key) return { state: 'loading', profile: null, error: '' };
  if (got.profile) return { state: 'ready', profile: got.profile, error: '' };
  return { state: got.status === 404 ? 'none' : 'error', profile: null, error: got.error };
}

export function useGroupingProfile({ apiPostJson, inspireDatabase, sessionId, useCaseId, warehouseId, enabled = true }) {
  const key = profileKey({ inspireDatabase, sessionId, useCaseId, warehouseId, enabled });
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
  return { ...profileState(key, got), wait };
}
