import test from 'node:test';
import assert from 'node:assert/strict';
import { grantListKey, raisePermissions, subscribePermissions } from '../../src/lib/permissionBus.js';

const A = 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-2`';
const B = 'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-2`';

test('a grant list has no key when it is empty (nothing to show) (REQ-131, REQ-137)', () => {
  assert.equal(grantListKey([]), '');
  assert.equal(grantListKey(undefined), '');
  assert.equal(grantListKey(null), '');
});

test('the same grants in another order, or as a new object, have the same key (REQ-131, REQ-137)', () => {
  const first = [{ statements: [A, B], principal: 'x', why: 'w' }];
  const again = [{ statements: [B, A], principal: 'x', why: 'w' }];
  assert.equal(grantListKey(first), grantListKey(again));
  assert.equal(grantListKey(first), grantListKey(JSON.parse(JSON.stringify(first))));
});

test('a new grant changes the key, so it opens the dialog again (REQ-131, REQ-137)', () => {
  const before = [{ statements: [A], principal: 'x' }];
  const after = [{ statements: [A, B], principal: 'x' }];
  assert.notEqual(grantListKey(before), grantListKey(after));
});

test('the same statements split across entries in a different order keep one key (REQ-131, REQ-137)', () => {
  const one = [{ statements: [A] }, { statements: [B] }];
  const two = [{ statements: [B] }, { statements: [A] }];
  assert.equal(grantListKey(one), grantListKey(two));
});

// The bus keeps what it has shown for the page's life, so each test uses its own grant statements.
function listen() {
  const got = [];
  const off = subscribePermissions((permissions, extra, { quiet = false } = {}) => got.push({ permissions, extra, quiet }));
  return { got, off };
}

test('a grant list raised twice opens the dialog once, even when the second raise is a new object (REQ-131, REQ-137)', () => {
  const { got, off } = listen();
  const stmt = 'GRANT SELECT ON TABLE `main`.`bus`.`once` TO `sp-once`';
  raisePermissions([{ statements: [stmt] }]);
  raisePermissions([{ statements: [stmt] }], { retry: () => {} });
  off();
  assert.equal(got.filter((g) => !g.quiet).length, 1);
});

test('the same grants in another order do not reopen the dialog (REQ-131, REQ-137)', () => {
  const { got, off } = listen();
  const a = 'GRANT SELECT ON TABLE `main`.`bus`.`order_a` TO `sp-order`';
  const b = 'GRANT READ METADATA ON TABLE `main`.`bus`.`order_a` TO `sp-order`';
  raisePermissions([{ statements: [a, b] }]);
  raisePermissions([{ statements: [b, a] }]);
  off();
  assert.equal(got.filter((g) => !g.quiet).length, 1);
});

test('a new grant opens the dialog again, and an explicit action always opens (REQ-131, REQ-137)', () => {
  const { got, off } = listen();
  const a = 'GRANT SELECT ON TABLE `main`.`bus`.`new_a` TO `sp-new`';
  const b = 'GRANT SELECT ON TABLE `main`.`bus`.`new_b` TO `sp-new`';
  raisePermissions([{ statements: [a] }]);
  raisePermissions([{ statements: [a, b] }]);
  raisePermissions([{ statements: [a] }], {}, { explicit: true });
  off();
  assert.equal(got.filter((g) => !g.quiet).length, 3);
});

test('an empty grant list raises nothing (REQ-131, REQ-137)', () => {
  const { got, off } = listen();
  raisePermissions([]);
  raisePermissions(undefined);
  off();
  assert.equal(got.filter((g) => !g.quiet).length, 0);
});

test('a repeat of grants already shown reaches the open dialog as a quiet merge of its extras, never as a second dialog (REQ-131, REQ-137)', () => {
  const { got, off } = listen();
  const stmt = 'GRANT SELECT ON TABLE `main`.`bus`.`retry` TO `sp-retry`';
  raisePermissions([{ statements: [stmt] }]);
  const retry = () => {};
  raisePermissions([{ statements: [stmt] }], { retry });
  off();
  assert.equal(got.filter((g) => !g.quiet).length, 1, 'one dialog');
  assert.equal(got.filter((g) => g.quiet).length, 1, 'the repeat is a quiet notice');
  assert.equal(got.find((g) => g.quiet).extra.retry, retry, 'the repeat carries Try again to the open dialog');
});
