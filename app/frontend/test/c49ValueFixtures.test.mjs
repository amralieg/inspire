// REQ-586a C (T-VAL-DRY-01): one value spec, locked runners. The App's calculateValue(spec) in src/lib/valueFormula.js must give the
// same output as the agent's inspire_value_calculate(spec) on every case of app/shared/value_spec_fixtures.json (the agent side owns it).
// Comparison is the Python runner's rule (fixtures "compare"): every expected key, null is null, lists sorted, numbers within abs or rel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as valueFormula from '../src/lib/valueFormula.js';

const shared = (name) => JSON.parse(readFileSync(new URL(`../../shared/${name}`, import.meta.url), 'utf8'));
const DATA = shared('value_spec_fixtures.json');
const SCHEMA = shared('value_spec.schema.json');
const { abs: ABS, rel: REL } = DATA.compare;
// Refused fixtures whose spec breaks the schema itself, as in app/agent/tests/unit/a05_value_schema_test.py.
const SCHEMA_REFUSED = new Set(['mechanism_unknown_refused', 'source_missing_refused']);
const EXPECTED_KEYS = ['annual_exposure', 'balance', 'break_even_effect', 'bucket', 'flags', 'ok', 'one_percent', 'period', 'problems', 'scenarios', 'unit'];

const isNum = (v) => typeof v === 'number';
function same(expected, got, path, out) {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    if (got === null || typeof got !== 'object' || Array.isArray(got)) return out.push(`${path}: expected an object, got ${JSON.stringify(got)}`);
    for (const [k, v] of Object.entries(expected)) {
      if (!(k in got)) out.push(`${path}.${k}: missing`);
      else same(v, got[k], `${path}.${k}`, out);
    }
  } else if (Array.isArray(expected)) {
    const a = Array.isArray(got) ? got.map(String).sort() : null;
    if (!a || JSON.stringify(a) !== JSON.stringify(expected.map(String).sort())) out.push(`${path}: ${JSON.stringify(got)} != ${JSON.stringify(expected)}`);
  } else if (isNum(expected)) {
    if (!isNum(got) || !(Math.abs(got - expected) <= Math.max(REL * Math.max(Math.abs(got), Math.abs(expected)), ABS))) out.push(`${path}: ${got} != ${expected}`);
  } else if (got !== expected) out.push(`${path}: ${JSON.stringify(got)} != ${JSON.stringify(expected)}`);
}

// Minimal draft 2020-12 validator for the keywords value_spec.schema.json uses (no JSON-schema dependency in app/frontend/package.json).
const TYPES = { object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v), array: Array.isArray, string: (v) => typeof v === 'string',
  number: isNum, integer: Number.isInteger, boolean: (v) => typeof v === 'boolean', null: (v) => v === null };
function validate(node, v, path = '$', errs = []) {
  if (node.$ref) node = node.$ref.slice(2).split('/').reduce((o, k) => o[k], SCHEMA);
  const types = node.type === undefined ? null : [].concat(node.type);
  if (types && !types.some((t) => TYPES[t](v))) { errs.push(`${path}: type ${types}`); return errs; }
  if (node.enum && !node.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) errs.push(`${path}: not in enum`);
  if (isNum(v) && node.minimum !== undefined && v < node.minimum) errs.push(`${path}: below minimum`);
  if (isNum(v) && node.maximum !== undefined && v > node.maximum) errs.push(`${path}: above maximum`);
  if (TYPES.object(v)) {
    for (const k of node.required || []) if (!(k in v)) errs.push(`${path}.${k}: required`);
    for (const [k, val] of Object.entries(v)) {
      if (node.properties?.[k]) validate(node.properties[k], val, `${path}.${k}`, errs);
      else if (node.additionalProperties === false) errs.push(`${path}.${k}: not allowed`);
      else if (TYPES.object(node.additionalProperties)) validate(node.additionalProperties, val, `${path}.${k}`, errs);
    }
  }
  return errs;
}

test('valueFormula.js exports calculateValue(spec), the App runner of the shared value spec', () => {
  assert.equal(typeof valueFormula.calculateValue, 'function', 'src/lib/valueFormula.js exports no calculateValue(spec)');
});

test('the fixture file is the shared one: 20 cases, 11 expected keys per accepted case', () => {
  assert.equal(DATA.cases.length, 20);
  for (const c of DATA.cases) {
    const keys = c.expected.ok ? EXPECTED_KEYS : EXPECTED_KEYS.filter((k) => k !== 'unit');
    assert.deepEqual(Object.keys(c.expected).sort(), keys, c.id);
  }
});

for (const c of DATA.cases) {
  test(`fixture ${c.id}: calculateValue equals the Python output`, () => {
    assert.equal(typeof valueFormula.calculateValue, 'function', 'no calculateValue export');
    const got = valueFormula.calculateValue(structuredClone(c.spec));
    const diffs = [];
    same(c.expected, got, 'out', diffs);
    assert.deepEqual(diffs, [], `${c.id}\n${diffs.join('\n')}`);
  });
}

test('every non-refused fixture spec validates against value_spec.schema.json; the two schema-refused ones do not', () => {
  for (const c of DATA.cases) {
    const errs = validate(SCHEMA, c.spec);
    if (SCHEMA_REFUSED.has(c.id)) assert.notDeepEqual(errs, [], `${c.id}: the schema accepts a spec it should refuse`);
    else assert.deepEqual(errs, [], c.id);
  }
});
