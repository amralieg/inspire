import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODE, MODES, MODE_VIEWS, SECTION_TITLES, hasWork, layoutMode, pageMode, sectionTitle } from '../src/modes.js';
import { ANSWERS_KEPT, QUESTION_CHARS, answerQuality, answersOf, readAnswers, withRatings, writeAnswers } from '../src/answers.js';
import { COMPARE_MAX, compareRows, decisionCounts, toggleCompared } from '../src/scenarios.js';
import { canonicalHash } from '../src/links.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(readFileSync(join(HERE, '..', '..', 'kinds.json'), 'utf8'));
const LAYOUTS = Object.fromEntries(REGISTRY.layouts.map((l) => [l.id, { id: l.id, contract: l.contract || '' }]));
const kindMode = (kind) => layoutMode(LAYOUTS[kind.layout]);
const EXPECTED = { queue: 25, plan: 5, forecast: 2, scenarios: 2, explore: 5, ask: 1 };

test('every one of the 40 kinds maps to exactly one known mode', () => {
  assert.equal(REGISTRY.kinds.length, 40);
  for (const kind of REGISTRY.kinds) {
    assert.ok(LAYOUTS[kind.layout], `${kind.id} names a layout the registry has`);
    const mode = kindMode(kind);
    assert.ok(MODES[mode], `${kind.id} maps to ${mode}`);
    assert.equal(Object.values(MODES).filter((m) => m.id === mode).length, 1);
  }
});

test('the kinds per mode match the plan: 25 queue, 5 plan, 2 forecast, 2 scenarios, 5 explore, 1 ask', () => {
  const counts = Object.fromEntries(Object.keys(MODES).map((m) => [m, 0]));
  for (const kind of REGISTRY.kinds) counts[kindMode(kind)] += 1;
  assert.deepEqual(counts, EXPECTED);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 40);
});

test('each mode names its work section and its performance section', () => {
  const labels = Object.fromEntries(Object.values(MODES).map((m) => [m.id, [m.work, m.performance]]));
  assert.deepEqual(labels, {
    queue: ['Work', 'Performance'], plan: ['Plan', 'Performance'], forecast: ['Review', 'Accuracy'],
    scenarios: ['Scenarios', 'Performance'], explore: ['Explore', 'Usage'], ask: ['Ask', 'Answer quality'],
  });
  assert.deepEqual(Object.values(MODES).filter((m) => m.queue).map((m) => m.id), ['queue']);
  assert.ok(Object.isFrozen(MODES) && Object.isFrozen(MODES.ask));
});

test('a layout is read by its id first and its contract second, and anything unknown is a queue', () => {
  assert.equal(layoutMode({ id: 'dashboard', contract: '' }), 'explore');
  assert.equal(layoutMode({ id: 'agent_chat' }), 'ask');
  assert.equal(layoutMode({ id: 'planner', contract: 'plan' }), 'plan');
  assert.equal(layoutMode({ id: 'scenario_lab', contract: 'scenario' }), 'scenarios');
  assert.equal(layoutMode({ id: 'forecast_cockpit', contract: 'forecast' }), 'forecast');
  assert.equal(layoutMode({ id: 'monitor_triage', contract: 'monitor' }), 'queue');
  assert.equal(layoutMode({ id: 'forecast_cockpit' }), DEFAULT_MODE, 'a layout without its contract stays a queue');
  assert.equal(layoutMode({ id: 'made_up', contract: 'made_up' }), DEFAULT_MODE);
  assert.equal(layoutMode(null), DEFAULT_MODE);
  assert.equal(layoutMode(undefined), DEFAULT_MODE);
  assert.equal(layoutMode({ id: '__proto__', contract: 'constructor' }), DEFAULT_MODE);
});

test('every mode other than the queue has a view to load, and the plan and forecast ones are placeholders another lane fills', () => {
  assert.deepEqual(Object.keys(MODE_VIEWS).sort(), ['ask', 'explore', 'forecast', 'plan', 'scenarios']);
  assert.equal(MODE_VIEWS.queue, undefined);
  assert.ok(Object.isFrozen(MODE_VIEWS));
});

test('the rail labels and the work section follow the page mode, so switching use case re-labels the rail', () => {
  const page = (id, contract, extra = {}) => ({ id: `p_${id}`, layout: { id, contract }, ...extra });
  const explore = page('dashboard', '');
  const ask = page('agent_chat', '');
  const scen = page('scenario_lab', 'scenario', { scenario: { levers: [] } });
  const bare = page('scenario_lab', 'scenario');
  const queue = page('decision_queue', 'decision_queue', { records: { table: 't' } });
  const laid = page('monitor_triage', 'monitor', { records: { table: 't' } });
  assert.equal(sectionTitle(explore, 'work'), 'Explore');
  assert.equal(sectionTitle(explore, 'performance'), 'Usage');
  assert.equal(sectionTitle(ask, 'work'), 'Ask');
  assert.equal(sectionTitle(ask, 'performance'), 'Answer quality');
  assert.equal(sectionTitle(scen, 'work'), 'Scenarios');
  assert.equal(sectionTitle(queue, 'work'), 'Work');
  assert.equal(sectionTitle(queue, 'runs'), SECTION_TITLES.runs);
  assert.equal(sectionTitle(queue, 'odd'), 'odd');
  assert.equal(pageMode(undefined).id, 'queue');
  assert.deepEqual([explore, ask, scen, bare, queue, laid].map(hasWork), [true, true, true, false, true, false]);
  assert.equal(hasWork(page('decision_queue', 'decision_queue')), false, 'a queue page with no records has no work');
});

const store = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
};
const thread = (...turns) => turns.flatMap(([q, a, rated, id], i) => [{ n: 2 * i, who: 'you', text: q }, { n: 2 * i + 1, who: 'genie', answer: { text: a }, rated, turn_id: id }]);

test('rated answers are kept per person and page, with the question they answered', () => {
  const t = thread(['How many open?', '12', 'POSITIVE', 't1'], ['Top region?', 'North', 'NEGATIVE', 't2'], ['Why?', 'Because', undefined, 't3']);
  const all = withRatings({}, 'ana@x', 'p1', t, 1000);
  assert.ok(all);
  const mine = answersOf(all, 'ana@x', 'p1');
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map((a) => [a.id, a.rating, a.question]), [['t1', 'POSITIVE', 'How many open?'], ['t2', 'NEGATIVE', 'Top region?']]);
  assert.equal(answersOf(all, 'bo@x', 'p1').length, 0, 'another person sees none of these');
  assert.equal(answersOf(all, 'ana@x', 'p2').length, 0, 'another page sees none of these');
  assert.equal(withRatings(all, 'ana@x', 'p1', t, 2000), null, 'nothing new is no write');
  const q = answerQuality(mine);
  assert.deepEqual([q.rated, q.up, q.share, q.wrong.length], [2, 1, 0.5, 1]);
  assert.equal(q.wrong[0].question, 'Top region?');
  assert.deepEqual(answerQuality([]), { rated: 0, up: 0, share: null, wrong: [] });
});

test('a changed rating replaces the old one, long questions are cut and the store keeps at most its cap', () => {
  const long = 'x'.repeat(QUESTION_CHARS + 50);
  let all = withRatings({}, 'ana@x', 'p1', thread([long, 'a', 'POSITIVE', 't1']), 1);
  all = withRatings(all, 'ana@x', 'p1', thread([long, 'a', 'NEGATIVE', 't1']), 2);
  const mine = answersOf(all, 'ana@x', 'p1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].rating, 'NEGATIVE');
  assert.ok(mine[0].question.length <= QUESTION_CHARS);
  const many = thread(...Array.from({ length: ANSWERS_KEPT + 30 }, (_, i) => [`q${i}`, 'a', 'POSITIVE', `t${i}`]));
  const big = withRatings({}, 'ana@x', 'p1', many, 3);
  assert.ok(answersOf(big, 'ana@x', 'p1').length <= ANSWERS_KEPT);
});

test('the answers store survives junk and round-trips', () => {
  const s = store();
  assert.deepEqual(readAnswers(s), {});
  s.setItem('inspire-app-answers', '{not json');
  assert.deepEqual(readAnswers(s), {});
  s.setItem('inspire-app-answers', '[1,2]');
  assert.deepEqual(readAnswers(s), {});
  const all = withRatings({}, 'ana@x', 'p1', thread(['q', 'a', 'POSITIVE', 't1']), 1);
  writeAnswers(s, all);
  assert.deepEqual(answersOf(readAnswers(s), 'ana@x', 'p1').map((a) => a.id), ['t1']);
  assert.doesNotThrow(() => writeAnswers({ setItem: () => { throw new Error('full'); } }, all));
  assert.deepEqual(readAnswers(null), {});
});

test('compare holds at most four scenarios and toggles them off again', () => {
  let picked = [];
  for (const id of ['a', 'b', 'c', 'd', 'e']) picked = toggleCompared(picked, id);
  assert.equal(COMPARE_MAX, 4);
  assert.deepEqual(picked, ['a', 'b', 'c', 'd']);
  assert.deepEqual(toggleCompared(picked, 'b'), ['a', 'c', 'd']);
});

test('the compare table shows the saved and the current outcome, the target chance and every lever', () => {
  const scenario = { outcome: { label: 'Revenue', target: 100 }, levers: [{ lever: 'price', label: 'Price', format: 'currency', currency: 'EUR' }, { lever: 'staff' }] };
  const picked = [{ id: 's1', levers: { price: 9, staff: 3 }, outcome: { p50: 90 } }, { id: 's2', levers: { price: 11 }, outcome: {} }];
  const now = { s1: { outcome: { p10: 80, p50: 95, p90: 110, prob_target: 0.4 } }, s2: { error: 'gone' } };
  const rows = compareRows(scenario, picked, now);
  assert.deepEqual(rows.map((r) => r.id), ['saved_p50', 'p10', 'p50', 'p90', 'prob_target', 'lever:price', 'lever:staff']);
  assert.deepEqual(rows[0].values, [90, null]);
  assert.deepEqual(rows[2].values, [95, null]);
  assert.equal(rows[4].kind, 'share');
  assert.deepEqual(rows[5], { id: 'lever:price', label: 'Price', kind: 'lever', live: false, format: 'currency', currency: 'EUR', values: [9, 11] });
  assert.deepEqual(rows[6].values, [3, null]);
  assert.equal(rows[6].label, 'staff');
  assert.ok(!compareRows({ outcome: {}, levers: [] }, picked, {}).some((r) => r.id === 'prob_target'), 'no target, no chance row');
  assert.deepEqual(compareRows(null, [], {}).map((r) => r.id), ['saved_p50', 'p10', 'p50', 'p90']);
});

test('the decisions count reads the library and survives an empty one', () => {
  assert.deepEqual(decisionCounts(null), { mine: 0, shared: 0, decisions: 0 });
  assert.deepEqual(decisionCounts({ mine: 2, scenarios: [{ shared: true }, { shared: false }, { shared: true }], decisions: [{}] }), { mine: 2, shared: 2, decisions: 1 });
});

test('a record link opens Work only on a queue, and stays on the Dashboard of a Scenarios page that also has records', () => {
  const queue = { id: 'q', layout: { id: 'decision_queue', contract: 'decision_queue' }, records: { table: 't' } };
  const lab = { id: 's', layout: { id: 'scenario_lab', contract: 'scenario' }, records: { table: 't' }, scenario: { levers: [] } };
  const sections = (p) => ['dashboard', ...(hasWork(p) ? ['work'] : []), 'performance', 'runs'];
  const opts = { pages: [queue, lab], sectionsOf: sections, queueOf: (p) => pageMode(p).queue };
  assert.equal(canonicalHash('#/q?rec=R1', opts), '#/q/work?rec=R1');
  assert.equal(canonicalHash('#/s?rec=R1', opts), '#/s/dashboard?rec=R1');
  assert.equal(canonicalHash('#/s/work', opts), null, 'the Scenarios section itself is a known address');
  assert.equal(canonicalHash('#/s?rec=R1', { ...opts, queueOf: undefined }), '#/s/work?rec=R1', 'without the mode a record link would land on Scenarios');
});
