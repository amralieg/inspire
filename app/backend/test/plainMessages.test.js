const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./support/serverApp');
const SQ = require('../lib/sqlInputs');
const U = require('../lib/ucReads');
const I = require('../lib/inspireImplement');

test.after(() => S.stopServer());

const words = (text) => String(text).trim().split(/\s+/).length;
const APP = path.join(__dirname, '..', '..');
const SOURCES = ['backend/server.js', 'backend/implementRoutes.js', ...fs.readdirSync(path.join(APP, 'backend/lib')).map((f) => `backend/lib/${f}`),
  ...fs.readdirSync(path.join(APP, 'frontend/src'), { recursive: true }).filter((f) => /\.(jsx?|mjs)$/.test(f)).map((f) => `frontend/src/${f}`)]
  .filter((f) => /\.(jsx?|mjs)$/.test(f));

test('every rewritten message is short, plain and says what to do next', () => {
  for (const text of [SQ.INSPIRE_DB_SHAPE, SQ.USE_CASE_ID_SHAPE, SQ.noSessionText('1234567890123456789'), U.RUN_NO_SIGN_IN, U.WRITE_NO_SIGN_IN,
    U.runUnreadableText(['main.s.orders']), U.skippedTablesText(['main.s.orders'])]) {
    assert.ok(words(text) <= 20, `${text} has ${words(text)} words`);
    assert.doesNotMatch(text, /__inspire_|\/\^|\$\/|exactly catalog\.schema \(one dot\)/, `${text} leaks an internal name`);
  }
  assert.throws(() => I.validateUseCaseId('N01 U01; DROP'), (err) => err.message === SQ.USE_CASE_ID_SHAPE);
});

test('no user-facing text names a real person or an internal table row, anywhere in the App source', () => {
  for (const file of SOURCES) {
    const text = fs.readFileSync(path.join(APP, file), 'utf8');
    assert.doesNotMatch(text, /mehdi|wissad/i, file);
    assert.doesNotMatch(text, /No __inspire_session row|Each use_case_id must match|must be exactly catalog\.schema \(one dot\)/, file);
  }
});

test('a demo-data start with a bad Inspire database says to pick catalog.schema, without naming anyone', async () => {
  S.reset({ notebookPresent: true, managers: ['boss@example.com'] });
  const got = await S.request('POST', '/api/demo-data/start', { person: 'boss@example.com', body: { business_name: 'Acme', description: 'a bakery', inspire_database: 'nodot' } });
  assert.equal(got.status, 400, got.text);
  assert.equal(got.data.error, SQ.INSPIRE_DB_SHAPE);
});
