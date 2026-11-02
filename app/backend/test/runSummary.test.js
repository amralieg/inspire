const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/runSummary');

test('results_json parses from the VARIANT text the SQL API returns, and anything else is no results', () => {
  assert.deepEqual(S.parseResultsJson('{"executive_summary":"<p>A</p>"}'), { executive_summary: '<p>A</p>' });
  const object = { domains: [] };
  assert.equal(S.parseResultsJson(object), object);
  for (const bad of [null, undefined, '', '   ', '{not json', '[1,2]', '"text"', 7, [1]]) assert.equal(S.parseResultsJson(bad), null, JSON.stringify(bad));
});

test('the run summary is the executive_summary string of results_json and nothing else', () => {
  assert.equal(S.executiveSummaryOf({ executive_summary: '  <p>A</p>\n' }), '<p>A</p>');
  for (const none of [{}, null, { executive_summary: null }, { executive_summary: { markdown: 'an object' } }, { executive_summary: ['a'] },
    { executive_summary: 3 }, { rows: [{ Summary: '<p>a step row</p>' }] }]) {
    assert.equal(S.executiveSummaryOf(none), '', JSON.stringify(none));
  }
});

test('the progressive route reads results_json with one bounded, parameterized statement', () => {
  const s = S.runResultsStatement('`c`.`s`.`__inspire_session`', '42');
  assert.equal(s.sql, 'SELECT results_json FROM `c`.`s`.`__inspire_session` WHERE session_id = :sid LIMIT 1');
  assert.deepEqual(s.parameters, [{ name: 'sid', value: '42', type: 'BIGINT' }]);
});

test('no App code reads a summary from the step rows any more', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const gone of ['SUMMARY_GEN_PROMPT', 'withRunSummary', 'summaryFromSteps', 'summaryStepsStatement', '.Summary']) {
    assert.equal(server.includes(gone), false, gone);
  }
  assert.equal((server.match(/executiveSummaryOf\(/g) || []).length, 2, 'the Review route and the progressive route, through the one reader');
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ResultsPage.jsx'), 'utf8');
  for (const gone of ['inspireResultsTextField', 'mergeFreshResultsJson']) assert.equal(page.includes(gone), false, gone);
  assert.match(page, /const summaryParagraphs = executiveSummaryOf\(results\);/);
});
