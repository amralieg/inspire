// REQ-541 contract: the 14 visual blocks read exactly the column roles the focus spec validator allows (schema x-rules).
// For each block: a spec binding the required roles validates and the block draws it; same with every optional role; a stray role is rejected.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { SRC, bundleEntry, openBundle } from './harness.mjs';
import { validateFocusSpec } from '../src/focusSpec.js';
import { dayLabel } from '../src/format.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHELL = join(HERE, '..', '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const RULES = read(join(SHELL, 'focus_spec.schema.json'))['x-rules'];
const BASE = read(join(SHELL, '..', '..', 'tests', 'fixtures', 'focus_spec_cases.json')).cases[0];
const BLOCK_IDS = RULES.blocks;
const REQUIRED = RULES.block_roles;
const OPTIONAL = RULES.block_optional_roles || {};

const ENTRY = `
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { BLOCKS } from ${JSON.stringify(join(SRC, 'viz', 'index.js'))};
const p = window.props;
createRoot(document.getElementById('root')).render(h('div', { id: 'grid' }, p.items.map((it) => h('div', { className: 'cell', key: it.id, 'data-cell': it.id },
  h(BLOCKS[it.id], { ...it.props })))));
`;

// Neutral columns: one per role, named after the role and its type, never after what a block expects to read.
const col = (role) => `col_${role}`;
const types = (id, withOptional) => ({ ...REQUIRED[id], ...(withOptional ? OPTIONAL[id] : {}) });
const rowsFor = (id, withOptional) => [0, 1, 2, 3].map((i) => Object.fromEntries(Object.entries(types(id, withOptional)).map(([role, type], r) => [col(role),
  type === 'number' ? 10 * (i + 1) + r : type === 'date' ? `2026-0${i + 1}-05` : (role === 'target' ? `Node ${i}` : role === 'source' ? 'Hub' : `Name ${role} ${i}`)])));
const bindFor = (id, withOptional) => Object.fromEntries(Object.keys(types(id, withOptional)).map((role) => [role, col(role)]));
const specFor = (id, bind) => {
  const spec = structuredClone(BASE.spec);
  spec.steps = [{ ...spec.steps[0], kind: 'show', visual: { block: id, bind } }, spec.steps[2]];
  return spec;
};
const columnsFor = (id, withOptional) => ({ ...BASE.columns, ...Object.fromEntries(Object.entries(types(id, withOptional)).map(([role, type]) => [col(role), type])) });

let browser; let bundle;
before(async () => { browser = await chromium.launch(); bundle = await bundleEntry(ENTRY); });
after(async () => { await browser?.close(); });

test('the schema lists optional roles, with key, for every block', () => {
  assert.deepEqual(Object.keys(OPTIONAL).sort(), [...BLOCK_IDS].sort());
  for (const id of BLOCK_IDS) assert.equal(OPTIONAL[id].key, 'string', `${id}: key`);
});

for (const withOptional of [false, true]) {
  const name = withOptional ? 'required and every optional role' : 'exactly the required roles';
  test(`validators accept and every block draws a spec binding ${name}`, async () => {
    const items = BLOCK_IDS.map((id) => ({ id, props: { rows: rowsFor(id, withOptional), bind: bindFor(id, withOptional), focus: undefined, motion: 'build', motionLevel: 'off' } }));
    for (const id of BLOCK_IDS) {
      const r = validateFocusSpec(specFor(id, bindFor(id, withOptional)), columnsFor(id, withOptional));
      assert.deepEqual(r.errors, [], `${id}: JS validator`);
    }
    const misses = [];
    const o = await openBundle(browser, bundle, { items }, {}, { width: 1280, height: 800 });
    try {
      await o.page.waitForSelector('#grid .cell');
      for (const id of BLOCK_IDS) {
        const cell = o.page.locator(`[data-cell="${id}"]`);
        const img = cell.locator('[role="img"]');
        if (/No data to draw/.test(await cell.innerText()) || await img.count() !== 1) { misses.push(`${id}: No data to draw`); continue; }
        const label = await img.getAttribute('aria-label');
        const first = rowsFor(id, withOptional)[0];
        for (const [role, type] of Object.entries(types(id, withOptional))) {
          if (role === 'key') continue;
          const raw = String(first[col(role)]);
          if (!label.includes(raw) && !(type === 'date' && label.includes(dayLabel(raw)))) misses.push(`${id}: does not read role ${role} (${first[col(role)]})`);
        }
      }
      assert.deepEqual(misses, []);
      assert.deepEqual(o.errors, []);
    } finally { await o.context.close(); }
  });
}

test('a role in neither list is rejected by both validators, and every listed role is accepted', () => {
  const cases = BLOCK_IDS.flatMap((id) => [
    { id, bind: { ...bindFor(id, true), no_such_role: col(Object.keys(REQUIRED[id])[0]) }, expect: ['steps[0].visual.bind.no_such_role: unknown_role'] },
    { id, bind: bindFor(id, true), expect: [] },
  ]);
  const py = `
import json, sys
sys.path.insert(0, sys.argv[1])
import focus_spec
for c in json.load(sys.stdin):
    print(json.dumps(sorted(f"{e['path']}: {e['rule']}" for e in focus_spec.validate(c['spec'], c['columns'])['errors'])))
`;
  const input = cases.map((c) => ({ spec: specFor(c.id, c.bind), columns: { ...columnsFor(c.id, true), ...(c.bind.no_such_role ? {} : {}) } }));
  const out = execFileSync('python3', ['-I', '-c', py, join(SHELL, 'server')], { input: JSON.stringify(input), encoding: 'utf8' }).trim().split('\n').map((l) => JSON.parse(l));
  cases.forEach((c, i) => {
    const js = validateFocusSpec(input[i].spec, input[i].columns).errors.map((e) => `${e.path}: ${e.rule}`).sort();
    assert.deepEqual(js, c.expect, `${c.id}: JS verdict`);
    assert.deepEqual(out[i], c.expect, `${c.id}: python verdict`);
  });
});
