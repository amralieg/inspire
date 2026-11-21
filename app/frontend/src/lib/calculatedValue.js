import { useCallback, useEffect, useRef, useState } from 'react';
import { kpiTargetOf } from './targetKpi.js';
import { primaryTableOf, tablesOf } from './implementWizard.js';
import { fieldOf } from './useCaseFields.js';

const TABLE = /[\w$-]+\.[\w$-]+\.[\w$-]+/;

// The main table of a use case as catalog.schema.table, or '' when it names none.
export const tableOfUseCase = (uc) => primaryTableOf(uc) || tablesOf(uc)[0] || (String(fieldOf(uc, 'Tables Involved', 'tables_involved') ?? '').match(TABLE) || [''])[0];

export const ANSWERS_ROUTE = '/api/inspire/value/answers';
const query = ({ inspireDatabase, warehouseId, sessionId }, extra = {}) => new URLSearchParams({ inspire_database: inspireDatabase || '', warehouse_id: warehouseId || '',
  session_id: String(sessionId ?? ''), ...extra }).toString();

// REQ-435: the Value at stake answers live in a table on the server, latest version per use case: { <use_case_id>: { version, answers, yearly, ... } }.
// A read that fails gives {} so a page that cannot read them still opens.
export async function fetchSavedAnswers(apiFetch, where) {
  if (typeof apiFetch !== 'function' || !where?.sessionId || !where?.inspireDatabase) return {};
  try {
    const got = await apiFetch(`${ANSWERS_ROUTE}?${query(where)}`, { raise: false });
    return got?.answers && typeof got.answers === 'object' ? got.answers : {};
  } catch {
    return {};
  }
}

// The answers the estimate route reads: the money rule and the KPI (name and direction) the person picked.
export function answersOf(spec, kpiOptions = []) {
  const name = kpiTargetOf(spec);
  const option = kpiOptions.find((o) => String(o.name).toLowerCase() === name.toLowerCase());
  return { money: spec.money || null, kpi: name ? { name, direction: option?.direction || '' } : null };
}

// REQ-443: the one save (PUT) of a use case's answers, a plain function so a run that outlives the page can make it. Returns { version, yearly };
// throws the server's one line of why when the save fails. where: { inspireDatabase, warehouseId, sessionId }.
export async function saveAnswers(apiPutJson, where, useCaseId, table, answers) {
  const got = await apiPutJson(ANSWERS_ROUTE, { inspire_database: where.inspireDatabase, warehouse_id: where.warehouseId, session_id: String(where.sessionId),
    use_case_id: useCaseId, table, answers });
  if (!got?.yearly) throw new Error('Inspire got no value back for this use case.');
  return got;
}

// The per-year values a person calculated, by use case id, read from the server: { status: 'ready', yearly, version, answers }.
// run saves new answers (a new version) and returns { version, yearly }; it throws the server's one line of why when the save fails.
export function useCalculatedValues({ apiFetch, apiPostJson, apiPutJson, inspireDatabase, warehouseId, sessionId }) {
  const [byId, setById] = useState({});
  const api = useRef({ apiFetch, apiPostJson, apiPutJson });
  useEffect(() => { api.current = { apiFetch, apiPostJson, apiPutJson }; }, [apiFetch, apiPostJson, apiPutJson]);
  useEffect(() => {
    let live = true;
    setById({});
    fetchSavedAnswers(api.current.apiFetch, { inspireDatabase, warehouseId, sessionId }).then((answers) => {
      if (!live) return;
      // REQ-443: a value a background run absorbed before this read came back is newer, so it stays.
      const read = Object.fromEntries(Object.entries(answers).filter(([, a]) => a?.yearly).map(([id, a]) => [id, { status: 'ready', yearly: a.stale ? { ...a.yearly, stale: true } : a.yearly, version: a.version, answers: a.answers }]));
      setById((prev) => ({ ...read, ...prev }));
    });
    return () => { live = false; };
  }, [inspireDatabase, warehouseId, sessionId]);
  const keep = (useCaseId, got, answers) => setById((prev) => ({ ...prev, [useCaseId]: { status: 'ready', yearly: got.yearly, version: got.version, answers: got.answers || answers } }));
  const ids = useCallback((extra = {}) => ({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId), ...extra }), [inspireDatabase, warehouseId, sessionId]);
  const run = useCallback(async (useCaseId, table, answers) => {
    const got = await saveAnswers(api.current.apiPutJson, { inspireDatabase, warehouseId, sessionId }, useCaseId, table, answers);
    keep(useCaseId, got, answers);
    return got;
  }, [inspireDatabase, warehouseId, sessionId]);
  const history = useCallback(async (useCaseId) => {
    const got = await api.current.apiFetch(`${ANSWERS_ROUTE}/history?${query({ inspireDatabase, warehouseId, sessionId }, { use_case_id: useCaseId })}`, { raise: false });
    return Array.isArray(got?.history) ? got.history : [];
  }, [inspireDatabase, warehouseId, sessionId]);
  const undo = useCallback(async (useCaseId) => {
    const got = await api.current.apiPostJson(`${ANSWERS_ROUTE}/undo`, ids({ use_case_id: useCaseId }));
    if (!got?.yearly) throw new Error('Inspire got no earlier value back for this use case.');
    keep(useCaseId, got, got.answers);
    return got;
  }, [ids]);
  // REQ-443: a value a background run saved while this page was away or open: the same keep as run.
  const absorb = useCallback((useCaseId, got) => keep(useCaseId, got, got.answers), []);
  return { byId, run, history, undo, absorb };
}
