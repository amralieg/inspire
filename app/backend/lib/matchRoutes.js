// c33 base STUB (lane C owns this file). REQ-578, REQ-579 Match existing use cases to data (a run of its own, REQ-579).
// Contract (agreed with the agent; report_json shape in app/frontend/src/lib/startWizard.js):
//   POST /api/inspire/match/start    { inspire_database, warehouse_id, business_name, use_cases: [{ input_no, name, description }], params }
//        Mints a session id, writes <inspire_db>.__inspire_match_input (session_id, input_no, name, description, event_at), then launches
//        through deps.launchRun with 15_operation='Match Use Cases', 19_match_phase='match', 14_session_id set. Answers { session_id, run_id }.
//   GET  /api/inspire/match/result   ?inspire_database&warehouse_id&session_id[&run_id]
//        Answers { state: 'none'|'running'|'done'|'failed', inputs: [{ input_no, name, description }] (from __inspire_match_input),
//                  reports: Report[] (from __inspire_match.report_json, latest event_at per input_no),
//                  decisions: [{ input_no, piece_no, decision, event_at }] (from __inspire_match_decision, latest event_at per piece wins) }.
//        state 'none' means the session has no match input (not a Match run): the Monitor and Results pages then show nothing extra.
//        With run_id the state follows the job run (deps.readRun); without it, 'done' once every input has a report.
//   POST /api/inspire/match/decision { inspire_database, warehouse_id, session_id, input_no, piece_no, decision: keep|drop|use_known_data }
//        Appends one row to __inspire_match_decision. Answers { ok: true }.
//   POST /api/inspire/match/accept   { inspire_database, warehouse_id, session_id, params }
//        Phase 2: launches with 19_match_phase='accept' in the same session. Answers { session_id, run_id }.
// deps: same as wizPlanRoutes.js.

const NOT_BUILT = { error: 'Match is not built yet.' };

function registerMatchRoutes(app, deps) {
  const { requireToken } = deps;
  app.post('/api/inspire/match/start', requireToken, (_req, res) => res.status(501).json(NOT_BUILT));
  app.get('/api/inspire/match/result', requireToken, (_req, res) => res.status(501).json(NOT_BUILT));
  app.post('/api/inspire/match/decision', requireToken, (_req, res) => res.status(501).json(NOT_BUILT));
  app.post('/api/inspire/match/accept', requireToken, (_req, res) => res.status(501).json(NOT_BUILT));
}

module.exports = { registerMatchRoutes };
