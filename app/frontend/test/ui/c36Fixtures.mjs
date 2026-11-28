// c36 UI lane (REQ-581) shared fixtures for U2 (skipped steps), U3 (provisional candidate cards) and U4 (pending artifacts).
// Shapes follow the agent/UI interface (U2: step row status "skipped"; U3: <inspire_db>.__inspire_candidates as answered by
// GET /api/inspire/candidates; U4: pending_artifacts as answered by GET /api/inspire/results). Industry-neutral names only.
// Written by the c36 spec writer; no builder edits it.

const MINUTE = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// The Monitor reads the run's job (GET /api/run/777) and asks whether the run may be stopped (GET /api/run/777/cancel).
export const RUN_LIVE = { status: 200, body: { run_id: 777, run_name: 'Inspire Discover', life_cycle_state: 'RUNNING', start_time: Date.now() - 30 * MINUTE, tasks: [] } };
export const RUN_DONE = { status: 200, body: { run_id: 777, run_name: 'Inspire Discover', life_cycle_state: 'TERMINATED', result_state: 'SUCCESS',
  start_time: Date.now() - 60 * MINUTE, end_time: Date.now() - MINUTE, tasks: [] } };
export const MONITOR_MOUNT = (app) => app.get('/api/run/:runId/cancel', (_req, res) => res.json({ allowed: true }));

export const SESSION_LIVE = { session_id: '42', business_name: 'Example Co', processing_status: 'processing', completed_percent: 55, completed_on: null,
  create_at: ago(30 * MINUTE), last_updated: ago(MINUTE) };
export const SESSION_DONE = { session_id: '42', business_name: 'Example Co', processing_status: 'done', completed_percent: 100, completed_on: ago(MINUTE),
  create_at: ago(60 * MINUTE), last_updated: ago(MINUTE), results_json: { title: 'Example Co' } };

let stepNo = 0;
export const stepRow = (stage, name, status, minutesAgo, extra = {}) => {
  stepNo += 1;
  return { step_id: `c36-${stepNo}`, session_id: '42', stage_name: stage, step_name: name, sub_step_name: '', status, message: `${name}`,
    progress_increment: 5, last_updated: ago(minutesAgo * MINUTE), result_json: { event_at: ago(minutesAgo * MINUTE) }, ...extra };
};

// U2: a switched-off domain step (c36_flags discover_domain_steps) writes its step row with status "skipped".
export const SKIPPED_STEP_NAME = 'Subdomain Detector';
const ranBefore = () => [
  stepRow('Setup', 'Read the settings', 'ended_success', 40),
  stepRow('Business Understanding', 'Business context', 'ended_success', 38),
  stepRow('Data Preparation', 'Read the tables', 'ended_success', 35),
  stepRow('Use Cases Generation', 'Write use cases', 'ended_success', 30),
];
// A finished run: every phase ran except the domain step, which was switched off.
export const SKIP_DONE_STEPS = [
  ...ranBefore(),
  stepRow('Business Domain Clustering', SKIPPED_STEP_NAME, 'skipped', 25, { message: 'Switched off for this run' }),
  stepRow('Use Case Prioritization', 'Score and rank', 'ended_success', 20),
  stepRow('Executive Readout', 'Write the summary', 'ended_success', 10),
  stepRow('Implementation Planning', 'Plan the build', 'ended_success', 5),
];
// A live run: the domain step was skipped and every other saved step has ended, so nothing is in progress.
export const SKIP_LIVE_STEPS = [
  ...ranBefore(),
  stepRow('Business Domain Clustering', SKIPPED_STEP_NAME, 'skipped', 25, { message: 'Switched off for this run' }),
];
// Must-keep: the statuses the Monitor already knows render as before.
export const KEEP_LIVE_STEPS = [
  stepRow('Setup', 'Read the settings', 'ended_success', 40),
  stepRow('Business Understanding', 'Business context', 'ended_warning', 38),
  stepRow('Data Preparation', 'Read the tables', 'ended_error', 35),
  stepRow('Use Cases Generation', 'Write use cases', 'started', 30),
];

// U3: the candidate rows as GET /api/inspire/candidates answers them for session 42 (one row per candidate, latest state).
const cand = (candidate_id, state, name, provisional_rank = null, merged_into = null, minutesAgo = 10) => ({
  candidate_id, state, name, provisional_rank, merged_into, event_at: ago(minutesAgo * MINUTE),
  history: [{ state: 'proposed', stage: 'Use Cases Generation', name }, ...(state === 'proposed' ? [] : [{ state, stage: 'Scoring', name }])],
});
export const CANDIDATES_EARLY = [
  cand('c-1', 'eligible', 'Forecast weekly demand', 2),
  cand('c-2', 'eligible', 'Reduce customer churn', 1),
  cand('c-3', 'eligible', 'Score supplier risk', 3),
  cand('c-4', 'merged', 'Predict customer exits', null, 'c-2'),
  cand('c-5', 'overlapping', 'Forecast store demand', null, 'c-1'),
  cand('c-6', 'measured', 'Plan staff rosters'),
  cand('c-7', 'lower_marginal', 'Rank shelf layouts'),
  cand('c-8', 'blocked', 'Track parcel delays'),
  cand('c-9', 'proposed', 'Estimate delivery times'),
];
export const PROVISIONAL_ORDER = ['c-2', 'c-1', 'c-3'];
export const NOT_PROVISIONAL = ['c-4', 'c-5', 'c-6', 'c-7', 'c-8', 'c-9'];
export const MERGED = { 'c-4': { into: 'c-2', intoName: 'Reduce customer churn' }, 'c-5': { into: 'c-1', intoName: 'Forecast weekly demand' } };
// Later: c-2 was selected and its final use case was written; the step row carries it as a live use case.
export const CANDIDATES_LATER = CANDIDATES_EARLY.map((c) => (c.candidate_id === 'c-2' ? { ...c, state: 'selected', provisional_rank: 1, event_at: ago(2 * MINUTE) } : c));
export const CANDIDATE_STEPS_EARLY = [
  stepRow('Setup', 'Read the settings', 'ended_success', 20),
  stepRow('Use Cases Generation', 'Write use cases', 'started', 15),
];
export const FINAL_USE_CASE_STEP = stepRow('Use Case Prioritization', 'Score and rank', 'ended_success', 2, {
  result_json: { event_at: ago(2 * MINUTE), prompt_name: 'BASE_USE_CASE_GEN_PROMPT',
    use_cases: [{ id: 'N01-U01', name: 'Reduce customer churn', business_domain: 'Customer', priority: 'High' }] },
});

// U4: the session row's pending_artifacts as GET /api/inspire/results answers them. The harness Results use cases are
// N01-U01 "Predict churn" and N01-U02 "Score upsell" (implementFixtures.js RESULTS).
export const PENDING_TEXT = /pending, produced at Implement/i;
export const PENDING_SOME = [
  { kind: 'genie_instructions', use_case_id: 'N01-U01' },
  { kind: 'notebook', use_case_id: 'N01-U01' },
  { kind: 'docs', use_case_id: null },
];
export const PENDING_NONE = [];
