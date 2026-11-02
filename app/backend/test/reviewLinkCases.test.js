const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const FIXTURE = require('./fixtures/implement_review_link_cases.json');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

test("every Review link the agent writes, from the shared fixture, opens exactly the session and use case it names, through the App's one link parser", async () => {
  const R = await lib('runPages.js');
  const linked = FIXTURE.cases.filter((entry) => entry.link);
  assert.equal(linked.length, 13);
  for (const entry of linked) {
    const url = new URL(entry.link);
    assert.equal(url.origin, entry.base, entry.name);
    assert.equal(url.hash, '', `${entry.name}: the link carries no fragment, which a sign-in can drop`);
    const moved = R.queryLink({ pathname: url.pathname, search: url.search });
    assert.equal(new URL(moved, url.origin).search, '', `${entry.name}: the query is gone once the App reads it`);
    const link = R.hashLink(new URL(moved, url.origin).hash);
    assert.deepEqual([link.page, link.sessionId, link.useCaseId], [R.REVIEW_TAB, String(entry.session_id), String(entry.use_case_id)], entry.name);
    assert.equal(link.valid, /^\d{1,19}$/.test(String(entry.session_id)), `${entry.name}: only a run id opens a run`);
  }
  assert.deepEqual(linked.filter((entry) => /^\d+$/.test(String(entry.session_id))).map((entry) => String(entry.session_id)),
    ['2222222222222222222', '2222222222222222222', '2222222222222222222', '5150'], 'the cases with a run id the App opens');
});

test('the fixture cases with no link are the ones the agent never builds a link for, and the address error is the App error word for word', () => {
  const unlinked = FIXTURE.cases.filter((entry) => !entry.link);
  assert.deepEqual(unlinked.map((entry) => entry.name),
    ['a use case id that is empty', 'a session id that is empty', 'a missing address', 'an address that is not text', 'an address with a path', 'an address over http']);
  for (const entry of unlinked) {
    const half = String(entry.session_id ?? '').trim() === '' || String(entry.use_case_id ?? '').trim() === '';
    assert.ok(half || entry.errors.length === 1, entry.name);
    for (const error of entry.errors) assert.equal(error, FIXTURE.error, entry.name);
  }
  assert.equal(FIXTURE.error, I.IMPLEMENT_APP_HOSTED_ERRORS.inspire_url, 'the App refuses a bad Inspire address with the agent text');
});

test('the App reads each fixture address as the agent does, for an App, for a dashboard alone, and not at all when there is neither', () => {
  const spec = (outputs) => ({
    use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.n01_u01_out' }, outputs,
  });
  const shapes = [
    ['an App', { dashboard: false, genie_space: false, app: true, app_name: 'churn-desk', app_access: 'sp' }, true],
    ['a dashboard alone', { dashboard: true, genie_space: false, app: false }, true],
    ['a Genie Agent alone', { dashboard: false, genie_space: true, app: false }, false],
  ];
  for (const [what, outputs, needed] of shapes) {
    for (const entry of FIXTURE.cases) {
      const got = I.validateImplementSpec(spec({ ...outputs, inspire_url: entry.inspire_url }));
      const expected = needed ? [entry.base, entry.errors] : ['', []];
      assert.deepEqual([got.spec.outputs.inspire_url, got.errors], expected, `${what}: ${entry.name}`);
    }
  }
});
