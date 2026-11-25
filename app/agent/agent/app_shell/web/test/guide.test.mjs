// REQ-535 (D-UX-4, D-UX-5): guideOf turns a ranked Genie answer into the five guided steps, computed from the rows and the column roles, never from a name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideOf } from '../src/guide.js';

const col = (name, type = 'STRING') => ({ name, type });
const ranked = (extra = {}) => ({
  text: 'Gains by product.',
  columns: [col('product'), col('gain', 'DOUBLE'), col('price_effect', 'DOUBLE'), col('mix_effect', 'DOUBLE')],
  rows: [
    { product: 'Alpha', gain: 600, price_effect: 0, mix_effect: 0, record_key: 'k1' },
    { product: 'Beta', gain: 300, price_effect: 0, mix_effect: 0, record_key: 'k2' },
    { product: 'Gamma', gain: 100, price_effect: 0, mix_effect: 0, record_key: 'k3' },
  ],
  ...extra,
});
const page = { id: 'p1', kind: 'any_kind', records: { label_title: 'Item' } };

test('a ranked answer gives five steps in order', () => {
  const g = guideOf(ranked(), page, { decisions: true });
  assert.deepEqual(g.steps.map((s) => s.id), ['look', 'see', 'means', 'do', 'check']);
  assert.deepEqual(g.steps.map((s) => s.title), ['Look', 'What you see', 'What it means', 'Do this', 'Then check']);
});

test('Look is a ranked-bar spec on the first measure column, largest first', () => {
  const look = guideOf(ranked(), page).steps[0];
  assert.equal(look.measure, 'gain');
  assert.deepEqual(look.bars.map((b) => [b.label, b.value]), [['Alpha', 600], ['Beta', 300], ['Gamma', 100]]);
});

test('What you see is one sentence computed from the rows', () => {
  const see = guideOf(ranked(), page).steps[1].text;
  assert.match(see, /Alpha/);
  assert.match(see, /60%/, 'the top row share of the measure');
  assert.match(see, /Price effect and mix effect are 0 for all 3/, 'columns that are zero for every row are named');
  assert.equal(see.split('. ').length, 1, 'one sentence');
});

test('What it means passes the kind id only', () => {
  const means = guideOf(ranked(), page).steps[2];
  assert.equal(means.kind, 'any_kind');
  assert.equal(guideOf(ranked(), { ...page, kind: '' }).steps[2].kind, null);
});

test('Do this names the top row and the allowed actions', () => {
  const act = guideOf(ranked(), page, { decisions: true }).steps[3];
  assert.deepEqual(act.top, { label: 'Alpha', key: 'k1' });
  assert.deepEqual(act.actions, ['start', 'open']);
});

test('Genie-only mode: actions need decisions on and a page that records, never a chat model', () => {
  assert.deepEqual(guideOf(ranked(), page, { decisions: false }).steps[3].actions, ['open'], 'decisions off: open only');
  assert.deepEqual(guideOf(ranked(), { id: 'p1', kind: 'x' }, { decisions: true }).steps[3].actions, ['open'], 'page without records: open only');
  assert.deepEqual(guideOf(ranked(), page, { decisions: true, agent: false }).steps[3].actions, ['start', 'open'], 'no chat model still offers Start');
  assert.deepEqual(guideOf(ranked({ rows: ranked().rows.map(({ record_key, ...r }) => r) }), page, { decisions: true }).steps[3].actions, [], 'no record key: nothing to open or start');
});

test('a column whose text repeats after removing the row label and number is dropped', () => {
  const answer = {
    columns: [col('product'), col('gain', 'DOUBLE'), col('advice'), col('why')],
    rows: [
      { product: 'Alpha', gain: 600, advice: 'Review Alpha within 30 days', why: 'Volume' },
      { product: 'Beta', gain: 300, advice: 'Review Beta within 14 days', why: 'Price' },
      { product: 'Gamma', gain: 100, advice: 'Review Gamma within 7 days', why: 'Mix' },
    ],
  };
  const g = guideOf(answer, page, { decisions: true });
  assert.deepEqual(g.dropped, ['advice']);
  assert.deepEqual(g.shownColumns, ['product', 'gain', 'why']);
});

test('a column that differs between rows is kept', () => {
  const g = guideOf(ranked({ columns: [...ranked().columns, col('owner')], rows: ranked().rows.map((r, i) => ({ ...r, owner: ['Ann', 'Bo', 'Cy'][i] })) }), page);
  assert.deepEqual(g.dropped, []);
});

test('answers that are not ranked return null', () => {
  assert.equal(guideOf({ columns: [col('product')], rows: [{ product: 'A' }, { product: 'B' }] }, page), null, 'no measure');
  assert.equal(guideOf({ columns: [col('product'), col('gain', 'DOUBLE')], rows: [{ product: 'A', gain: 1 }] }, page), null, 'one row');
  assert.equal(guideOf({ columns: [], rows: [] }, page), null);
  assert.equal(guideOf(null, page), null);
});

test('a key column is never the measure, and a negative or missing value does not break the sentence', () => {
  const answer = { columns: [col('product'), col('product_id', 'BIGINT'), col('delta', 'DOUBLE')], rows: [{ product: 'A', product_id: 7, delta: -5 }, { product: 'B', product_id: 8, delta: null }] };
  const g = guideOf(answer, page);
  assert.equal(g.steps[0].measure, 'delta');
  assert.equal(typeof g.steps[1].text, 'string');
});
