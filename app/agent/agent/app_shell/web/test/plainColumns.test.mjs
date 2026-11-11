import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainColumns } from '../src/impact.js';

test('a column id reads as plain words whatever its case, so no raw id reaches the Measurement text (REQ-068)', () => {
  assert.equal(plainColumns('from ORDER_STATUS and Total_Amount'), 'from ORDER STATUS and Total Amount');
  assert.equal(plainColumns('from customer_id, KPI_TARGET_VALUE and ticket_status.'), 'from customer id, KPI TARGET VALUE and ticket status.');
});

test('a measurement sentence with mixed-case and lowercase ids keeps no snake_case token (REQ-068)', () => {
  const text = plainColumns('Measure the share from total_amount, Distribution_Channel and SHIP_TO_REGION, then divide by order_count.');
  assert.doesNotMatch(text, /[A-Za-z0-9]_[A-Za-z0-9]/);
});

test('sentences without an id are left exactly as written (must-exclude)', () => {
  assert.equal(plainColumns('Act now, 5% of revenue'), 'Act now, 5% of revenue');
  assert.equal(plainColumns('Money on the open records flagged Act now or Review'), 'Money on the open records flagged Act now or Review');
});
