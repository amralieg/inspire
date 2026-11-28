// c33 (REQ-577, REQ-578, REQ-579): the shared contract of the Start New Discovery wizard. Lane A (shell), lane B (Find suitable data for me, Plan)
// and lane C (Match) all import from here. No lane edits this file; a change goes through the coordinator.
//
// The draft: one object the shell owns and every step reads and patches with setDraft(patch | (draft) => patch).
//   path            'discover' | 'match'                       (step 1)
//   businessName    string                                     (Business, or Your use cases on the match path)
//   profileId       string                                     (Load a saved profile; '' for none)
//   dataChoice      'find' | 'choose'                          (Data step; 'find' is the default)
//   catalogs        string[]                                   (Data step, find path: catalogs only)
//   plan            null | Plan                                (lane B, Plan step)
//   useCases        [{ input_no, name, description }]          (lane C, Your use cases; input_no starts at 1)
//   useCaseSource   'paste' | 'upload' | 'run'                 (lane C)
//   (REQ-579: the match itself is a run. The wizard's Match path ends at Review and start, which launches it; the Monitor shows each use case's
//    match progress (components/match/MatchMonitorBoxes.jsx) and the Review tab holds the per-piece review and Accept (MatchResultsPanel.jsx).)
//
// Plan (lane B, POST /api/inspire/plan/sort answer):
//   { catalogs: string[], read_tables: number,
//     runs: [{ run_no, name, why, tables: [{ table, why }] }],              at most PLAN_RUN_MAX tables in each run, run_no in run order
//     left_out: [{ reason, label, count, example, tables: string[] }] }
// Report (lane C, report_json of <inspire_db>.__inspire_match, written by the agent; read on the Monitor and Review tabs):
//   { input_no, name, verdict: 'full'|'partial'|'none', confidence: 0-100,
//     pieces: [{ piece_no, requirement, status: 'matched'|'partial'|'missing', confidence,
//                evidence: [{ table, columns: string[], why }], gap, known_data_option: { table, columns, why } | null }] }
//
// Step components (lane B and C) take these props:
//   draft, setDraft, settings, apiFetch,
//   onReady(boolean)        Next is on only after the step calls onReady(true)
//   registerStart(fn|null)  final steps only: fn() => Promise<{ sessionId, runId, warnings? }>; the shell's Start button awaits it
//   launchParams()          the notebook params the Settings step holds now (LaunchPage state): 02_..13_, 16_ and 11_generation_path; on the
//                           choose and match paths also 01_uc_metadata and 04_table_election from the Data step picker (the find path's
//                           tables come from the plan, never from these params)
//   onEditStep(stepId)      jump back to a step (review screens)
// Each step component's root element carries data-wiz-step="<step id>".

export const WIZ_TITLE = 'Start New Discovery';
export const WIZ_TITLE_MATCH = 'Start New Discovery: match use cases';
export const START_NEW_DISCOVERY = 'Start New Discovery';

export const PATH_DISCOVER = 'discover';
export const PATH_MATCH = 'match';
export const PATH_TEXT = {
  [PATH_DISCOVER]: 'Discover use cases from data',
  [PATH_MATCH]: 'Match existing use cases to data',
};

export const DATA_FIND = 'find';
export const DATA_CHOOSE = 'choose';
export const DATA_TEXT = {
  [DATA_FIND]: 'Find suitable data for me',
  [DATA_CHOOSE]: "I'll choose it myself",
};

// REQ-578: the Data step advises production catalogs only, on both paths.
export const PRODUCTION_CATALOG_ADVICE = 'Pick production catalogs only. Dev, test and sandbox copies give weaker use cases and weaker matches.';
export const NO_DATA_ROWS_NOTE = 'Inspire reads table names, columns and comments. It reads no data rows.';

export const STEP = {
  start: { id: 'start', label: 'Start' },
  business: { id: 'business', label: 'Business' },
  data: { id: 'data', label: 'Data' },
  plan: { id: 'plan', label: 'Plan' },
  goals: { id: 'goals', label: 'Goals' },
  settings: { id: 'settings', label: 'Settings' },
  review: { id: 'review', label: 'Review' },
  usecases: { id: 'usecases', label: 'Your use cases' },
  matchReview: { id: 'matchReview', label: 'Review' },
};

// The step pills. Before a path is picked only Start shows, so the count never changes once it shows (Build wizard rule).
// The Plan step shows only on the find path of Discover.
export function stepsOf(path, dataChoice = DATA_FIND) {
  if (path === PATH_MATCH) return [STEP.start, STEP.usecases, STEP.data, STEP.matchReview];
  if (path !== PATH_DISCOVER) return [STEP.start];
  return [STEP.start, STEP.business, STEP.data, ...(dataChoice === DATA_FIND ? [STEP.plan] : []), STEP.goals, STEP.settings, STEP.review];
}

// Runs hold at most 25 tables each (LaunchPage TABLE_SELECTION_IDEAL_MAX); more tables mean more runs.
export const PLAN_RUN_MAX = 25;
// Each plan run's business name: "business: run name", so the runs list on Start stays readable.
export const planRunName = (business, run) => `${String(business || '').trim()}: ${String(run || '').trim()}`;
export const TABLE_ELECTION_BY_PLAN = 'Set by your plan';
// The Plan step's progress lines while POST plan/sort runs, in this order.
export const PLAN_STAGES = ['Reading your catalogs', 'Reading table names, columns and comments', 'Grouping tables by business area',
  'Ordering the runs', 'Writing your plan'];
export const planFinding = (business) => `Finding the right data for ${String(business || '').trim()}`;

export const OPERATION_DISCOVER = 'Discover Use Cases';
export const OPERATION_MATCH = 'Match Use Cases';
export const MATCH_PHASE_PARAM = '19_match_phase';
export const MATCH_PHASES = ['match', 'accept'];
// A piece is matched at this confidence or more (agent contract).
export const MATCHED_CONFIDENCE_MIN = 80;
export const MATCH_DECISIONS = ['keep', 'drop', 'use_known_data'];
export const MATCH_INPUT_MAX = 50;
export const VERDICT_TEXT = { full: 'Full match', partial: 'Partial match', none: 'No match' };
export const PIECE_STATUS_TEXT = { matched: 'Matched', partial: 'Partial', missing: 'Missing' };
export const DECISION_TEXT = { keep: 'Keep as a gap', drop: 'Drop this requirement', use_known_data: 'Use known data' };
// REQ-579: the status each use case box shows on the Monitor of a Match run. The boxes come from __inspire_match_input (GET match/result inputs);
// the status comes from the run's __inspire_step rows (agent 01 shape), latest result_json.event_at per input wins:
//   stage_name 'Match Use Cases', step_name 'Match <input_no>'; sub_step 'Started' -> result_json.status 'matching';
//   'Complete' -> 'matched' | 'partly matched' | 'not matched' (+ verdict, confidence); 'Error' -> 'not matched' (+ error).
//   An input with no step row yet is 'waiting'. The Accept phase writes step_name 'Accept' with result_json { accepted, dropped_inputs }.
export const MATCH_STAGE = 'Match Use Cases';
export const matchStepName = (inputNo) => `Match ${inputNo}`;
export const MATCH_PROGRESS = ['waiting', 'matching', 'matched', 'partly matched', 'not matched'];
export const MATCH_PROGRESS_TEXT = { waiting: 'Waiting', matching: 'Matching', matched: 'Matched', 'partly matched': 'Partly matched', 'not matched': 'Not matched' };
export const MATCH_REVIEW_TITLE = 'How your use cases match your data';
export const MATCH_ACCEPT = 'Accept and create use cases';

export const ROUTES = {
  planSort: '/api/inspire/plan/sort',
  planStart: '/api/inspire/plan/start',
  planAdvance: '/api/inspire/plan/advance',
  matchStart: '/api/inspire/match/start',
  matchResult: '/api/inspire/match/result',
  matchDecision: '/api/inspire/match/decision',
  matchAccept: '/api/inspire/match/accept',
};
