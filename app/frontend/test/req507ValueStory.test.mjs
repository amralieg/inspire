// REQ-507 L6 (pure): frontend/src/lib/valueStory.js, the value story approval. A deterministic template writes the headline and 5 lines
// (Today, Data, Change, Return, Ask) from the numbers; an AI polish is kept only if it returns every number unchanged; every parameter is listed
// with its source (Data, You, AI, Public) and an owner; the approval holds only while the parameters are the ones approved. The server stamps
// who approved and when, so the browser never sends approved_by or approved_at.
import test from 'node:test';
import assert from 'node:assert/strict';

const VST = await import('../src/lib/valueStory.js').catch(() => ({}));

const PROJECTION = { years: [{ year: 1, low: 240000, likely: 480000, high: 720000 }, { year: 2, low: 480000, likely: 960000, high: 1440000 }, { year: 3, low: 600000, likely: 1200000, high: 1800000 }],
  gross_3y: 2640000, cost_3y: 360000, net_3y: 2280000, roi_3y: 6.33, payback_months: 6, gross_only: false };
const SCOPE = { phrase: 'last 1 year', filters: [{ column: 'order_type', op: '!=', values: ['test'] }], window: { column: 'transaction_time', start: '2025-10-01', end: '2026-09-30' },
  rows_before: 3412880, rows_after: 1198406, first: '2025-10-01', last: '2026-09-30' };
const INPUT = { useCase: 'Flag risky transactions', noun: 'transaction', currency: 'USD', scope: SCOPE, drivers: [{ label: 'Losses avoided' }],
  projection: PROJECTION, economics: { ramp_pct: [40, 80, 100], build_cost: 180000, run_cost_per_year: 60000 } };

const PLAN = { drivers: [{ id: 'risk_avoided', label: 'Losses avoided', asks: [
  { id: 'incidents_per_year', label: 'Incidents a year', kind: 'count', source: 'data', metric: 'records' },
  { id: 'cost_per_incident', label: 'Cost per incident', kind: 'money', source: 'estimate', default: 120 },
  { id: 'reduction_pct', label: 'Reduction', kind: 'pct', source: 'estimate', default: 30 }] }],
  economic_factors: [{ id: 'gdp_growth', label: 'Real GDP growth', likely_pct: 3, min_pct: 1.9, max_pct: 9.1, source: { name: 'IMF', indicator: 'NGDP_RPCH', country: 'ARE', fetched_at: '2026-11-23T10:00:00.000Z', url: 'https://www.imf.org/x' } }] };
const ANSWERS = { currency: 'USD', drivers: { risk_avoided: { on: true, inputs: { cost_per_incident: 150, reduction_pct: 30 } } }, economics: INPUT.economics };
const YEARLY = { parts: [{ id: 'risk_avoided', label: 'Losses avoided', inputs: [
  { id: 'incidents_per_year', label: 'Incidents a year', kind: 'count', source: 'data', value: 4000 },
  { id: 'cost_per_incident', label: 'Cost per incident', kind: 'money', source: 'estimate', value: 150 },
  { id: 'reduction_pct', label: 'Reduction', kind: 'pct', source: 'estimate', value: 30 }] }] };

test('L6: the draft is a headline and 5 labelled lines, the same every time for the same numbers', () => {
  const s = VST.storyOf(INPUT);
  assert.deepEqual(s.lines.map((l) => l.label), ['Today', 'Data', 'Change', 'Return', 'Ask']);
  assert.match(s.headline, /Flag risky transactions/);
  assert.match(s.headline, /\$1\.2M a year/);
  assert.match(s.lines[1].text, /1,198,406 of 3,412,880 transactions/);
  assert.match(s.lines[1].text, /1 Oct 2025 to 30 Sep 2026/);
  assert.match(s.lines[2].text, /Losses avoided/);
  assert.match(s.lines[3].text, /\$2\.28M/);
  assert.match(s.lines[3].text, /6 months/);
  assert.match(s.lines[4].text, /\$180K/);
  assert.deepEqual(VST.storyOf(INPUT), s);
  assert.equal(typeof s.text, 'string');
  assert.ok(s.text.includes(s.headline) && s.lines.every((l) => s.text.includes(l.text)));
});

test('L6: a gross-only case says gross and invents no payback', () => {
  const s = VST.storyOf({ ...INPUT, economics: { ramp_pct: [40, 80, 100] }, projection: { ...PROJECTION, cost_3y: 0, net_3y: 2640000, roi_3y: null, payback_months: null, gross_only: true } });
  assert.match(s.lines[3].text, /gross/i);
  assert.doesNotMatch(s.text, /payback|pays back/i);
});

test('L6: an AI polish is kept only when it returns every number unchanged', () => {
  assert.deepEqual(VST.numbersIn('Save $1.2M in 6 months (35%) from 1,198,406 rows by 2027.'), ['1.2', '6', '35', '1,198,406', '2027']);
  const draft = 'Save $1.2M in 6 months from 1,198,406 rows.';
  assert.equal(VST.polishOk(draft, 'In 6 months, 1,198,406 rows could save $1.2M.'), true);
  assert.equal(VST.polishOk(draft, 'Save $1.3M in 6 months from 1,198,406 rows.'), false, 'a changed number');
  assert.equal(VST.polishOk(draft, 'Save $1.2M from 1,198,406 rows.'), false, 'a dropped number');
  assert.equal(VST.polishOk(draft, 'Save $1.2M in 6 months from 1,198,406 rows, 99% sure.'), false, 'an added number');
});

test('L6: every parameter is listed once with its source tag: Data from the rows, You when typed, AI when the default is kept, Public for a market series', () => {
  const params = VST.paramsOf(PLAN, ANSWERS, YEARLY);
  const by = Object.fromEntries(params.map((p) => [p.id, p]));
  assert.equal(by.incidents_per_year.source, 'data');
  assert.equal(by.incidents_per_year.value, 4000);
  assert.equal(by.cost_per_incident.source, 'you');
  assert.equal(by.reduction_pct.source, 'ai');
  assert.equal(by.gdp_growth.source, 'public');
  assert.match(by.gdp_growth.note || '', /IMF, NGDP_RPCH, ARE/);
  for (const id of ['ramp_pct', 'build_cost', 'run_cost_per_year']) assert.equal(by[id]?.source, 'you', id);
  assert.ok(params.every((p) => 'owner' in p), 'each row can carry an owner');
  assert.equal(new Set(params.map((p) => p.id)).size, params.length);
});

test('L6: the approval holds only while the approved parameters are unchanged; an owner is not a parameter; the browser never stamps who or when', () => {
  const params = VST.paramsOf(PLAN, ANSWERS, YEARLY);
  const story = VST.storyAnswers({ text: 'Story text', params, include_in_docs: true });
  assert.equal(story.text, 'Story text');
  assert.equal(story.include_in_docs, true);
  assert.equal(story.approved, true);
  assert.equal(story.params_hash, VST.paramsHash(params));
  assert.ok(story.approved_by == null && story.approved_at == null, 'the server stamps the approval');
  assert.equal(VST.approvalHolds(story, params), true);
  const owned = params.map((p) => (p.id === 'reduction_pct' ? { ...p, owner: 'Finance' } : p));
  assert.equal(VST.approvalHolds(story, owned), true);
  const changed = params.map((p) => (p.id === 'reduction_pct' ? { ...p, value: 35 } : p));
  assert.equal(VST.approvalHolds(story, changed), false);
  assert.equal(VST.approvalHolds(null, params), false);
});
