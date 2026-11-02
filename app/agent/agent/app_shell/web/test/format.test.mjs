import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as format from '../src/format.js';
import { addedParts, change, formatValue, plainText, storyPieces, NOT_RECORDED } from '../src/format.js';
import { appInfo } from './harness.mjs';

const SHELL_KPI = appInfo().pages[0].kpis[0];
const NO_EARLIER = SHELL_KPI.words.story_none;
const CASES = JSON.parse(readFileSync(new URL('./change_cases.json', import.meta.url), 'utf8'));

test('a part under a record name shows only when it adds a word that the name and the parts before it do not show', () => {
  assert.deepEqual(addedParts('zip 10001', ['2016-02-29 00:00 | own series', '10001 | 2016-02-29 00:00 | own series']),
    ['2016-02-29 00:00 | own series', '']);
  assert.deepEqual(addedParts('pickup zip 10011 to dropoff zip 10016', ['hour 08', '10011-10016 | hour 08']), ['hour 08', '']);
  assert.deepEqual(addedParts('Fleet fare revenue 2016-03-01', ['2016-03-01', 'Fleet fare revenue 2016-03-01']), ['', '']);
  assert.deepEqual(addedParts('trip at 2016-02-23 00:04 from 10005 to 10044', ['10005 to 10044', '20160223000429-1']), ['', '20160223000429-1']);
  assert.deepEqual(addedParts('Wool coat', ['Store 4', 'SKU-881']), ['Store 4', 'SKU-881']);
  assert.deepEqual(addedParts('Store 41', ['Store 4']), ['Store 4'], 'a word counts only when it matches whole');
  assert.deepEqual(addedParts('WOOL COAT', ['wool coat']), ['']);
  assert.deepEqual(addedParts('', ['North', 'north']), ['North', '']);
  assert.deepEqual(addedParts(null, [null, undefined, '', ' - ', 42]), ['', '', '', '', '42']);
  assert.deepEqual(addedParts('Café Nord', ['café nord', 'Zürich']), ['', 'Zürich']);
  assert.deepEqual(addedParts('Item 1', [['North', 'South']]), ['North · South']);
});

test('lists and objects read as text, never as JSON or [object Object]', () => {
  assert.equal(plainText(['Late delivery', 'Price rise', '', null]), 'Late delivery · Price rise');
  assert.equal(plainText({ store: 'North', units: 12 }), 'store: North · units: 12');
  assert.equal(plainText([{ reason: 'Late' }, ['a', 'b']]), 'reason: Late · a · b');
  assert.equal(plainText(null), '');
  assert.equal(plainText(0), '0');
  for (const format of ['text', 'number', 'currency', 'percent', 'date']) {
    const shown = formatValue(['North', 'South'], format);
    assert.equal(shown, 'North · South', format);
    assert.doesNotMatch(formatValue({ a: 1 }, format), /\[object Object\]|[{}[\]"]/, format);
  }
  assert.equal(formatValue([], 'text'), NOT_RECORDED);
  assert.equal(formatValue([5], 'number'), '5');
  assert.equal(formatValue('Chilled', 'number'), 'Chilled');
  assert.equal(formatValue(1234, 'number'), '1.2K');
});

const KPIS = [{ id: 'total_loss', format: 'currency', good: 'down' }, { id: 'orders', format: 'integer' }, { id: 'share', format: 'percent', good: 'neutral' }]
  .map((k) => ({ ...k, words: SHELL_KPI.words }));
const sentence = (story, data) => storyPieces(story, KPIS, data).map((p) => p.text).join('');

const tileText = (now, before, kpi) => {
  const d = format.change(now, before);
  if (d == null) return '';
  const { way, text } = format.changeParts(d, kpi.words);
  return `${kpi.marks[way]} ${text} ${kpi.vs}`;
};
const WORDS = { same: 'unchanged', from_zero: 'from 0', none: 'No earlier run to compare', story_none: 'with no earlier run to compare' };
const caseText = (c, kpi) => (c.way == null ? ''
  : `${kpi.marks[c.way]} ${c.way === 'same' ? WORDS.same : c.size == null ? WORDS.from_zero : `${c.size}%`} ${kpi.vs}`);

test('a change that rounds to 0.0% reads as unchanged in the words shell_sql holds, case for case as the dashboard counter writes it', () => {
  assert.deepEqual(SHELL_KPI.words, WORDS);
  assert.equal(caseText({ now: 100.00000001, before: 100, way: 'same' }, SHELL_KPI), '\u25a0 unchanged vs previous run');
  assert.ok(CASES.length >= 15 && CASES.some((c) => c.way === 'same') && CASES.some((c) => c.size === '0.1') && CASES.some((c) => c.way == null));
  for (const c of CASES) assert.equal(tileText(c.now, c.before, SHELL_KPI), caseText(c, SHELL_KPI), JSON.stringify(c));
});

test('the story says unchanged for a change too small to show, up from 0 over a zero previous, and keeps a real 0.1% change', () => {
  const pieces = (now, before) => storyPieces('{orders:change} vs the previous run', KPIS, { orders: { now, before } });
  assert.deepEqual(pieces(100.00000001, 100), [{ text: 'unchanged', strong: true, tone: '' }, { text: ' vs the previous run' }],
    'float noise is no rise, and no change is neither good nor bad');
  assert.deepEqual(pieces(99.99999999, 100)[0], { text: 'unchanged', strong: true, tone: '' });
  assert.deepEqual(pieces(5, 0)[0], { text: 'up from 0', strong: true, tone: 'good' }, 'a zero previous is an earlier run, not none');
  assert.deepEqual(pieces(-5, 0)[0], { text: 'down from 0', strong: true, tone: 'up' });
  assert.deepEqual(pieces(100.1, 100)[0], { text: 'up 0.1%', strong: true, tone: 'good' });
  assert.deepEqual(pieces(99.9, 100)[0], { text: 'down 0.1%', strong: true, tone: 'up' });
  assert.deepEqual(pieces(48, null)[0], { text: NO_EARLIER });
});

test('a story with no earlier run drops the comparison its change would have read against', () => {
  const none = { total_loss: { now: 125000 }, orders: { now: 800 } };
  assert.equal(NO_EARLIER, 'with no earlier run to compare');
  assert.ok(!('COMPARE' in format) && !('NO_EARLIER' in format), 'the words come from shell_sql through the server, never from a copy in the web');
  assert.equal(sentence('Discounts cost {total_loss} in the selected period, {total_loss:change} on the previous run.', none),
    `Discounts cost $125K in the selected period, ${NO_EARLIER}.`);
  assert.equal(sentence('The list holds {orders} orders, {orders:change} versus the prior run period.', none),
    `The list holds 800 orders, ${NO_EARLIER}.`);
  for (const lead of ['vs.', 'vs', 'over', 'against', 'compared to', 'compared with', 'relative to', 'from']) {
    assert.equal(sentence(`Loss is {total_loss:change} ${lead} last quarter; orders hold.`, none), `Loss is ${NO_EARLIER}; orders hold.`, lead);
  }
  assert.equal(sentence('Loss is {total_loss:change}, driven by online.', none), `Loss is ${NO_EARLIER}, driven by online.`);
  assert.equal(sentence('Loss is {total_loss:change} while orders reached {orders}.', none), `Loss is ${NO_EARLIER} while orders reached 800.`);
  assert.equal(sentence('Loss is {total_loss:change} on {orders} orders.', none), `Loss is ${NO_EARLIER} on 800 orders.`,
    'a comparison phrase that holds another number is kept');
  assert.equal(sentence('Loss is {total_loss:change} ongoing.', none), `Loss is ${NO_EARLIER} ongoing.`, 'only whole words start a comparison');
  assert.equal(sentence('{orders:change} vs last run', none), NO_EARLIER, 'a comparison that ends the story goes too');
  assert.equal(sentence('Loss is {total_loss:change} on the previous run, with {orders} orders.', none),
    `Loss is ${NO_EARLIER}, with 800 orders.`);
});

test('a story with an earlier run keeps the comparison and marks the change by whether it is good', () => {
  const pieces = storyPieces('Discounts cost {total_loss}, {total_loss:change} on the previous run.', KPIS,
    { total_loss: { now: 90, before: 100 } });
  assert.deepEqual(pieces, [{ text: 'Discounts cost ' }, { text: '$90', strong: true }, { text: ', ' },
    { text: 'down 10.0%', strong: true, tone: 'good' }, { text: ' on the previous run.' }]);
  assert.equal(storyPieces('{orders:change} vs last run', KPIS, { orders: { now: 120, before: 100 } })[0].tone, 'good', 'up is good unless the KPI says down');
  assert.equal(storyPieces('{orders:change} vs last run', KPIS, { orders: { now: 80, before: 100 } })[0].tone, 'up');
  assert.equal(storyPieces('{share:change} vs last run', KPIS, { share: { now: 120, before: 100 } })[0].tone, '', 'a neutral KPI has no tone');
  assert.equal(sentence('Unknown {missing} and {missing:change} stay as written.', {}), 'Unknown {missing} and {missing:change} stay as written.');
  assert.deepEqual(storyPieces('', KPIS, {}), []);
  assert.deepEqual(storyPieces(null, KPIS, {}), []);
});

test('a previous value of 0 is a change from 0, and only a missing previous value means no earlier run', () => {
  assert.equal(change(5, 0), Infinity);
  assert.equal(change(-5, 0), -Infinity);
  assert.equal(change(0, 0), 0);
  assert.equal(change(5, null), null);
  assert.equal(change(null, 4), null);
  const story = 'The list holds {orders} orders, {orders:change} on the previous run.';
  assert.equal(sentence(story, { orders: { now: 800, before: 0 } }), 'The list holds 800 orders, up from 0 on the previous run.');
  assert.equal(sentence(story, { orders: { now: 800, before: null } }), `The list holds 800 orders, ${NO_EARLIER}.`);
  assert.equal(sentence(story, { orders: { now: null, before: 4 } }), 'The list holds Not recorded orders.',
    'a missing value now says nothing about an earlier run');
});
