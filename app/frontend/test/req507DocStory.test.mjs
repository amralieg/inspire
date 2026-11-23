// REQ-507 L8 (pure): the approved value story in generated documents (REQ-503 doc model). A saved story object prints its text only when it is
// approved and marked "Include this story in generated docs"; otherwise the block reads "Story not approved yet". A plain string story (FX-113)
// is unchanged. valueFromSaved maps a saved wizard entry (answers + yearly) to the doc model value, with the projection years as yearly.
import test from 'node:test';
import assert from 'node:assert/strict';

const DM = await import('../src/lib/docgen/docModel.js').catch(() => ({}));

const UCS = [{ No: 'N01-U01', Name: 'Flag risky transactions', Statement: 's', Solution: 'x', 'Business Value': 'v', 'Tables Involved': 'main.s.orders', domain: 'Risk', inspire_score: '9' }];
const story = (over) => ({ text: 'Losses avoided could return $1.2M a year.', params_hash: 'h1', include_in_docs: true, approved: true, approved_by: 'person@example.com', approved_at: '2026-11-23T10:00:00.000Z', ...over });
const modelWith = (value) => DM.buildDocModel({ businessName: 'Acme', useCases: UCS, values: { 'N01-U01': value }, options: {} });
const storyOfModel = (m) => (m.useCases || m.list || [])[0]?.value?.story;

test('L8: an approved story marked for docs prints its text', () => {
  assert.equal(storyOfModel(modelWith({ amount: 1200000, currency: 'USD', story: story() })), 'Losses avoided could return $1.2M a year.');
});

test('L8: a story not approved, or not marked for docs, reads "Story not approved yet"', () => {
  assert.equal(storyOfModel(modelWith({ amount: 1200000, currency: 'USD', story: story({ approved: false }) })), 'Story not approved yet');
  assert.equal(storyOfModel(modelWith({ amount: 1200000, currency: 'USD', story: story({ include_in_docs: false }) })), 'Story not approved yet');
});

test('L8: a plain string story (FX-113) is unchanged', () => {
  assert.equal(storyOfModel(modelWith({ amount: 1200000, currency: 'USD', story: 'Fewer losses' })), 'Fewer losses');
});

test('L8: valueFromSaved maps a saved wizard entry to the doc value, with the projection years as yearly', () => {
  assert.equal(typeof DM.valueFromSaved, 'function');
  const years = [{ year: 1, low: 240000, likely: 480000, high: 720000 }, { year: 2, low: 480000, likely: 960000, high: 1440000 }, { year: 3, low: 600000, likely: 1200000, high: 1800000 }];
  const v = DM.valueFromSaved({ answers: { currency: 'AED', calculated: true, story: story() }, yearly: { total: { amount: 1200000, unit: 'AED' }, projection: { years } } });
  assert.deepEqual(v, { amount: 1200000, currency: 'AED', status: 'calculated', story: story(), yearly: years });
  assert.equal(DM.valueFromSaved(null), null);
  assert.equal(DM.valueFromSaved({ answers: { currency: 'USD', calculated: false }, yearly: { total: { amount: 5, unit: 'USD' } } }).status, 'estimated');
});
