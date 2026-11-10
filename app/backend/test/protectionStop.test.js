const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href;
const load = () => import(libUrl);

const SQL = 'ALTER TABLE `main`.`inspire`.`churn_out` SET ROW FILTER main.sec.own_rows ON (`owner`);';
const REASON = 'Inspire did not publish, because the results would show rows or values their sources hide: x. Make each result a view over its sources, '
  + 'or keep the source columns the filters and masks read in the results, then press Check again';
const latest = (record, extra = {}) => ({ status: 'failed', spec_version: 3, asset_status: { protection: record }, ...extra });

test('a protection stop of this version offers Copy SQL and Check again', async () => {
  const w = await load();
  const stop = w.protectionStopOf(latest({ state: 'failed', spec_version: 3, reason: REASON, sql: [SQL, ' '], check: true }));
  assert.deepEqual(stop, { reason: REASON, sql: [SQL], check: true });
  const choices = w.protectionChoices(stop);
  assert.deepEqual(choices.map((c) => [c.id, c.label]), [['copy', 'Copy SQL'], ['check', w.APP_READS_CHECK]]);
  assert.equal(choices[0].sql, SQL);
  for (const c of choices) assert.doesNotMatch(c.detail, /\u2014|\u2013/);
});

test('a protection stop carries the raw error under Details when the record has one', async () => {
  const w = await load();
  const raw = "Principal 'app-x1y2z3 sample-app' does not have READ METADATA on Table main.s.orders_v2";
  const stop = w.protectionStopOf(latest({ state: 'failed', spec_version: 3, reason: 'The App\'s service principal cannot read', sql: [SQL], check: true, details: raw }));
  assert.equal(stop.details, raw);
  assert.equal(w.protectionStopOf(latest({ state: 'failed', spec_version: 3, reason: REASON, sql: [], check: true })).details, undefined);
});

test('a protection stop with no SQL offers only Check again', async () => {
  const w = await load();
  const stop = w.protectionStopOf(latest({ state: 'failed', spec_version: 3, reason: REASON, sql: [], check: true }));
  assert.deepEqual(w.protectionChoices(stop).map((c) => c.id), ['check']);
});

test('a service principal App over protected tables is sent back to Who uses the App, not to Check again', async () => {
  const w = await load();
  const stop = w.protectionStopOf(latest({ state: 'failed', spec_version: 3, reason: 'The App reads x', sql: [], check: false }));
  assert.deepEqual(w.protectionChoices(stop).map((c) => [c.id, c.label]), [['access', 'Change who uses the App']]);
});

test('an older version, a run that did not fail or a cleared record shows no protection stop (must-exclude)', async () => {
  const w = await load();
  const record = { state: 'failed', spec_version: 2, reason: REASON, sql: [SQL], check: true };
  assert.equal(w.protectionStopOf(latest(record)), null);
  assert.equal(w.protectionStopOf(latest({ ...record, spec_version: 3 }, { status: 'ready' })), null);
  assert.equal(w.protectionStopOf(latest({ ...record, spec_version: 3, state: 'ready' })), null);
  assert.equal(w.protectionStopOf({ status: 'failed', spec_version: 3, asset_status: {} }), null);
  assert.equal(w.protectionStopOf(null), null);
  assert.deepEqual(w.protectionChoices(null), []);
});
