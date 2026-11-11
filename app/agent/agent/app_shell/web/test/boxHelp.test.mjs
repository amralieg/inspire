import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DECIDE, appInfo, goRail, openApp, serveDist } from './harness.mjs';
import { scenarioRoutes } from './exampleRoutes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = readdirSync(join(HERE, '..', '..', 'examples')).filter((f) => f.endsWith('.json')).sort();
const STILL = (p) => p.emulateMedia({ reducedMotion: 'reduce' });
const VIEWS = ['work', 'runs', 'settings'];

let served;
let base;
let browser;
before(async () => { served = await serveDist(); base = served.base; browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const BOXES = () => [...document.querySelectorAll('.main .card, .main .set-group:has(> p.why)')]
  .filter((el) => el.getAttribute('role') !== 'status' && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
  .map((el) => ({
    name: el.getAttribute('aria-label') || el.querySelector('h2, h3')?.textContent?.trim() || el.className,
    help: el.matches('.set-group') ? !!el.querySelector('[data-section-help]')
      : !!el.querySelector(':scope > header.card-h [data-section-help]'),
  }));

function failedLoads(page) {
  const bad = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  return bad;
}

for (const file of EXAMPLES) {
  test(`every box on the ${file} layout, on its dashboard, Work, Runs and Settings, shows a ? that says what to do there`, async () => {
    const routes = file.startsWith('scenario') ? scenarioRoutes([], []) : {};
    const loads = [];
    const { page, context, seen } = await openApp(browser, base, appInfo(DECIDE, 1, {}, `examples/${file}`),
      { watch: (p) => { STILL(p); loads.push(...failedLoads(p)); }, routes });
    await page.waitForSelector('.main .card', { state: 'visible', timeout: 20000 });
    await page.waitForTimeout(600);
    const missing = {};
    const walk = async (view) => {
      const boxes = await page.evaluate(BOXES);
      if (view === 'dashboard') assert.ok(boxes.length > 0, `${file}: the dashboard shows at least one box`);
      missing[view] = boxes.filter((b) => !b.help).map((b) => b.name);
    };
    await walk('dashboard');
    for (const view of VIEWS) {
      if (!(await page.locator(`[data-rail="${view}"]`).count())) continue;
      await goRail(page, view);
      await page.waitForTimeout(600);
      await walk(view);
    }
    for (const [view, names] of Object.entries(missing)) assert.deepEqual(names, [], `${file} ${view}: boxes without a ?`);
    assert.deepEqual(loads, [], `${file}: no failed request while the page loads`);
    assert.ok(!seen.errors.some((e) => /Uncaught|TypeError|ReferenceError/.test(String(e))), `${file}: no page error`);
    await context.close();
  });
}
