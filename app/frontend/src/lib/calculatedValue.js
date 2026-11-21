import { useCallback, useEffect, useRef, useState } from 'react';
import { kpiTargetOf } from './targetKpi.js';
import { primaryTableOf, tablesOf } from './implementWizard.js';
import { fieldOf } from './useCaseFields.js';

const TABLE = /[\w$-]+\.[\w$-]+\.[\w$-]+/;

// The main table of a use case as catalog.schema.table, or '' when it names none.
export const tableOfUseCase = (uc) => primaryTableOf(uc) || tablesOf(uc)[0] || (String(fieldOf(uc, 'Tables Involved', 'tables_involved') ?? '').match(TABLE) || [''])[0];

export const ESTIMATE_ROUTE = '/api/inspire/value/estimate';
const KEY = 'inspire.stake.v1';
const storageKey = ({ host, inspireDatabase, sessionId, useCaseId }) => [KEY, host, inspireDatabase, sessionId, useCaseId].map((p) => String(p ?? '').trim()).join('|');

// The Value at stake answers a person gave in Calculate, kept on this browser so the next Build starts from them.
export function savedStakeAnswers(where) {
  try {
    const got = JSON.parse(window.localStorage.getItem(storageKey(where)) || 'null');
    return got && typeof got === 'object' ? got : null;
  } catch {
    return null;
  }
}

function saveStake(where, saved) {
  try {
    window.localStorage.setItem(storageKey(where), JSON.stringify(saved));
  } catch {
    // A browser that refuses storage still shows the value for this visit.
  }
}

// The answers the estimate route reads: the money rule and the KPI (name and direction) the person picked.
export function answersOf(spec, kpiOptions = []) {
  const name = kpiTargetOf(spec);
  const option = kpiOptions.find((o) => String(o.name).toLowerCase() === name.toLowerCase());
  return { money: spec.money || null, kpi: name ? { name, direction: option?.direction || '' } : null };
}

// The per-year values a person calculated, by use case id: busy, ready (the same shape the card reads) or failed with one line of why.
export function useCalculatedValues({ apiPostJson, host = '', inspireDatabase, warehouseId, sessionId, ids = [] }) {
  const [byId, setById] = useState({});
  const post = useRef(apiPostJson);
  useEffect(() => { post.current = apiPostJson; }, [apiPostJson]);
  const last = useRef({});
  const idsKey = ids.join('|');
  useEffect(() => {
    const read = {};
    for (const id of ids) {
      const saved = savedStakeAnswers({ host, inspireDatabase, sessionId, useCaseId: id });
      if (saved?.yearly) read[id] = { status: 'ready', yearly: saved.yearly };
    }
    setById(read);
  }, [host, inspireDatabase, sessionId, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useCallback(async (useCaseId, table, answers) => {
    const where = { host, inspireDatabase, sessionId, useCaseId };
    last.current[useCaseId] = { table, answers };
    saveStake(where, { answers });
    setById((prev) => ({ ...prev, [useCaseId]: { status: 'busy' } }));
    try {
      const got = await post.current(ESTIMATE_ROUTE, { inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId),
        use_case_id: useCaseId, table, answers });
      if (!got?.yearly) throw new Error('Inspire got no value back for this use case.');
      saveStake(where, { answers, yearly: got.yearly });
      setById((prev) => ({ ...prev, [useCaseId]: { status: 'ready', yearly: got.yearly } }));
    } catch (err) {
      setById((prev) => ({ ...prev, [useCaseId]: { status: 'failed', error: String(err?.message || err) } }));
    }
  }, [host, inspireDatabase, warehouseId, sessionId]);
  const retry = useCallback((useCaseId) => {
    const again = last.current[useCaseId] || null;
    const saved = again || savedStakeAnswers({ host, inspireDatabase, sessionId, useCaseId });
    if (saved?.answers && (again?.table || saved.table)) return run(useCaseId, again?.table || saved.table, saved.answers);
    return undefined;
  }, [host, inspireDatabase, sessionId, run]);
  return { byId, run, retry };
}
