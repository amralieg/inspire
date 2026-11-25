// REQ-539 lane W-1: the focus spec validator. Same cases as tests/test_req539_focus_spec.py (shared fixture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFocusSpec, BLOCKS, MOTIONS, DEFAULT_ACTIONS } from '../src/focusSpec.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHELL = join(HERE, '..', '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const CASES = read(join(SHELL, '..', '..', 'tests', 'fixtures', 'focus_spec_cases.json')).cases;
const DEFAULTS = read(join(SHELL, 'focus_defaults.json'));
const KINDS = read(join(SHELL, 'kinds.json'));
const KIND_IDS = [...new Set(Object.values(KINDS.technique_kind))].sort();
const BLOCK_IDS = ['bridge', 'strip', 'histogram', 'trend_band', 'ranked_bars', 'small_multiples', 'share_shift', 'before_after',
  'funnel', 'network', 'map_pin', 'gauge', 'timeline', 'cohort_cards'];
const MOTION_IDS = ['build', 'count_up', 'morph', 'pulse', 'slide', 'fill', 'trace', 'split_merge', 'zoom', 'reveal'];
const got = (c) => { const r = validateFocusSpec(c.spec, c.columns, c.actions); return [r, r.errors.map((e) => `${e.path}: ${e.rule}`).sort()]; };

test('fixture has 20 cases', () => assert.equal(CASES.length, 20));

test('every fixture case gets the expected verdict and rules', () => {
  for (const c of CASES) {
    const [r, rules] = got(c);
    assert.deepEqual(rules, c.expect, c.name);
    assert.equal(r.ok, c.expect.length === 0, c.name);
  }
});

test('every rejection names the field path and the rule', () => {
  for (const c of CASES) for (const e of got(c)[0].errors) {
    assert.ok(e.path && e.rule && e.message, c.name);
    assert.ok(e.message.includes(e.path) || e.message.includes(e.rule), c.name);
  }
});

test('block and motion ids are exactly the plan set', () => {
  assert.deepEqual([...BLOCKS], BLOCK_IDS);
  assert.deepEqual([...MOTIONS], MOTION_IDS);
  assert.deepEqual([...DEFAULT_ACTIONS], ['done', 'not_an_issue', 'snooze', 'assign']);
});

test('every technique kind has a default spec the validator accepts', () => {
  assert.equal(KIND_IDS.length, 38);
  for (const kind of KIND_IDS) {
    const spec = DEFAULTS.defaults[kind];
    assert.ok(spec, `no default focus spec for ${kind}`);
    assert.equal(spec.technique_kind, kind);
    const r = validateFocusSpec(spec, DEFAULTS.columns);
    assert.ok(r.ok, `${kind}: ${JSON.stringify(r.errors)}`);
  }
  assert.deepEqual(Object.keys(DEFAULTS.defaults).sort(), KIND_IDS);
});
