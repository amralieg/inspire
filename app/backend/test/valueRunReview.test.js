// REQ-480 (FX-75): one model call reviews the whole run; the run total is realistic and never above RUN_SHARE of the revenue.
const test = require('node:test');
const assert = require('node:assert/strict');
const VR = require('../lib/valueReview');
const VT = require('../lib/valueTotals');

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });
const casesOf = (n, total) => Array.from({ length: n }, (_, i) => ({ id: `U${i}`, name: `Case ${i}`, kind: 'REDUCE COST', amount: total / n }));
const sum = (review, cases) => cases.reduce((s, c) => s + review.counted[c.id], 0);
const savedOf = (cases) => new Map(cases.map((c) => [c.id, { version: 1, answers: { shape: 2, calculated: true, currency: 'USD', plan: { basis: 'use_case', use_case_id: c.id } },
  yearly: { verb: c.kind, calculated: true, currency: 'USD', total: { unit: 'USD', amount: c.amount }, parts: [] } }]));

test('44 use cases at 97.1M with revenue 500M count 15M or less after the review', async () => {
  const cases = casesOf(44, 97.1e6);
  let asked = 0;
  const review = await VR.reviewRun({ businessName: 'Acme', revenue: 500e6, useCases: cases, ask: async () => { asked += 1; return reply({ run_total: 80e6, scales: {}, reason: 'Many overlap.' }); } });
  assert.equal(asked, 1, 'one model call for the whole run');
  assert.equal(review.ai_checked, true);
  assert.ok(sum(review, cases) <= 15e6 + 1, `counted ${sum(review, cases)}`);
  assert.equal(review.reason, 'Many overlap.');
  assert.equal(VR.RUN_SHARE, 0.03);
  const run = VT.runOf({ ids: cases.map((c) => c.id), saved: savedOf(cases), estimates: {}, noTable: new Set(), review });
  assert.ok(run.run.totals[0].amount <= 15e6 + 1, 'the run total is the counted one');
  assert.equal(run.use_cases.U0.amount, 97.1e6 / 44, 'the raw amount is kept');
  assert.equal(run.run.review.ai_checked, true);
});

test('a scale of 0.5 for one use case halves only that use case', async () => {
  const cases = casesOf(4, 4e6);
  const review = await VR.reviewRun({ businessName: 'Acme', revenue: 1e9, useCases: cases, ask: async () => reply({ run_total: 3.5e6, scales: { U1: 0.5 }, reason: 'Half is shared.' }) });
  assert.equal(review.counted.U1, 5e5);
  for (const id of ['U0', 'U2', 'U3']) assert.equal(review.counted[id], 1e6);
});

test('with no model the limit still applies and the run is not AI checked', async () => {
  const cases = casesOf(44, 97.1e6);
  const review = await VR.reviewRun({ businessName: 'Acme', revenue: 500e6, useCases: cases, ask: async () => null });
  assert.equal(review.ai_checked, false);
  assert.ok(sum(review, cases) <= 15e6 + 1);
});

test('with no revenue no use case is counted above 20M', async () => {
  const cases = [{ id: 'A', name: 'A', kind: 'GROW REVENUE', amount: 90e6 }, { id: 'B', name: 'B', kind: 'GROW REVENUE', amount: 5e6 }];
  for (const ask of [async () => null, async () => reply({ run_total: 200e6, scales: {}, reason: 'x' })]) {
    const review = await VR.reviewRun({ businessName: 'Acme', revenue: null, useCases: cases, ask });
    assert.equal(review.counted.A, 20e6);
    assert.equal(review.counted.B, 5e6);
  }
});

test('the prompt names no industry and says the explicit inputs win', () => {
  const [system, user] = VR.runReviewMessages({ businessName: 'Acme', revenue: 500e6, useCases: casesOf(2, 2e6) });
  assert.match(system.content, /explicit/i);
  assert.match(user.content, /Acme/);
  assert.match(user.content, /500000000/);
});
