// c33 base STUB (lane B owns this file). REQ-577 "Find suitable data for me".
// Contract (lane B builds it; the shapes are in app/frontend/src/lib/startWizard.js):
//   POST /api/inspire/plan/sort    { warehouse_id, catalogs[], business_name }
//        Reads information_schema only (table names, columns, comments; never a data row), asks the model to sort the tables
//        into ordered runs of at most PLAN_RUN_MAX (25) tables, and answers the Plan shape.
//   POST /api/inspire/plan/start   { inspire_database, warehouse_id, business_name, plan, params, profile_id }
//        Stores every run in <inspire_db>.__inspire_plan (plan_id, run_no, name, tables, params_json, session_id, run_id, status, event_at)
//        and launches run 1 only, through deps.launchRun. Answers { plan_id, runs: [{ run_no, name, session_id, run_id, status }] }.
//   POST /api/inspire/plan/advance { inspire_database, warehouse_id }
//        Launches the next waiting run of each plan whose running run ended (deps.readRun). Idempotent. Answers { started: [...] }.
// deps: { requireToken, executeSql, sqlResultToObjects, chatModel(req, messages, maxTokens) -> { endpoint, got } | { reason },
//         launchRun(req, body) -> { status, body }, readRun(req, runId) -> { ok, data }, now() }

const NOT_BUILT = { error: 'Find suitable data for me is not built yet.' };

function registerWizPlanRoutes(app, deps) {
  const { requireToken } = deps;
  app.post('/api/inspire/plan/sort', requireToken, (_req, res) => res.status(501).json(NOT_BUILT));
  app.post('/api/inspire/plan/start', requireToken, (_req, res) => res.status(501).json(NOT_BUILT));
  app.post('/api/inspire/plan/advance', requireToken, (_req, res) => res.status(501).json(NOT_BUILT));
}

module.exports = { registerWizPlanRoutes };
