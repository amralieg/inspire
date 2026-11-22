import { CASE_PLAN_ROUTE, bodyOf, initialAnswers } from './valueWizard.js';

// REQ-441: value for many use cases at once, from the defaults. A pure runner (no React, no network): the worker does one use case.
export const VALUE_BULK_WORKERS = 4;
export const SKIP_HAS_VALUE = 'already has a value';
export const SKIP_NO_TABLE = 'no table to count';

const messageOf = (err) => String(err?.message || err || 'The value could not be calculated.');

// items: [{ id, skip? }]. Item states: waiting, working, done (yearly), failed (message), skipped (reason; also a 422 from the worker), stopped.
// At most `concurrency` workers are in flight; the next item starts when one ends; a failure never stops the others.
// Abort (signal) starts nothing new and marks every waiting item 'stopped'; the ones in flight finish. Resolves with the final rows.
// onUpdate(rows) gets a fresh array of { id, state, ... } after every change.
export function runBulk({ items, worker, concurrency = VALUE_BULK_WORKERS, onUpdate = () => {}, signal = null }) {
  const rows = items.map((it) => (it.skip ? { id: it.id, state: 'skipped', reason: it.skip } : { id: it.id, state: 'waiting' }));
  const publish = () => onUpdate(rows.map((r) => ({ ...r })));
  const queue = items.map((it, i) => i).filter((i) => rows[i].state === 'waiting');
  publish();
  return new Promise((resolve) => {
    let inFlight = 0;
    const pump = () => {
      while (inFlight < concurrency && queue.length && !signal?.aborted) {
        const i = queue.shift();
        inFlight += 1;
        rows[i] = { id: items[i].id, state: 'working' };
        Promise.resolve().then(() => worker(items[i])).then(
          (got) => { rows[i] = { id: items[i].id, state: 'done', yearly: got?.yearly || got || null }; },
          (err) => {
            // A 422 is deterministic (the use case cannot be estimated from defaults): skipped with the server's reason, no Retry.
            rows[i] = err?.status === 422 ? { id: items[i].id, state: 'skipped', reason: messageOf(err) } : { id: items[i].id, state: 'failed', message: messageOf(err) };
          },
        ).then(() => { inFlight -= 1; publish(); pump(); });
      }
      if (signal?.aborted) queue.splice(0).forEach((i) => { rows[i] = { id: items[i].id, state: 'stopped' }; });
      if (!inFlight && !queue.length) { publish(); resolve(rows.map((r) => ({ ...r }))); return; }
      publish();
    };
    signal?.addEventListener?.('abort', pump);
    pump();
  });
}

// The worker for one use case: the case plan, its defaults, then the same save the wizard makes, with calculated false (an estimate).
// save(id, table, answers) is the plain save (saveAnswers), so the worker needs no mounted page.
export const valueWorker = ({ apiPostJson, inspireDatabase, warehouseId, sessionId, save }) => async (item) => {
  const got = await apiPostJson(CASE_PLAN_ROUTE, { inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId),
    use_case_id: item.id, table: item.table });
  if (!got?.plan) throw new Error('Inspire got no plan back for this use case.');
  const plan = got.plan;
  // REQ-448: no model planned this use case, so there is nothing honest to save; the runner shows it as skipped.
  if (!plan.model) throw Object.assign(new Error('Inspire could not reach a model to plan this use case, so it saves no estimate; open Calculate value to set the numbers.'), { status: 422 });
  const answers = initialAnswers(plan);
  const sent = { ...bodyOf(plan, answers, false).answers, plan: bodyOf(plan, answers).plan };
  const saved = await save(item.id, item.table, sent);
  return { ...saved, answers: saved.answers || sent };
};

// REQ-441: the one line that says what a run did. Rows skipped before the run (items[].skip) are not counted; rows the server skipped (422) are.
// No server skips: "D of T done". Some: "D of T calculated, S skipped", plus the reason in brackets when all share one.
export function bulkSummary(rows = [], items = []) {
  const pre = new Set(items.filter((it) => it.skip).map((it) => it.id));
  const counted = rows.filter((r) => !pre.has(r.id));
  const late = counted.filter((r) => r.state === 'skipped');
  const done = counted.filter((r) => r.state === 'done').length;
  if (!late.length) return `${done} of ${counted.length} done`;
  const total = counted.length;
  const reasons = [...new Set(late.map((r) => String(r.reason || '').replace(/\.$/, '')))].filter(Boolean);
  const why = done === 0 && reasons.length === 1 ? ` (${reasons[0].charAt(0).toLowerCase()}${reasons[0].slice(1)})` : '';
  return `${done} of ${total} calculated, ${late.length} skipped${why}`;
}
