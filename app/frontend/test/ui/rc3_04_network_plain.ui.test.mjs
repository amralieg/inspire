import test from 'node:test';
import assert from 'node:assert/strict';
import { failureCauseOf, splitTechnical } from '../../src/lib/plainText.js';

// RC3-04: the Build page showed "Inspire could not read the reported issues: Failed to fetch". The network cause matched the browser
// error only when it was the whole text, so a page that names what it was doing first ("<what>: Failed to fetch") showed the raw error.
const NETWORK = splitTechnical('Failed to fetch').plain;
const BROWSER_ERRORS = ['Failed to fetch', 'TypeError: Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'];
const PREFIXES = ['Inspire could not read the reported issues', 'Inspire could not send the request', 'The alerts could not load',
  'Inspire could not read how this build is going'];

test('RC3-04 the plain network sentence exists (must-keep: a bare browser error already reads plain)', () => {
  assert.match(NETWORK, /^Inspire lost its connection to Databricks, so try again/);
  for (const raw of BROWSER_ERRORS) {
    const split = splitTechnical(raw);
    assert.equal(split.plain, NETWORK, raw);
    assert.deepEqual(split.details, [raw], `${raw} stays under Details`);
  }
});

test('RC3-04 a browser network error after the page\'s own words reads the plain sentence, the raw error under Details', () => {
  for (const prefix of PREFIXES) {
    for (const raw of BROWSER_ERRORS) {
      const text = `${prefix}: ${raw}`;
      const split = splitTechnical(text);
      assert.equal(split.plain, `${prefix}: ${NETWORK}`, text);
      assert.deepEqual(split.details, [raw], `${text}: the browser error sits under Details`);
      assert.equal(failureCauseOf(text)?.kind, 'network', text);
    }
  }
});

test('RC3-04 must-keep: words that only contain a browser phrase, or another cause behind a prefix, are not called a lost connection', () => {
  assert.notEqual(failureCauseOf('Load failed for every table in the schema, so the list is empty')?.kind, 'network');
  assert.notEqual(failureCauseOf('Inspire could not read the reported issues: the table was Failed to fetch earlier today')?.kind, 'network');
  const refused = 'Inspire could not read the reported issues: [INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table main.sales.orders_feedback';
  assert.notEqual(failureCauseOf(refused)?.kind, 'network');
  assert.doesNotMatch(splitTechnical(refused).plain, /lost its connection/);
});
