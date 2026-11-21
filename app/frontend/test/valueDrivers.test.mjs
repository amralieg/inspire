// REQ-435 (B7 and the pure answer builder): the saved answers live on the server, never in this browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = path.join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test('B7: no source file reads or writes the inspire.stake.v1 browser key, and the local helpers are gone', () => {
  const hits = walk(src).filter((p) => /\.(jsx?|mjs)$/.test(p))
    .filter((p) => /inspire\.stake\.v1|savedStakeAnswers|saveStake\b/.test(readFileSync(p, 'utf8')));
  assert.deepEqual(hits.map((p) => path.relative(src, p)), []);
});

test('the answer builder sends only filled drivers and never invents money', async () => {
  const { DRIVERS, ATTRIBUTION, driverAnswersOf, valuesOfAnswers } = await import('../src/lib/valueDrivers.js');
  const json = JSON.parse(readFileSync(new URL('../../backend/lib/valueDrivers.json', import.meta.url), 'utf8'));
  assert.deepEqual(DRIVERS.map((d) => d.label), json.drivers.map((d) => d.label));
  assert.equal(ATTRIBUTION.default, 100);
  const first = json.drivers[0];
  const typed = { [first.id]: Object.fromEntries(first.inputs.map((i, n) => [i.id, String(n + 1)])), [json.drivers[1].id]: {} };
  const built = driverAnswersOf(typed);
  assert.deepEqual(Object.keys(built.drivers), [first.id]);
  assert.equal(built.drivers[first.id][first.inputs[0].id], 1);
  assert.equal(built.incomplete, '');
  const half = driverAnswersOf({ [first.id]: { [first.inputs[0].id]: '4' } });
  assert.match(half.incomplete, new RegExp(first.label));
  assert.deepEqual(valuesOfAnswers({ [first.id]: { [first.inputs[0].id]: 7 } })[first.id][first.inputs[0].id], '7');
});
