// REQ-541 lane W-3: the 14 visual blocks and 10 motions the focus steps draw with. Pure SVG, data-bound by column role.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { SRC, bundleEntry, openBundle } from './harness.mjs';

const BLOCK_IDS = ['bridge', 'strip', 'histogram', 'trend_band', 'ranked_bars', 'small_multiples', 'share_shift', 'before_after', 'funnel',
  'network', 'map_pin', 'gauge', 'timeline', 'cohort_cards'];
const MOTION_IDS = ['build', 'count_up', 'morph', 'pulse', 'slide', 'fill', 'trace', 'split_merge', 'zoom', 'reveal'];

// rows + bind per block; `nums` are the bound numbers as format.js prints them; `focus` is a key present in the rows.
const FX = {
  bridge: { rows: [{ step: 'Start', amt: 100 }, { step: 'Price', amt: 30 }, { step: 'Volume', amt: -20 }, { step: 'Mix', amt: 12500 }],
    bind: { label: 'step', value: 'amt' }, focus: 'Volume', nums: ['100', '30', '-20', '12.5K'], bad: ['amt'] },
  strip: { rows: [{ name: 'Alpha', score: 12 }, { name: 'Beta', score: 48 }, { name: 'Gamma', score: 75 }, { name: 'Delta', score: 30 }],
    bind: { label: 'name', value: 'score' }, focus: 'Gamma', nums: ['12', '48', '75', '30'], bad: ['score'] },
  histogram: { rows: [{ id: 'r1', v: 5 }, { id: 'r2', v: 9 }, { id: 'r3', v: 14 }, { id: 'r4', v: 15 }, { id: 'r5', v: 22 }, { id: 'r6', v: 41 }],
    bind: { key: 'id', value: 'v' }, focus: 'r4', nums: ['5', '9', '14', '15', '22', '41'], bad: ['v'] },
  trend_band: { rows: [{ m: '2026-01', v: 10, lo: 8, hi: 12 }, { m: '2026-02', v: 11, lo: 8, hi: 13 }, { m: '2026-03', v: 19, lo: 9, hi: 14 }, { m: '2026-04', v: 12, lo: 9, hi: 15 }],
    bind: { time: 'm', value: 'v', low: 'lo', high: 'hi' }, focus: '2026-03', nums: ['10', '11', '19', '12', '8', '13', '9', '14', '15'], bad: ['v', 'lo', 'hi'] },
  ranked_bars: { rows: [{ item: 'Oak', n: 120 }, { item: 'Pine', n: 85 }, { item: 'Elm', n: 40 }, { item: 'Ash', n: 3200 }],
    bind: { label: 'item', value: 'n' }, focus: 'Elm', nums: ['120', '85', '40', '3.2K'], bad: ['n'] },
  small_multiples: { rows: [{ grp: 'North', m: 'Jan', v: 10 }, { grp: 'North', m: 'Feb', v: 14 }, { grp: 'South', m: 'Jan', v: 7 }, { grp: 'South', m: 'Feb', v: 5 }],
    bind: { label: 'grp', x: 'm', value: 'v' }, focus: 'South', nums: ['10', '14', '7', '5'], bad: ['v'] },
  share_shift: { rows: [{ seg: 'Retail', before: 50, after: 40 }, { seg: 'Online', before: 30, after: 45 }, { seg: 'Other', before: 20, after: 15 }],
    bind: { label: 'seg', before: 'before', value: 'after' }, focus: 'Online', nums: ['50', '40', '30', '45', '20', '15'], bad: ['before', 'after'] },
  before_after: { rows: [{ k: 'Cost', was: 90, now: 60 }, { k: 'Time', was: 14, now: 9 }],
    bind: { label: 'k', before: 'was', after: 'now' }, focus: 'Time', nums: ['90', '60', '14', '9'], bad: ['was', 'now'] },
  funnel: { rows: [{ stage: 'Seen', n: 1000 }, { stage: 'Opened', n: 640 }, { stage: 'Acted', n: 210 }, { stage: 'Done', n: 95 }],
    bind: { stage: 'stage', value: 'n' }, focus: 'Acted', nums: ['1K', '640', '210', '95'], bad: ['n'] },
  network: { rows: [{ a: 'Hub', b: 'North', w: 5 }, { a: 'Hub', b: 'South', w: 8 }, { a: 'North', b: 'East', w: 2 }],
    bind: { source: 'a', target: 'b', value: 'w' }, focus: 'North', nums: ['5', '8', '2'], bad: ['w'] },
  map_pin: { rows: [{ place: 'Port A', lon: 55.3, lat: 25.2, v: 7 }, { place: 'Port B', lon: 54.4, lat: 24.5, v: 11 }, { place: 'Port C', lon: 56.1, lat: 25.6, v: 3 }],
    bind: { region: 'place', label: 'place', x: 'lon', y: 'lat', value: 'v' }, focus: 'Port B', nums: ['55.3', '25.2', '7', '54.4', '24.5', '11', '56.1', '25.6', '3'], bad: ['lon', 'lat', 'v'] },
  gauge: { rows: [{ name: 'Load', now: 72, limit: 80 }],
    bind: { label: 'name', value: 'now', threshold: 'limit' }, focus: 'Load', nums: ['72', '80'], bad: ['now', 'limit'] },
  timeline: { rows: [{ when: '2026-01-05', what: 'Opened', amt: 5 }, { when: '2026-02-10', what: 'Flagged', amt: 9 }, { when: '2026-03-20', what: 'Resolved', amt: 3 }],
    bind: { label: 'what', time: 'when', value: 'amt' }, focus: 'Flagged', nums: ['5', '9', '3'], bad: ['amt'] },
  cohort_cards: { rows: [{ grp: 'Mine', v: 18, n: 4 }, { grp: 'Peers', v: 25, n: 31 }, { grp: 'All', v: 22, n: 120 }],
    bind: { group: 'grp', value: 'v', count: 'n' }, focus: 'Mine', nums: ['18', '25', '22', '4', '31', '120'], bad: ['v', 'n'] },
};

const ENTRY = `
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { BLOCKS } from ${JSON.stringify(join(SRC, 'viz', 'index.js'))};
import { MOTIONS } from ${JSON.stringify(join(SRC, 'motion.js'))};
const fix = (v) => (v === '__NaN__' ? NaN : v === '__Inf__' ? Infinity : v);
const p = window.props;
window.__ids = { blocks: Object.keys(BLOCKS), motions: Object.keys(MOTIONS) };
createRoot(document.getElementById('root')).render(h('div', { id: 'grid' }, p.items.map((it) => h('div', { className: 'cell', key: it.id, 'data-cell': it.id },
  h(BLOCKS[it.id], { ...it.props, rows: it.props.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fix(v)]))) })))));
`;

let browser; let bundle;
before(async () => { browser = await chromium.launch(); bundle = await bundleEntry(ENTRY); });
after(async () => { await browser?.close(); });

const item = (id, over = {}) => ({ id, props: { rows: FX[id].rows, bind: FX[id].bind, focus: FX[id].focus, motion: 'build', motionLevel: 'off', ...over } });
const all = (over = {}) => BLOCK_IDS.map((id) => item(id, over));
async function open(items, { width = 1280, height = 800, motion = 'no-preference' } = {}) {
  const o = await openBundle(browser, bundle, { items }, {}, { width, height });
  await o.page.emulateMedia({ reducedMotion: motion });
  await o.page.reload();
  await o.page.waitForSelector('#grid .cell');
  return o;
}
const NAN_ATTRS = () => [...document.querySelectorAll('#grid *')].flatMap((el) => [...el.attributes].filter((a) => /NaN|Infinity|undefined|null/.test(a.value)).map((a) => `${el.tagName}[${a.name}=${a.value}]`));

test('exactly the 14 block ids and the 10 motion ids are exported', async () => {
  const { page, context, errors } = await open([item('ranked_bars')]);
  try {
    assert.deepEqual(await page.evaluate(() => window.__ids.blocks), BLOCK_IDS);
    assert.deepEqual(await page.evaluate(() => window.__ids.motions), MOTION_IDS);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('motionState gives the static end state for Off and reduced motion', async () => {
  const { motionState, MOTIONS } = await import('../src/motion.js');
  assert.deepEqual(Object.keys(MOTIONS), MOTION_IDS);
  for (const id of MOTION_IDS) {
    assert.equal(motionState(id, 'off', false).run, false, `${id} off`);
    assert.equal(motionState(id, 'lively', true).run, false, `${id} reduced`);
    assert.equal(motionState(id, 'lively', false).run, true, `${id} lively`);
    assert.equal(motionState(id, 'calm', false).run, true, `${id} calm`);
  }
  assert.equal(motionState('no_such', 'lively', false).run, false, 'unknown motion is static');
});

test('every block renders role=img with an aria-label holding the formatted bound numbers', async () => {
  const { page, context, errors } = await open(all());
  try {
    for (const id of BLOCK_IDS) {
      const img = page.locator(`[data-cell="${id}"] [role="img"]`);
      assert.equal(await img.count(), 1, `${id}: one role=img`);
      const label = await img.getAttribute('aria-label');
      for (const n of FX[id].nums) assert.ok(label.includes(n), `${id}: aria-label has ${n}: ${label}`);
      assert.equal(await page.locator(`[data-cell="${id}"] [data-viz="${id}"]`).count(), 1, `${id}: data-viz root`);
    }
    assert.deepEqual(await page.evaluate(NAN_ATTRS), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the focus item is marked with data-focus, and nothing is marked without a focus', async () => {
  const withFocus = await open(all());
  try {
    for (const id of BLOCK_IDS) assert.ok(await withFocus.page.locator(`[data-cell="${id}"] [data-focus]`).count() >= 1, `${id}: data-focus present`);
  } finally { await withFocus.context.close(); }
  const without = await open(all({ focus: undefined }));
  try {
    for (const id of BLOCK_IDS) assert.equal(await without.page.locator(`[data-cell="${id}"] [data-focus]`).count(), 0, `${id}: none without focus`);
  } finally { await without.context.close(); }
});

test('empty rows and unusable values show "No data to draw", never a broken SVG', async () => {
  const bad = (id) => FX[id].rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, FX[id].bad.includes(k) ? ['__NaN__', null, 'abc', '__Inf__'][Object.keys(r).indexOf(k) % 4] : v])));
  const cases = { empty: (id) => [], 'NaN and null': bad };
  for (const [name, rowsOf] of Object.entries(cases)) {
    const items = BLOCK_IDS.map((id) => item(id, { rows: rowsOf(id) }));
    const { page, context, errors } = await open(items);
    try {
      for (const id of BLOCK_IDS) {
        const cell = page.locator(`[data-cell="${id}"]`);
        assert.match(await cell.innerText(), /No data to draw/, `${id} ${name}: plain empty state`);
        assert.equal(await cell.locator('svg [data-focus]').count(), 0, `${id} ${name}: nothing drawn`);
      }
      assert.deepEqual(await page.evaluate(NAN_ATTRS), [], name);
      assert.deepEqual(errors, [], name);
    } finally { await context.close(); }
  }
});

test('one good row among bad ones, and flat values, never write NaN or Infinity into an attribute', async () => {
  const half = (id) => FX[id].rows.map((r, i) => (i === 0 ? r : Object.fromEntries(Object.entries(r).map(([k, v]) => [k, FX[id].bad.includes(k) ? '__NaN__' : v]))));
  const flat = (id) => FX[id].rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, FX[id].bad.includes(k) ? 5 : v])));
  for (const [name, rowsOf] of [['half bad', half], ['flat', flat]]) {
    const { page, context, errors } = await open(BLOCK_IDS.map((id) => item(id, { rows: rowsOf(id) })));
    try {
      assert.deepEqual(await page.evaluate(NAN_ATTRS), [], name);
      for (const id of BLOCK_IDS) {
        const text = await page.locator(`[data-cell="${id}"]`).innerText();
        const drawn = await page.locator(`[data-cell="${id}"] [role="img"]`).count();
        assert.ok(drawn === 1 || /No data to draw/.test(text), `${id} ${name}: a picture or the plain state`);
      }
      assert.deepEqual(errors, [], name);
    } finally { await context.close(); }
  }
});

for (const motion of MOTION_IDS) {
  test(`motion ${motion}: no animation under Off or reduced motion (end state shown), animates when lively`, async () => {
    const off = await open(all({ motion, motionLevel: 'off' }));
    try {
      assert.equal(await off.page.evaluate(() => document.getAnimations().length), 0, 'Off: zero animations');
      for (const id of BLOCK_IDS) {
        assert.equal(await off.page.locator(`[data-cell="${id}"] [data-viz]`).getAttribute('data-motion-state'), 'static', `${id} Off static`);
        assert.equal(await off.page.locator(`[data-cell="${id}"] .vz-mark`).first().evaluate((el) => getComputedStyle(el).opacity), '1', `${id} Off: end state visible`);
      }
    } finally { await off.context.close(); }
    const reduced = await open(all({ motion, motionLevel: 'lively' }), { motion: 'reduce' });
    try {
      assert.equal(await reduced.page.evaluate(() => document.getAnimations().length), 0, 'reduced motion: zero animations');
      assert.equal(await reduced.page.locator('[data-viz][data-motion-state="static"]').count(), BLOCK_IDS.length, 'reduced motion: all static');
    } finally { await reduced.context.close(); }
    const lively = await open(all({ motion, motionLevel: 'lively' }));
    try {
      for (const id of BLOCK_IDS) {
        const n = await lively.page.locator(`[data-cell="${id}"] [data-viz]`).evaluate((el) => el.getAnimations({ subtree: true }).length);
        assert.ok(n >= 1, `${id}: ${motion} runs an animation when lively`);
        assert.equal(await lively.page.locator(`[data-cell="${id}"] [data-viz]`).getAttribute('data-motion-state'), 'running');
      }
    } finally { await lively.context.close(); }
  });
}

test('calm still animates, with the calm marker', async () => {
  const { page, context } = await open(all({ motion: 'build', motionLevel: 'calm' }));
  try {
    assert.ok(await page.evaluate(() => document.getAnimations().length) >= 1);
    assert.equal(await page.locator('[data-viz].vz-calm').count(), BLOCK_IDS.length);
  } finally { await context.close(); }
});

for (const [width, height] of [[1280, 800], [640, 400]]) {
  test(`${width}x${height}: no block overflows its box sideways, even with long labels`, async () => {
    const long = (id) => FX[id].rows.map((r, i) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k,
      ['label', 'stage', 'group', 'region', 'source', 'target'].some((role) => FX[id].bind[role] === k) && typeof v === 'string' ? `${v} with an unusually long descriptive name number ${i}` : v])));
    const { page, context } = await open(BLOCK_IDS.map((id) => item(id, { rows: long(id), focus: undefined })), { width, height });
    try {
      for (const id of BLOCK_IDS) {
        const m = await page.locator(`[data-cell="${id}"]`).evaluate((cell) => {
          const c = cell.getBoundingClientRect(); const v = cell.querySelector('[data-viz]').getBoundingClientRect();
          return { cellOver: cell.scrollWidth - cell.clientWidth, right: v.right - c.right, left: c.left - v.left, wide: v.width };
        });
        assert.ok(m.cellOver <= 1, `${id}: cell scrolls sideways by ${m.cellOver}`);
        assert.ok(m.right <= 1 && m.left <= 1, `${id}: block outside its box ${JSON.stringify(m)}`);
        assert.ok(m.wide > 100, `${id}: block has a real width`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'page does not scroll sideways');
    } finally { await context.close(); }
  });
}
