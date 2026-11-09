const LIFE_CYCLE_WORDS = {
  PENDING: 'Waiting to start',
  QUEUED: 'Waiting to start',
  BLOCKED: 'Waiting to start',
  WAITING_FOR_RETRY: 'Waiting to retry',
  RUNNING: 'Running',
  TERMINATING: 'Finishing',
  TERMINATED: 'Ended',
  SKIPPED: 'Skipped',
  INTERNAL_ERROR: 'Ended by Databricks',
};

const RESULT_WORDS = {
  SUCCESS: 'Finished',
  SUCCESS_WITH_FAILURES: 'Finished with failures',
  FAILED: 'Failed',
  RUN_EXECUTION_ERROR: 'Failed',
  TIMEDOUT: 'Timed out',
  CANCELED: 'Stopped',
  CANCELLED: 'Stopped',
  USER_CANCELED: 'Stopped',
  UPSTREAM_FAILED: 'Not run, an earlier task failed',
  UPSTREAM_CANCELED: 'Not run, an earlier task was stopped',
  EXCLUDED: 'Not run',
  MAXIMUM_CONCURRENT_RUNS_REACHED: 'Not run, another run of this job was going',
  DISABLED: 'Not run, the job is paused',
};

const key = (value) => String(value ?? '').trim().toUpperCase();

export const RUN_STATE_UNKNOWN = 'In a state Inspire does not know';

export const runResultText = (result) => RESULT_WORDS[key(result)] || '';

export function runStateText(lifeCycle, result) {
  const life = key(lifeCycle);
  const end = key(result);
  return runResultText(end) || LIFE_CYCLE_WORDS[life] || runResultText(life) || (life || end ? RUN_STATE_UNKNOWN : '');
}

export function newSessionId(now = Date.now(), random = Math.random()) {
  return String(now) + String(Math.floor(random * 1e6));
}
