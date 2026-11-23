// REQ-507 L8 wiring (with REQ-503): the Results page feeds Generate documents from docValuesOf(calculated.byId). A saved value's
// approved story and its 3-year projection must reach the document model; an unapproved story shows "Story not approved yet";
// a ledger entry with no story keeps the FX-114 sentence naming the biggest part. Pure, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { docValuesOf } from '../../src/lib/docgen/docValues.js';
import { buildDocModel, STORY_NOT_APPROVED } from '../../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../../src/lib/docgen/docOptions.js';

const YEARS = [{ year: 1, low: 400000, likely: 500000, high: 600000 }, { year: 2, low: 800000, likely: 1000000, high: 1200000 }, { year: 3, low: 800000, likely: 1000000, high: 1200000 }];
const entry = (story) => ({ status: 'ready', version: 3, answers: { currency: 'USD', calculated: true, ...(story ? { story } : {}) },
  yearly: { currency: 'USD', total: { unit: 'USD', amount: 1000000 }, calculated: true, parts: [{ id: 'a', label: 'Fewer returns', amount: 1000000 }], projection: { years: YEARS } } });
const modelOf = (byId) => buildDocModel({ businessName: 'Acme', useCases: [{ No: 'U1', Name: 'U1', Statement: 's', inspire_score: '8' }], values: docValuesOf({ byId }), options: defaultDocOptions('English') });

test('W1: an approved story included in documents reaches the document model as its text', () => {
  const m = modelOf({ U1: entry({ text: 'Fewer returns save one million a year.', approved: true, include_in_docs: true }) });
  assert.equal(m.useCases[0].value.story, 'Fewer returns save one million a year.');
});

test('W2: a story that is not approved, or not included in documents, shows "Story not approved yet"', () => {
  assert.equal(modelOf({ U1: entry({ text: 'Draft.', approved: false, include_in_docs: true }) }).useCases[0].value.story, STORY_NOT_APPROVED);
  assert.equal(modelOf({ U1: entry({ text: 'Draft.', approved: true, include_in_docs: false }) }).useCases[0].value.story, STORY_NOT_APPROVED);
});

test('W3: the saved 3-year projection reaches the document model as its yearly rows', () => {
  assert.deepEqual(modelOf({ U1: entry({ text: 'x', approved: true, include_in_docs: true }) }).useCases[0].value.yearly, YEARS);
});

test('W4 (must keep): a ledger entry with no story keeps the sentence naming the biggest part, and no projection stays empty', () => {
  const e = entry(null);
  delete e.yearly.projection;
  const v = modelOf({ U1: e }).useCases[0].value;
  assert.match(v.story, /Fewer returns/);
  assert.deepEqual(v.yearly, []);
});
