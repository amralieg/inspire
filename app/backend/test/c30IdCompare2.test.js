const test = require('node:test');
const assert = require('node:assert/strict');
const RP = require('../lib/routePolicy');
const VT = require('../lib/valueTotals');

// REQ-569 leftover (c30_idcompare2): the owner check (routePolicy latest) and the plan check (valueTotals ownPlan) accept both use case
// id forms (Nx-Ux saved, AIx-UCx asked, and the reverse) and still tell two different use cases apart.
const OWNER = ['owner', 'example.com'].join('@');
const PAIRS = [['N01-U02', 'AI01-UC02'], ['AI01-UC02', 'N01-U02']]; // [the id saved, the id asked]
const OTHERS = [['N01-U02', 'AI01-UC03'], ['AI01-UC02', 'N01-U03']];
const ROUTE = 'PUT /api/inspire/value/answers';

function policyWith(savedId) {
  return RP.createRoutePolicy({
    enforce: () => true,
    appName: () => 'inspire-host',
    appDatabase: () => 'main.inspire',
    personOf: () => OWNER,
    personToken: () => 'tok',
    readAcl: async () => ({ ok: false, status: 403, data: { error_code: 'PERMISSION_DENIED' } }),
    readMe: async () => ({ ok: true, data: {} }),
    readLauncher: async () => '',
    runRecorded: async () => false,
    readHistory: async () => [{ session_id: '42', use_case_id: savedId, spec_version: 1, created_by: OWNER, spec_json: {} }],
  });
}
const askFor = (askedId) => ({ headers: {}, query: { inspire_database: 'main.inspire', session_id: '42', use_case_id: askedId, warehouse_id: 'w1' }, body: {} });

for (const [saved, asked] of PAIRS) {
  test(`routePolicy owner check: the owner of the build saved as ${saved} is the owner when ${asked} is asked`, async () => {
    const got = await policyWith(saved).verdictFor(ROUTE, askFor(asked));
    assert.equal(got.allowed, true, JSON.stringify(got));
  });

  test(`valueTotals ownPlan: a plan saved for ${saved} is the plan of ${asked}`, () => {
    const answers = { shape: 2, currency: 'USD', calculated: false, plan: { basis: 'use_case', use_case_id: saved } };
    const yearly = { verb: 'REDUCE COST', total: { unit: 'USD', amount: 100 }, parts: [{ id: 'p', verb: 'REDUCE COST', amount: 100 }] };
    const got = VT.useCaseOf({ id: asked, saved: { answers, yearly }, hasTable: true, table: 'c.s.t' });
    assert.equal(got.status, 'estimated', JSON.stringify(got));
  });
}

for (const [saved, asked] of OTHERS) {
  test(`different use case: ${asked} is not ${saved} (owner check, plan check)`, async () => {
    const got = await policyWith(saved).verdictFor(ROUTE, askFor(asked));
    assert.equal(got.allowed, false, JSON.stringify(got));
    const answers = { shape: 2, currency: 'USD', calculated: false, plan: { basis: 'use_case', use_case_id: saved } };
    const yearly = { verb: 'REDUCE COST', total: { unit: 'USD', amount: 100 }, parts: [{ id: 'p', verb: 'REDUCE COST', amount: 100 }] };
    const plan = VT.useCaseOf({ id: asked, saved: { answers, yearly }, hasTable: true, table: 'c.s.t' });
    assert.equal(plan.status, 'not_estimated', JSON.stringify(plan));
  });
}
