// REQ-534 lane UX-C: plain-language explainers for every technique kind, and the TermChip that opens one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { SRC, bundleEntry, openBundle } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KINDS = JSON.parse(readFileSync(join(HERE, '..', '..', 'kinds.json'), 'utf8'));
const KIND_IDS = [...new Set(Object.values(KINDS.technique_kind))];
const TEMPLATES = ['bridge', 'band', 'trend', 'bars', 'share', 'funnel', 'network', 'beforeafter'];
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const mod = async () => import('../src/explainers.js');

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test('kinds.json still has 38 technique kinds', () => {
  assert.equal(KIND_IDS.length, 38);
});

test('every technique kind has an explainer within the word caps and a valid template', async () => {
  const { explainerFor, EXPLAINERS, TEMPLATES: T } = await mod();
  assert.equal(typeof explainerFor, 'function');
  assert.deepEqual([...T].sort(), [...TEMPLATES].sort(), 'exactly the 8 templates');
  for (const kind of KIND_IDS) {
    const e = explainerFor(kind);
    assert.ok(e, `explainer for ${kind}`);
    assert.ok(e.what && words(e.what) <= 20, `${kind}.what <= 20 words`);
    assert.ok(e.why && words(e.why) <= 20, `${kind}.why <= 20 words`);
    assert.ok(TEMPLATES.includes(e.template), `${kind}.template is one of the 8`);
    assert.ok(Array.isArray(e.terms) && e.terms.length >= 1, `${kind} has terms`);
    for (const t of e.terms) {
      assert.ok(t.term && t.plain && words(t.plain) <= 25, `${kind}.${t.term} plain <= 25 words`);
    }
  }
  for (const kind of Object.keys(EXPLAINERS)) assert.ok(KIND_IDS.includes(kind), `${kind} is a real kind in kinds.json`);
  assert.equal(explainerFor('no_such_kind'), null, 'an unknown kind gives null, not a throw');
});

test('driver_breakdown explains price, volume and mix effect', async () => {
  const { explainerFor } = await mod();
  const names = explainerFor('driver_breakdown').terms.map((t) => t.term.toLowerCase());
  for (const need of ['price effect', 'volume effect', 'mix effect']) assert.ok(names.includes(need), need);
});

const ENTRY = `
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import TermChip from ${JSON.stringify(join(SRC, 'TermChip.jsx'))};
createRoot(document.getElementById('root')).render(h('div', null, h('input', { id: 'before' }),
  h(TermChip, { term: 'Price effect', kind: 'driver_breakdown', context: 'Row 7 gained 120 from volume' })));
`;
let bundle;
const open = async (motion) => {
  bundle ||= await bundleEntry(ENTRY);
  const o = await openBundle(browser, bundle, {});
  await o.page.emulateMedia({ reducedMotion: motion });
  await o.page.reload();
  return o;
};

test('the chip opens an SVG explainer with role and label, the record line, and Esc returns focus to the chip', async () => {
  const { page, context, errors } = await open('no-preference');
  try {
    const chip = page.locator('[data-term-chip]');
    await chip.waitFor({ state: 'visible' });
    await chip.click();
    const svg = page.locator('[data-explainer] svg[role="img"]');
    await svg.waitFor({ state: 'visible' });
    assert.ok((await svg.getAttribute('aria-label') || '').length > 10, 'aria-label describes the picture');
    assert.match(await page.locator('[data-explainer]').innerText(), /Row 7 gained 120 from volume/, 'one line tying it to the record');
    assert.ok(await page.locator('[data-explainer] [class*="ex-anim"]').count() > 0, 'animated when motion is allowed');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-explainer]'));
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-term-chip')), true, 'focus is back on the chip');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('reduced motion renders the explainer static', async () => {
  const { page, context } = await open('reduce');
  try {
    await page.locator('[data-term-chip]').click();
    await page.locator('[data-explainer] svg[role="img"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-explainer] [class*="ex-anim"]').count(), 0, 'no animation classes');
  } finally { await context.close(); }
});
