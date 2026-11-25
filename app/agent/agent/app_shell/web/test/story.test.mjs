// REQ-533 lane UX-B: the record story (headline, picture, one action) and REQ-532 money labels in the UI.
// Also covers the TermChip focus fix found in the review of REQ-534.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { SRC, bundleEntry, openBundle } from './harness.mjs';

const mod = async () => import('../src/story.js');
const read = (name) => readFileSync(join(SRC, name), 'utf8');

// Pearly Pies: price 0, volume +1,932, mix 0, total +1,932. A compared block in the UX-A shape (no per-record points).
const META = { key: 'entity_id', label: 'entity_label',
  story: { components: [{ column: 'price_effect', label: 'Price' }, { column: 'volume_effect', label: 'Volume' }, { column: 'mix_effect', label: 'Mix' }], total: 'total_effect' } };
const RECORD = { entity_id: '7', entity_label: 'Pearly Pies', price_effect: 0, volume_effect: 1932, mix_effect: 0, total_effect: 1932 };
const COMPARED = { x: 1932, mean: 410, sd: 380, band: [-350, 1170], rank: 3, n: 40, direction: 'higher', flagged: true, status: 'above normal',
  points: [{ name: 'This record', x: 1932 }, { name: 'Average', x: 410 }] };
const HISTORY = { versions: [{ total_effect: 900 }, { total_effect: 1400 }, { total_effect: 1932 }] };
const VIEW = { explanation: 'Units sold rose while price and mix held steady.', evidence: ['Rows checked: 12', 'Quality: 0.91', 'q-value: 0.02'],
  confidence: { level: 'high', reason: '' }, action: 'Keep the promotion running.' };

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test('storyOf on the Pearly Pies fixture: the bridge sums to the total, the strip holds the record and the average, the headline is up', async () => {
  const { storyOf } = await mod();
  const s = storyOf(RECORD, META, COMPARED, HISTORY);
  assert.deepEqual(s.bridge.parts.map((p) => [p.name, p.value]), [['Price', 0], ['Volume', 1932], ['Mix', 0]]);
  assert.equal(s.bridge.parts.reduce((a, p) => a + p.value, 0), s.bridge.total);
  assert.equal(s.bridge.total, 1932);
  assert.equal(s.bridge.start, null, 'no prior and current columns, so no start and end bars');
  assert.equal(s.bridge.end, null);
  assert.equal(s.headline.direction, 'up');
  assert.equal(s.headline.amount, 1932);
  assert.deepEqual(s.strip.points.map((p) => p.name), ['This record', 'Average']);
  assert.deepEqual(s.strip.band, [-350, 1170]);
  assert.deepEqual(s.trend.map((p) => p.y), [900, 1400, 1932]);
});

test('storyOf draws start and end bars only with prior and current columns, and a negative total reads down', async () => {
  const { storyOf } = await mod();
  const meta = { ...META, story: { ...META.story, prior: 'prior_value', current: 'current_value' } };
  const s = storyOf({ ...RECORD, prior_value: 5000, current_value: 6932 }, meta, COMPARED, HISTORY);
  assert.equal(s.bridge.start, 5000);
  assert.equal(s.bridge.end, 6932);
  const down = storyOf({ ...RECORD, price_effect: -50, volume_effect: 0, total_effect: -50 }, META, null, null);
  assert.equal(down.headline.direction, 'down');
  assert.equal(down.bridge.parts.reduce((a, p) => a + p.value, 0), -50);
  assert.equal(down.strip, null, 'no compared block, no strip');
});

const ENTRY = `
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import RecordStory from ${JSON.stringify(join(SRC, 'RecordStory.jsx'))};
import { storyOf } from ${JSON.stringify(join(SRC, 'story.js'))};
const { record, meta, compared, history, view, money } = window.props;
function Host() {
  const [done, setDone] = useState(1);
  return h(RecordStory, { story: storyOf(record, meta, compared, history), view, kind: 'driver_breakdown', money, queue: { done, total: 5 },
    primary: { label: 'Mark as done', onSave: async () => true } });
}
createRoot(document.getElementById('root')).render(h(Host));
`;
let bundle;
const open = async (motion, money = { kind: 'gain', label: 'Gain', could_save: null }) => {
  bundle ||= await bundleEntry(ENTRY);
  const o = await openBundle(browser, bundle, { record: RECORD, meta: META, compared: COMPARED, history: HISTORY, view: VIEW, money });
  await o.page.emulateMedia({ reducedMotion: motion });
  await o.page.reload();
  await o.page.locator('[data-story]').waitFor({ state: 'visible' });
  return o;
};

test('the story shows a chart before 40 words, repeats no number, folds the evidence, and has one primary action', async () => {
  const { page, context, errors } = await open('no-preference');
  try {
    assert.ok(await page.locator('[data-story] svg[role="img"]').count() >= 1, 'at least one SVG chart');
    const before = await page.evaluate(() => {
      const root = document.querySelector('[data-story]');
      const svg = root.querySelector('svg[role="img"]');
      const range = document.createRange();
      range.setStart(root, 0);
      range.setEndBefore(svg);
      return range.toString().trim().split(/\s+/).filter(Boolean).length;
    });
    assert.ok(before <= 40, `${before} words before the first chart`);
    const numbers = (await page.locator('[data-story]').innerText()).match(/\d[\d,]*(?:\.\d+)?/g) || [];
    const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    assert.deepEqual(dupes, [], 'no number is shown twice');
    const ev = page.locator('[data-story] details[data-evidence]');
    assert.equal(await ev.count(), 1);
    assert.equal(await ev.evaluate((d) => d.open), false, 'evidence starts collapsed');
    assert.match(await ev.locator('summary').innerText(), /How sure is this\?/);
    assert.equal(await page.getByText('q-value: 0.02').isVisible(), false);
    assert.equal(await page.locator('[data-story] .btn--pri').count(), 1, 'one primary action');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the queue line moves from 1 of 5 to 2 of 5 done after Save', async () => {
  const { page, context } = await open('no-preference');
  try {
    const line = page.locator('[data-story] [data-queue]');
    assert.match(await line.innerText(), /^1 of 5 done$/);
    await page.locator('[data-story] .btn--pri').click();
    await page.waitForFunction(() => /^2 of 5 done$/.test(document.querySelector('[data-story] [data-queue]')?.textContent || ''));
  } finally { await context.close(); }
});

test('reduced motion renders no animation classes; motion allowed renders some', async () => {
  const still = await open('reduce');
  try {
    assert.equal(await still.page.locator('[data-story] [class*="anim"]').count(), 0);
  } finally { await still.context.close(); }
  const moving = await open('no-preference');
  try {
    assert.ok(await moving.page.locator('[data-story] [class*="anim"]').count() > 0, 'animated when motion is allowed');
  } finally { await moving.context.close(); }
});

test('a gain is never labelled Could save, a loss is a loss, a saving is a saving', async () => {
  const { moneyLabel, moneyKindOf } = await import('../src/impact.js');
  assert.doesNotMatch(moneyLabel('gain', 1932), /could save/i);
  assert.match(moneyLabel('gain', 1932), /gain/i);
  assert.match(moneyLabel('loss', -50), /loss/i);
  assert.equal(moneyLabel('saving', 40), 'Could save');
  assert.match(moneyLabel('variance', 12), /gain/i);
  assert.match(moneyLabel('variance', -12), /loss/i);
  assert.equal(moneyKindOf({ money: { rule: 'gains' } }), 'gain');
  assert.equal(moneyKindOf({ money: { rule: 'net' } }), 'variance');
  assert.equal(moneyKindOf({}), 'saving');
  const { page, context } = await open('no-preference');
  try {
    const text = await page.locator('[data-story]').innerText();
    assert.doesNotMatch(text, /could save/i);
    assert.match(text, /gain/i);
  } finally { await context.close(); }
  const saving = await open('no-preference', { kind: 'saving', label: 'Could save', could_save: 1932 });
  try {
    assert.match(await saving.page.locator('[data-story]').innerText(), /Could save/);
  } finally { await saving.context.close(); }
  for (const file of ['Records.jsx', 'Dashboard.jsx', 'Runs.jsx']) assert.doesNotMatch(read(file), /could save/i, `${file} takes the label from impact.js`);
});

const CHIP = `
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TermChip from ${JSON.stringify(join(SRC, 'TermChip.jsx'))};
function Host() {
  const [n, setN] = useState(0);
  window.__bump = () => setN((v) => v + 1);
  return h('div', null, h('input', { id: 'mine' }), h('span', { id: 'n' }, String(n)),
    h(TermChip, { term: 'Price effect', kind: 'driver_breakdown', context: 'Row 7' }));
}
createRoot(document.getElementById('root')).render(h(Host));
`;

test('re-rendering the parent while the explainer is open does not steal focus back to the dialog', async () => {
  const b = await bundleEntry(CHIP);
  const { page, context } = await openBundle(browser, b, {});
  try {
    await page.locator('[data-term-chip]').click();
    await page.locator('[data-explainer]').waitFor({ state: 'visible' });
    await page.locator('#mine').focus();
    await page.evaluate(() => window.__bump());
    await page.waitForFunction(() => document.getElementById('n').textContent === '1');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'mine', 'focus stays where the user put it');
  } finally { await context.close(); }
});
