// SEC-06 (c23 security audit, server part): Discover reads as the App, which ignores a person's row filter or column mask. A launch over a
// table with a row filter or column mask is refused instead of showing the App's unfiltered read to the person.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('./support/c23SecLaunch');

test('SEC-06: a launch over a table with a row filter is refused and starts no job', async () => {
  const got = await launch({ policied: ['main.s.orders'] });
  assert.equal(got.jobs.length, 0, `Discover started on a policied table: ${got.text}`);
  assert.equal(got.status, 403, got.text);
  assert.match(got.text, /row filter|column mask/i, got.text);
});

test('SEC-06 control: a table with no row filter or mask launches', async () => {
  const got = await launch({});
  assert.equal(got.status, 200, got.text);
});
