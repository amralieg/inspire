// c33 (REQ-577) Find suitable data for me: the client side of the plan routes (backend/lib/wizPlanRoutes.js).
// apiFetch (GET only) is part of the step contract; the three routes are POSTs, sent with makeApiPostJson. The optional `auth`
// ({ token, databricksHost }) carries the same sign-in the shell's apiFetch holds; with none, the request relies on the App's own sign-in.
import { useEffect } from 'react';
import { makeApiPostJson } from './apiClient';
import { ROUTES } from './startWizard';

const post = (auth) => makeApiPostJson({ token: auth?.token, databricksHost: auth?.databricksHost });

// How often the Start page asks for the next waiting run of a plan to start.
export const PLAN_ADVANCE_MS = 3 * 60 * 1000;

// POST /api/inspire/plan/sort { warehouse_id, catalogs, business_name } -> Plan (lib/startWizard.js).
export async function sortTables(apiFetch, { warehouseId, catalogs, businessName, auth }) {
  void apiFetch;
  return post(auth)(ROUTES.planSort, { warehouse_id: warehouseId, catalogs, business_name: businessName });
}

// POST /api/inspire/plan/start { inspire_database, warehouse_id, business_name, plan, params, profile_id }
//   -> { plan_id, runs: [{ run_no, name, session_id, run_id, status: 'running'|'waiting' }] }. Only run 1 starts now.
// Resolves { sessionId, runId } of run 1 (the shape the wizard's registerStart returns), with plan_id and runs added.
export async function startPlan(apiFetch, { inspireDatabase, warehouseId, businessName, plan, params, profileId, auth }) {
  void apiFetch;
  const got = await post(auth)(ROUTES.planStart, {
    inspire_database: inspireDatabase, warehouse_id: warehouseId, business_name: businessName, plan, params, profile_id: profileId || '',
  });
  const first = (got.runs || []).find((r) => Number(r.run_no) === 1) || (got.runs || [])[0] || {};
  return { sessionId: String(first.session_id ?? ''), runId: String(first.run_id ?? ''), planId: got.plan_id, runs: got.runs || [] };
}

// Mounted by the Start page (lane A): POST /api/inspire/plan/advance { inspire_database, warehouse_id } on mount and every few minutes,
// so the next waiting run of a plan starts once the one before it ended. A failed call is ignored; the next tick asks again.
export function usePlanAdvance(apiFetch, { inspireDatabase, warehouseId, token, databricksHost, showcase = '' } = {}) {
  useEffect(() => {
    if (!inspireDatabase || !warehouseId || showcase) return undefined; // the demo sends no write
    const send = post({ token, databricksHost });
    const tick = () => { send(ROUTES.planAdvance, { inspire_database: inspireDatabase, warehouse_id: warehouseId }, { raise: false }).catch(() => {}); };
    tick();
    const timer = setInterval(tick, PLAN_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [apiFetch, inspireDatabase, warehouseId, token, databricksHost, showcase]);
}
