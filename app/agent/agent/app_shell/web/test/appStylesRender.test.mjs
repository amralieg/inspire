// REQ-416 browser check: every App style renders its kind's style at 1440x900 and 1280x800, with no console errors. The Agent page stays off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DECIDE, appInfo, openApp, serveDist } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_SHELL = join(HERE, '..', '..');
// Screenshots go to APP_STYLE_SHOTS when set (a fresh folder per run), else to the system temp folder.
const SHOTS = process.env.APP_STYLE_SHOTS || join(tmpdir(), 'app-style-shots');
const REGISTRY = JSON.parse(readFileSync(join(APP_SHELL, 'kinds.json'), 'utf8'));
const SIZES = [[1440, 900], [1280, 800]];
// One representative kind per style. Each kind is served from the App example of its own layout.
const WHO = { news: 'variance_to_plan', league: 'peer_benchmarking', mail: 'risk_propensity', kanban: 'controls_testing', sheet: 'allocation',
  lab: 'pricing', cockpit: 'forecast', map: 'site_territory', flow: 'journey_path', graph: 'fraud_rings', answer: 'data_agent' };
const LABEL = Object.fromEntries(REGISTRY.app_styles.map((s) => [s.id, s.label]));
const COORDINATES = { detail: [{ column: 'latitude', label: 'Lat', format: 'text' }, { column: 'longitude', label: 'Long', format: 'text' }] };

const exampleOf = (kindId) => {
  const layout = REGISTRY.kinds.find((k) => k.id === kindId).layout;
  return layout === 'decision_queue' ? 'example_page.json' : `examples/${layout}.json`;
};
const errorsOf = (seen) => seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e));

let served;
let browser;

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

// Opens one App whose page is `kindId`, with optional page changes, and waits for the page to draw.
async function openKind(kindId, { width = 1440, height = 900, changes = {}, options = DECIDE } = {}) {
  const info = appInfo(options, 1, { kind: kindId, ...changes }, exampleOf(kindId));
  const opened = await openApp(browser, served.base, info, { width, height, hash: `#/${info.pages[0].id}/dashboard` });
  await opened.page.locator('.page').first().waitFor({ timeout: 20000 });
  return opened;
}

for (const [style, kindId] of Object.entries(WHO)) {
  for (const [width, height] of SIZES) {
    test(`the ${style} style (${LABEL[style]}) draws ${kindId} at ${width}x${height}, with no console errors`, async () => {
      // A map is drawn as a map only when its page has coordinates, so the map gets them here and the test below checks the fallback.
      const changes = style === 'map' ? { records: { ...exampleRecords(kindId), ...COORDINATES } } : {};
      const { page, seen, context } = await openKind(kindId, { width, height, changes });
      try {
        await page.locator(`.page[data-app-style="${style}"]`).waitFor({ timeout: 20000 });
        // The one-line style kicker is gone from the 2-line header; the style is carried by the App root and the page.
        assert.equal(await page.locator(`.app[data-app-style="${style}"]`).count(), 1, `the App root names the ${LABEL[style]} style`);
        await page.screenshot({ path: join(SHOTS, `${style}-${width}x${height}.png`) });
        assert.deepEqual(errorsOf(seen), [], 'no console errors');
      } finally {
        await context.close();
      }
    });
  }
}

function exampleRecords(kindId) {
  return JSON.parse(readFileSync(join(APP_SHELL, exampleOf(kindId)), 'utf8')).records;
}

test('a map without coordinates draws as its league fallback and the App root says so', async () => {
  const { page, seen, context } = await openKind(WHO.map);
  try {
    await page.locator('.page[data-app-style="league"]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.page[data-app-style="map"]').count(), 0, 'no map style without coordinates');
    assert.equal(await page.locator('.app[data-app-style="league"]').count(), 1, `the App root names the ${LABEL.league} style`);
    assert.deepEqual(errorsOf(seen), [], 'no console errors');
  } finally {
    await context.close();
  }
});

// Ask Genie opens over the page in every style. On the dark styles its empty-state text must still read: WCAG contrast of at least 4.5 to 1.
const contrastOf = (page) => page.evaluate(() => {
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (css) => css.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  // The text a reader sees first in the panel (its empty state) against the conversation surface behind it.
  const text = document.querySelector('aside.genie .g-empty') || document.querySelector('aside.genie');
  const surface = document.querySelector('aside.genie .g-log') || document.querySelector('aside.genie');
  const ink = getComputedStyle(text);
  const under = getComputedStyle(surface);
  const a = luminance(parse(ink.color)) + 0.05;
  const b = luminance(parse(under.backgroundColor)) + 0.05;
  return { ratio: Math.max(a, b) / Math.min(a, b), background: under.backgroundColor, color: ink.color };
});

for (const style of ['cockpit', 'graph']) {
  for (const [width, height] of SIZES) {
    test(`Ask Genie stays readable over the ${style} style at ${width}x${height}`, async () => {
      const { page, seen, context } = await openKind(WHO[style], { width, height });
      try {
        await page.locator('[data-mode-switch] [data-mode="genie"]').click();
        await page.locator('aside.genie').waitFor({ timeout: 20000 });
        const { ratio, background, color } = await contrastOf(page);
        assert.ok(ratio >= 4.5, `contrast ${ratio.toFixed(2)} of text ${color} on ${background} is below 4.5`);
        await page.screenshot({ path: join(SHOTS, `genie-${style}-${width}x${height}.png`) });
        assert.deepEqual(errorsOf(seen), [], 'no console errors');
      } finally {
        await context.close();
      }
    });
  }
}

