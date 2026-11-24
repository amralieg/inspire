// REQ-508 L3: the one run step model the Monitor and the Review page share. Each phase is driven by the real step rows the run wrote.
// PHASE_OF_STAGE mirrors PROGRESS_STAGE_PHASES in app/agent/agent/dbx_inspire_ai_agent.ipynb; test/req508L3RunPhases.test.mjs parses the notebook to catch drift.
import { mergeSteps } from './monitorState.js';

export const RUN_PHASES = [
  { key: 'setup', label: 'Setup', column: 1 },
  { key: 'context', label: 'Understand the business', column: 2 },
  { key: 'tables', label: 'Read the data', column: 3 },
  { key: 'generation', label: 'Write use cases', column: 4 },
  { key: 'domains', label: 'Group into domains', column: 5 },
  { key: 'prioritization', label: 'Score and rank', column: 6 },
  { key: 'implementation', label: 'Build Genie instructions', column: 7 },
  { key: 'readout', label: 'Write documents', column: 7 },
];

const PHASE_OF_STAGE = {
  'Setup': 'setup',
  'Business Understanding': 'context',
  'Data Preparation': 'tables',
  'Use Case Design': 'generation',
  'Use Cases Generation': 'generation',
  'Domain Mapping': 'domains',
  'Business Domain Clustering': 'domains',
  'Goal Filtering': 'generation',
  'Use Case Prioritization': 'prioritization',
  'Strategy Alignment': 'prioritization',
  'Quality Gates': 'prioritization',
  'Final Gate': 'prioritization',
  'Scoring': 'prioritization',
  'Executive Readout': 'readout',
  'Localization': 'readout',
  'Implementation Planning': 'implementation',
  'Discover Skeletons': 'implementation',
  'Implement Use Cases': 'implementation',
  // REQ-511: the Monitor fixtures name the stages by the agent's narrative titles; these map to the same phases as the notebook names above.
  'Use Case Generation': 'generation',
  'Domain Clustering': 'domains',
  'Prioritization': 'prioritization',
  'Implementation': 'implementation',
};
const GENERATE_PREFIX = 'Generate ';

export function phaseOfStage(name) {
  const stage = String(name || '');
  if (Object.hasOwn(PHASE_OF_STAGE, stage)) return PHASE_OF_STAGE[stage];
  return stage.startsWith(GENERATE_PREFIX) ? 'implementation' : null;
}

const ROW_STATE = {
  ended_error: 'error', failed: 'error', error: 'error',
  ended_warning: 'warning',
  ended_success: 'done', completed: 'done',
};
const rowState = (status) => ROW_STATE[String(status || '')] || 'active';
const RANK = { error: 4, active: 3, warning: 2, done: 1 };

/** The eight phases with a state each: todo, active, done, warning, error or skipped. Skipped is never shown as done. */
export function runPhasesOf(steps, { ended = false } = {}) {
  const found = {};
  for (const row of mergeSteps([], Array.isArray(steps) ? steps : [])) {
    const key = phaseOfStage(row?.stage_name);
    if (!key) continue;
    const state = rowState(row.status);
    if (!found[key] || RANK[state] > RANK[found[key]]) found[key] = state;
  }
  const failed = Object.values(found).includes('error');
  return RUN_PHASES.map((phase) => {
    if (found[phase.key]) return { ...phase, state: found[phase.key] };
    const laterRows = RUN_PHASES.some((p) => p.column > phase.column && found[p.key]);
    return { ...phase, state: laterRows || (ended && !failed) ? 'skipped' : 'todo' };
  });
}
