const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'buildNext.js')).href;
const load = () => import(libUrl);

const measured = (high, currency = 'AED') => JSON.stringify({ status: 'measured', value_low: high / 2, value_high: high, currency, text: `${currency} ${high} a year` });
const unmeasured = () => JSON.stringify({ status: 'not measured yet', text: 'Value not measured yet.' });

const uc = (id, extra = {}) => ({ id, name_with_technique: `Use case ${id}`, ...extra });

test('a use case has a value only when its estimate is measured, and carries its high end and currency', async () => {
  const lib = await load();
  assert.deepEqual(lib.estimateOf(uc('U1', { value_estimate: measured(6000) })), { high: 6000, currency: 'AED' });
  assert.equal(lib.estimateOf(uc('U2', { value_estimate: unmeasured() })), null);
  assert.equal(lib.estimateOf(uc('U3')), null);
});

test('progress counts live use cases and sums their high-end value per currency, leaving unmeasured ones out of the sum', async () => {
  const lib = await load();
  const rows = lib.buildItems([
    uc('U1', { value_estimate: measured(6000) }),
    uc('U2', { value_estimate: measured(1000, 'USD') }),
    uc('U3', { value_estimate: measured(4000) }),
    uc('U4', { value_estimate: unmeasured() }),
  ], { U1: 'ready', U2: 'ready_with_warnings', U4: 'ready' });
  const progress = lib.progressOf(rows);
  assert.equal(progress.total, 4);
  assert.equal(progress.live, 3);
  assert.deepEqual(progress.atStake, [{ currency: 'AED', amount: 6000 }, { currency: 'USD', amount: 1000 }]);
});

test('a failed or building MVP is not live', async () => {
  const lib = await load();
  const rows = lib.buildItems([uc('U1', { value_estimate: measured(900) }), uc('U2', { value_estimate: measured(800) })],
    { U1: 'failed', U2: 'building' });
  assert.equal(lib.progressOf(rows).live, 0);
  assert.deepEqual(lib.progressOf(rows).atStake, []);
});

test('the next list ranks unbuilt use cases by their measured value first, then by Inspire score, then Best of Best', async () => {
  const lib = await load();
  const rows = lib.buildItems([
    uc('A-unmeasured-high-score', { inspire_score: 9.9 }),
    uc('B-small', { value_estimate: measured(1000) }),
    uc('C-big', { value_estimate: measured(9000) }),
    uc('D-tie-low-score', { value_estimate: measured(5000), inspire_score: 3 }),
    uc('E-tie-high-score', { value_estimate: measured(5000), inspire_score: 8 }),
    uc('F-built', { value_estimate: measured(99999) }),
  ], { 'F-built': 'ready' });
  const next = lib.buildNextOf(rows).next.map((r) => r.id);
  assert.deepEqual(next, ['C-big', 'E-tie-high-score', 'D-tie-low-score']);
});

test('a use case with no measured value is listed after every measured one, ordered by Inspire score', async () => {
  const lib = await load();
  const rows = lib.buildItems([
    uc('U1', { inspire_score: 2 }),
    uc('U2', { inspire_score: 7 }),
    uc('U3', { value_estimate: measured(100) }),
  ], {});
  assert.deepEqual(lib.buildNextOf(rows).next.map((r) => r.id), ['U3', 'U2', 'U1']);
});

test('a value in a second currency does not outrank the primary currency value', async () => {
  const lib = await load();
  const rows = lib.buildItems([
    uc('AED-big', { value_estimate: measured(20000, 'AED') }),
    uc('AED-small', { value_estimate: measured(2000, 'AED') }),
    uc('USD-mid', { value_estimate: measured(9000, 'USD') }),
  ], {});
  assert.deepEqual(lib.buildNextOf(rows).next.map((r) => r.id), ['AED-big', 'AED-small', 'USD-mid']);
});

test('the next-step list for a live use case holds only unbuilt use cases that share a data table with it, ranked by value', async () => {
  const lib = await load();
  const evidence = (...tables) => JSON.stringify({ tables: Object.fromEntries(tables.map((t) => [t, { columns: [] }])) });
  const rows = lib.buildItems([
    uc('FOCUS', { data_evidence: evidence('c.s.orders'), value_estimate: measured(5000) }),
    uc('SHARE-SMALL', { data_evidence: evidence('c.s.orders', 'c.s.items'), value_estimate: measured(1000) }),
    uc('SHARE-BIG', { data_evidence: evidence('C.S.ORDERS'), value_estimate: measured(7000) }),
    uc('OTHER', { data_evidence: evidence('c.s.stores'), value_estimate: measured(9000) }),
    uc('SHARE-BUILT', { data_evidence: evidence('c.s.orders'), value_estimate: measured(8000) }),
  ], { 'SHARE-BUILT': 'ready' });
  assert.deepEqual(lib.nextSharingTables(rows, 'FOCUS').map((r) => r.id), ['SHARE-BIG', 'SHARE-SMALL']);
  assert.deepEqual(lib.nextSharingTables(rows, 'FOCUS')[1].shared, ['c.s.orders']);
});

test('a use case with no data tables suggests nothing for the next step', async () => {
  const lib = await load();
  const rows = lib.buildItems([uc('FOCUS', { value_estimate: measured(5000) }), uc('OTHER', { value_estimate: measured(1) })], {});
  assert.deepEqual(lib.nextSharingTables(rows, 'FOCUS'), []);
});

test('money reads as a short currency amount, never with a dash', async () => {
  const lib = await load();
  assert.equal(lib.moneyText({ currency: 'AED', amount: 6000 }), 'AED 6K');
  assert.equal(lib.moneyText({ currency: 'USD', amount: 1250000 }), 'USD 1.3M');
  assert.doesNotMatch(lib.moneyText({ currency: 'AED', amount: 1 }), /[–—]/);
});

test('between equal value and Inspire score, a Best of Best use case comes first', async () => {
  const lib = await load();
  const rows = lib.buildItems([
    uc('PLAIN', { value_estimate: measured(5000), inspire_score: 6 }),
    uc('STARRED', { value_estimate: measured(5000), inspire_score: 6, best_of_best: 'Y', best_of_best_rank: 2, best_of_best_score: 6 }),
  ], {});
  assert.deepEqual(lib.buildNextOf(rows).next.map((r) => r.id), ['STARRED', 'PLAIN']);
});
