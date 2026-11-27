// REQ-569: use case ids are AIx-UCx. One shared helper maps old Nx-Ux ids; lookups accept both forms.
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../shared/useCaseId.mjs');
const I = require('../lib/inspireImplement');

test('displayId maps the old form, keeps the new form and padding, leaves other text alone', () => {
  assert.equal(U.displayId('N01-U02'), 'AI01-UC02');
  assert.equal(U.displayId('N3-U10'), 'AI3-UC10');
  assert.equal(U.displayId('AI01-UC02'), 'AI01-UC02');
  assert.equal(U.displayId('UC-1'), 'UC-1');
  assert.equal(U.displayId(null), '');
});

test('parseUseCaseId accepts both forms and sameUseCaseId compares across them', () => {
  assert.deepEqual(U.parseUseCaseId('N01-U02'), { domain: 1, index: 2 });
  assert.deepEqual(U.parseUseCaseId('AI01-UC02'), { domain: 1, index: 2 });
  assert.equal(U.parseUseCaseId('AI-X-U1'), null);
  assert.equal(U.sameUseCaseId('N01-U02', 'AI01-UC02'), true);
  assert.equal(U.sameUseCaseId('N01-U02', 'AI01-UC03'), false);
});

test('storedForms lists the asked id first and the other form second', () => {
  assert.deepEqual(U.storedForms('AI01-UC02'), ['AI01-UC02', 'N01-U02']);
  assert.deepEqual(U.storedForms('N01-U02'), ['N01-U02', 'AI01-UC02']);
  assert.deepEqual(U.storedForms('free-id'), ['free-id']);
});

test('displayText rewrites every old id inside prose', () => {
  assert.equal(U.displayText('Open N01-U02 and N10-U11, not AI01-UC02.'), 'Open AI01-UC02 and AI10-UC11, not AI01-UC02.');
});

test('the use case row and tables lookups find a row stored in either form', () => {
  for (const asked of ['AI01-UC02', 'N01-U02']) {
    const row = I.useCaseRowStatement('t', 7, asked);
    assert.match(row.sql, /\bid IN \(/);
    assert.deepEqual(row.parameters.filter((p) => p.name.startsWith('uc')).map((p) => p.value).sort(), ['AI01-UC02', 'N01-U02']);
    const many = I.useCaseTablesStatement('t', 7, [asked]);
    assert.deepEqual(many.parameters.filter((p) => p.name.startsWith('uc')).map((p) => p.value).sort(), ['AI01-UC02', 'N01-U02']);
  }
});

test('pickStoredId returns the id the table holds, whichever form was asked', () => {
  assert.equal(U.pickStoredId('AI01-UC02', ['N01-U02', 'N01-U03']), 'N01-U02');
  assert.equal(U.pickStoredId('N01-U02', ['AI01-UC02']), 'AI01-UC02');
  assert.equal(U.pickStoredId('AI01-UC09', ['N01-U02']), null);
});
