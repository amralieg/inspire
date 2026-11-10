const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const GP = require('../lib/groupingProfile.js');

test('the example picks the first amount-like numeric column, with its currency and status when the table has them', () => {
  const columns = [{ column_name: 'channel', data_type: 'STRING' }, { column_name: 'total_amount', data_type: 'DECIMAL(12,2)' },
    { column_name: 'currency_code', data_type: 'STRING' }, { column_name: 'ticket_status', data_type: 'STRING' }];
  assert.deepEqual(GP.moneySampleColumns(columns), { amount: 'total_amount', currency: 'currency_code', status: 'ticket_status' });
});

test('a table with no amount-like numeric column gets no example at all', () => {
  assert.equal(GP.moneySampleColumns([{ column_name: 'channel', data_type: 'STRING' }, { column_name: 'amount_text', data_type: 'STRING' }]), null);
  assert.equal(GP.moneySampleColumns([]), null);
});

test('the example reads three rows of the main table and names only the columns it picked', () => {
  const sql = GP.moneySampleSql({ sql: '`c`.`s`.`t`' }, { amount: 'total_amount', currency: '', status: 'ticket_status' });
  assert.equal(sql, 'SELECT `total_amount`, `ticket_status` FROM `c`.`s`.`t` LIMIT 3');
  assert.equal(GP.MONEY_SAMPLE_ROWS, 3);
});

test('the profile route returns the example with the profile', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'implementRoutes.js'), 'utf8');
  assert.match(route, /money_sample: pick \? \{ \.\.\.pick, rows: example \} : null/);
});
