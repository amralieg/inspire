// c33 base STUB (lane B owns this file). REQ-577 Find suitable data for me: the client side of the plan routes.
import { ROUTES } from './startWizard';

// POST /api/inspire/plan/sort { warehouse_id, catalogs, business_name } -> Plan (lib/startWizard.js).
export async function sortTables(apiFetch, { warehouseId, catalogs, businessName }) {
  void apiFetch; void warehouseId; void catalogs; void businessName; void ROUTES;
  throw new Error('Find suitable data for me is not built yet');
}

// POST /api/inspire/plan/start { inspire_database, warehouse_id, business_name, plan, params, profile_id }
//   -> { plan_id, runs: [{ run_no, name, session_id, run_id, status: 'running'|'waiting' }] }. Only run 1 starts now.
export async function startPlan(apiFetch, { inspireDatabase, warehouseId, businessName, plan, params, profileId }) {
  void apiFetch; void inspireDatabase; void warehouseId; void businessName; void plan; void params; void profileId;
  throw new Error('Plan runs are not built yet');
}

// Mounted by the Start page (lane A): POST /api/inspire/plan/advance { inspire_database, warehouse_id } on mount and every minute,
// so the next waiting run of a plan starts once the one before it ended. The stub does nothing.
export function usePlanAdvance(apiFetch, { inspireDatabase, warehouseId } = {}) {
  void apiFetch; void inspireDatabase; void warehouseId;
}
