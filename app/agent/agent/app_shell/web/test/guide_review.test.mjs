// REQ-535 review: Start assigns to the current user, "What it means" uses the real explainer contract, and the guide keeps Genie's row order.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { guideOf } from '../src/guide.js';
import { explainerFor } from '../src/explainers.js';

const src = (f) => new URL(`../src/${f}`, import.meta.url).pathname;
const col = (name, type = 'STRING') => ({ name, type });
const answer = (values) => ({
  columns: [col('product'), col('gain', 'DOUBLE')],
  rows: values.map((v, i) => ({ product: `P${v}`, gain: v, record_key: `k${i + 1}` })),
});
const page = (kind) => ({ id: 'p1', kind, records: { label_title: 'Item' } });

// Vite turns an eager import.meta.glob into a static namespace import; do the same so any version of the component bundles under esbuild.
const viteGlob = {
  name: 'vite-glob',
  setup(b) {
    b.onLoad({ filter: /\.jsx$/ }, async (args) => {
      const imports = [];
      const code = (await readFile(args.path, 'utf8')).replace(/import\.meta\.glob\(\s*'([^']+)'\s*,\s*\{\s*eager:\s*true\s*\}\s*\)/g, (_m, p) => {
        imports.push(`import * as __glob${imports.length} from '${p}';`);
        return `{ '${p}': __glob${imports.length - 1} }`;
      });
      return { contents: `${imports.join('\n')}\n${code}`, loader: 'jsx' };
    });
  },
};

const ENTRY = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import GuidedAnswer from ${JSON.stringify(src('GuidedAnswer.jsx'))};
import { guideOf } from ${JSON.stringify(src('guide.js'))};
window.mount = (answer, page, person) => {
  window.calls = [];
  const genie = { key: 'p1', offer: (...a) => { window.calls.push(a); }, openRecord: () => {}, confirm() {}, cancel() {}, undoSaved() {} };
  const guide = guideOf(answer, page, { decisions: true });
  createRoot(document.getElementById('root')).render(createElement(GuidedAnswer, { guide, genie, message: { k: 'p1', n: 1, agent: true }, person }));
};`;

let browser;
let bundle;
before(async () => {
  const out = await build({ stdin: { contents: ENTRY, resolveDir: src('.'), loader: 'jsx' }, bundle: true, write: false, format: 'iife', platform: 'browser',
    jsx: 'automatic', loader: { '.css': 'empty' }, plugins: [viteGlob], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  bundle = out.outputFiles[0].text;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

async function mounted(kind, person = 'me@example.com') {
  const p = await browser.newPage();
  await p.setContent('<div id="root"></div>');
  await p.addScriptTag({ content: bundle });
  await p.evaluate(([a, pg, who]) => window.mount(a, pg, who), [answer([600, 300, 100]), page(kind), person]);
  await p.getByRole('button', { name: 'Show all steps' }).click();
  return p;
}

test('Start assigns the top record to the current user, never marks it done', async () => {
  const p = await mounted('driver_breakdown');
  await p.locator('[data-guide-start]').click();
  const calls = await p.evaluate(() => window.calls);
  assert.equal(calls.length, 1);
  const [k, n, action, key, values] = calls[0];
  assert.deepEqual([k, n, action, key], ['p1', 1, 'assign', 'k1']);
  assert.deepEqual(values, { owner: 'me@example.com' });
  await p.close();
});

test('What it means shows the explainer text and a term chip for a known kind', async () => {
  const x = explainerFor('driver_breakdown');
  const p = await mounted('driver_breakdown');
  const means = p.locator('[data-guide-step="means"]');
  assert.match(await means.innerText(), new RegExp(x.what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(await means.locator('[data-term-chip]').count(), 1);
  assert.equal((await means.locator('[data-term-chip]').innerText()).trim(), x.terms[0].term);
  await p.close();
});

test('What it means falls back to the quiet line for an unknown kind', async () => {
  const p = await mounted('no_such_kind');
  const means = p.locator('[data-guide-step="means"]');
  assert.equal(await means.locator('[data-term-chip]').count(), 0);
  assert.equal(await means.locator('.gd-quiet').count(), 1);
  await p.close();
});

test('the guide keeps the answer order: ascending rows give the first row as top and bars in that order', () => {
  const g = guideOf(answer([3, 7, 12]), page('any_kind'), { decisions: true });
  assert.deepEqual(g.steps[0].bars.map((b) => b.value), [3, 7, 12]);
  assert.deepEqual(g.steps[3].top, { label: 'P3', key: 'k1' });
  assert.match(g.steps[1].text, /^P3 is first/);
});
