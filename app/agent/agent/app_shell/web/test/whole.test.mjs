import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as format from '../src/format.js';
import { formatValue, integer, wholeMoney } from '../src/format.js';
import { pageText, recordsText, valueText, actOutcome, undoText, batchText } from '../src/records.js';
import { capacityText, limitText, myWorkText, plural } from '../src/hub.js';
import { usageView } from '../src/admin.js';
import { heldShare, targetKpiView } from '../src/impact.js';

const ID = '2222222222222222222';
const ID_SHOWN = '2,222,222,222,222,222,222';
const COUNT = (2n ** 53n + 1n).toString();
const COUNT_SHOWN = (2n ** 53n + 1n).toLocaleString('en-US');
const NEXT = (2n ** 53n + 2n).toString();
const browser = (text) => JSON.parse(text, (key, value) => value);

test('the server sends a 19-digit id and a 16-digit count past 2^53 - 1 as text, and a browser reading it as a number would lose digits', () => {
  assert.equal(COUNT.length, 16);
  assert.notEqual(String(Number(ID)), ID);
  assert.notEqual(String(Number(COUNT)), COUNT);
  assert.equal(browser(`{"id":"${ID}","n":"${COUNT}"}`).id, ID);
});

test('a whole number sent as text shows with every digit wherever the App writes a number', () => {
  assert.equal(integer(ID), ID_SHOWN);
  assert.equal(integer(COUNT), COUNT_SHOWN);
  assert.equal(formatValue(ID, 'integer'), ID_SHOWN);
  assert.equal(formatValue(COUNT, 'number'), COUNT_SHOWN);
  assert.equal(formatValue(ID, 'text'), ID);
  assert.equal(wholeMoney(COUNT, 'late shipments', 'count'), `${COUNT_SHOWN} late shipments`);
  assert.equal(wholeMoney(COUNT, 'USD'), `$${COUNT_SHOWN}`);
  assert.equal(wholeMoney(`-${COUNT}`, 'USD'), `-$${COUNT_SHOWN}`);
  assert.equal(valueText({ name: 'entity_id', kind: 'integer' }, ID, {}), ID_SHOWN);
  assert.equal(valueText({ name: 'amount', kind: 'decimal' }, COUNT, {}), COUNT_SHOWN);
  assert.equal(pageText(0, 25, COUNT), `Showing 1 to 25 of ${COUNT_SHOWN}`);
  assert.equal(recordsText(COUNT), `${COUNT_SHOWN} records`);
  assert.equal(plural(COUNT, 'record'), `${COUNT_SHOWN} records`);
  assert.equal(limitText([['Prices', 20, COUNT]]), `Your limit keeps the top 20 of ${COUNT_SHOWN} records in Prices. Change the limit in Settings.`);
  assert.equal(myWorkText({ rows: [1, 2], late: COUNT, today: 0 }), `2 assigned to you · ${COUNT_SHOWN} overdue`);
  assert.match(capacityText({ over_capacity_records: COUNT, act_now_capacity: 50 }), new RegExp(`^${COUNT_SHOWN} more records would qualify`));
  assert.equal(usageView({ pages: [{ id: 'p', counts: { edit: COUNT }, total: COUNT, people: 2 }] }).pages[0].total, COUNT_SHOWN);
  assert.equal(targetKpiView({ kpi_name: 'Late shipments', kpi_unit: 'shipments', kpi_status: 'measured', kpi_latest: COUNT }).latest, `${COUNT_SHOWN} shipments`);
  assert.equal(heldShare({ current: { records: COUNT, held: 3 } }), `3 records of ${COUNT_SHOWN} (0%) are held back now`);
  const acted = actOutcome({ written: 3, matched: COUNT, conflicts_count: COUNT });
  assert.equal(recordsText(acted.matched), `${COUNT_SHOWN} records`);
  assert.equal(recordsText(acted.conflicts), `${COUNT_SHOWN} records`);
  assert.equal(undoText({ restored: COUNT, skipped: 0 }), `Undone: ${COUNT_SHOWN} records are back as they were.`);
  assert.match(batchText({ editor: 'pat', count: COUNT, values: { action_status: 'Done' }, at: '2026-10-20T09:00:00Z' }), new RegExp(`pat: ${COUNT_SHOWN} records marked done`));
});

test('a number that fits a browser keeps its usual shape, so only the whole numbers past 2^53 - 1 change', () => {
  assert.equal(integer(42), '42');
  assert.equal(integer('42'), '42');
  assert.equal(integer(2.5), '3');
  assert.equal(integer(5555555555555555), '5,555,555,555,555,555');
  assert.equal(integer(null), format.NOT_RECORDED);
  assert.equal(integer('abc'), format.NOT_RECORDED);
  assert.equal(formatValue(1234567, 'number'), '1.23M');
  assert.equal(formatValue('1234567', 'number'), '1.23M');
  assert.equal(formatValue('1.5e300', 'number'), formatValue(1.5e300, 'number'));
  assert.equal(wholeMoney(-0.4, 'USD'), '$0');
  assert.equal(wholeMoney(1234.5, 'USD'), '$1,235');
  assert.equal(valueText({ name: 'rank', kind: 'integer' }, 7, {}), '7');
  assert.equal(valueText({ name: 'share', kind: 'decimal' }, 0.12345, {}), '0.1235');
  assert.equal(recordsText(1), '1 record');
  assert.equal(plural(1, 'record'), '1 record');
  assert.equal(actOutcome({ written: [1, 2], matched: '7' }).matched, 7);
});

test('a list sorts 19-digit ids sent as text by their value, beside whole numbers that came as numbers', () => {
  assert.equal(typeof format.compareValues, 'function', 'the App sorts through one comparison');
  const rows = [ID, NEXT, COUNT, 42, '-3', 7, null, `-${ID}`];
  const sorted = [...rows].sort(format.compareValues);
  assert.deepEqual(sorted, [`-${ID}`, '-3', 7, 42, COUNT, NEXT, ID, null]);
  assert.equal(format.compareValues(COUNT, NEXT) < 0, true);
  assert.equal(format.compareValues(NEXT, COUNT) > 0, true);
  assert.equal(format.compareValues(COUNT, COUNT), 0);
  assert.equal(format.compareValues('Bravo', 'alpha') > 0, true);
  assert.equal(format.compareValues('item 10', 'item 9') > 0, true);
});
