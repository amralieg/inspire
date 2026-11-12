const test = require('node:test');
const assert = require('node:assert/strict');
const { describeMessages, parseDescription } = require('../lib/moneyDescribe');

const COLUMNS = ['quantity', 'unit_price', 'discount', 'amount', 'currency_code'];
const reply = (content) => ({ choices: [{ message: { content } }] });

test('the description goes to the model with the user directive as the winning rule, and only the table columns', () => {
  const messages = describeMessages({ text: 'each lost booking costs 120', columns: COLUMNS, currencyColumn: 'currency_code' });
  assert.match(messages[0].content, /The user directive in the description WINS without exception/);
  assert.match(messages[1].content, /Columns of the table: quantity, unit_price, discount, amount, currency_code/);
  assert.match(messages[1].content, /Description: each lost booking costs 120/);
});

test('a model reply that is a valid equation over the table columns is returned as the rule with its explanation', () => {
  const out = parseDescription(reply('{"explanation":"Booked units times price, less discount.","value":{"method":"equation","expression":"quantity * unit_price - discount","currency_column":"currency_code"}}'), COLUMNS);
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.value, { method: 'equation', expression: 'quantity * unit_price - discount', currency_column: 'currency_code' });
  assert.equal(out.explanation, 'Booked units times price, less discount.');
});

test('a fenced reply is read the same way', () => {
  const out = parseDescription(reply('```json\n{"value":{"method":"fixed","amount":120,"currency":"USD"}}\n```'), COLUMNS);
  assert.deepEqual(out.value, { method: 'fixed', amount: 120, currency: 'USD' });
});

test('a rule that names a column the table does not have is refused, never shown', () => {
  const out = parseDescription(reply('{"value":{"method":"equation","expression":"quantity * shipping_fee","currency":"USD"}}'), COLUMNS);
  assert.equal(out.value, null);
  assert.match(out.problems.join(' '), /the rule uses shipping_fee, which is not a column of this table/);
});

test('a rule with an operator the grammar does not allow is refused by the same validator as a typed one', () => {
  const out = parseDescription(reply('{"value":{"method":"equation","expression":"quantity ^ 2","currency":"USD"}}'), COLUMNS);
  assert.equal(out.value, null);
  assert.match(out.problems.join(' '), /adds, subtracts, multiplies and divides/);
});

test('a reply that is not the JSON rule is refused with a plain message', () => {
  const out = parseDescription(reply('Sure, the value is quantity times price.'), COLUMNS);
  assert.equal(out.value, null);
  assert.match(out.problems[0], /did not answer with the JSON value rule/);
});
