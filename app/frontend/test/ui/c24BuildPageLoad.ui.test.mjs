import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { built, STUDIO_STATE } from './implementFixtures.js';

test.after(closeBrowser);

// RC7-C-06 (T-BLD-09): the Build page waits for the first build-status answer before it says "No MVP started yet".
// RC7-C-05 (T-BLD-10): an open progress panel pushes the page aside instead of covering it.
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const mountBase = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
};
const NOTHING_BUILT = { result_rows: null, asset_status: null, dashboard_id: null, dashboard_url: null, genie_space_id: null, genie_space_url: null,
  app_name: null, app_url: null, alert_id: null, alert_url: null };
const BUILDING = () => built({ spec_version: 2, status: 'building_outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString(), ...NOTHING_BUILT });

async function go(page, hash) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.body.innerText.includes('Connecting to workspace'), null, { timeout: 20000 });
  await page.evaluate((target) => { window.location.hash = target; }, hash);
}

test('C-06: while the first build-status read is pending the Build page says loading, never "No MVP started yet"', async () => {
  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });
  const row = BUILDING();
  const mount = (app) => {
    mountBase(app);
    app.get('/api/inspire/implement/history', async (_req, res) => { await held; res.json({ latest: [row], notebook_run: null }); });
  };
  const ui = await openUi('app', { ...REVIEW_STATE, history: [row] }, '', { mount });
  const { page } = ui;
  try {
    await go(page, '#/build/42/N01-U01');
    await page.locator('[data-implement-page]').waitFor({ timeout: 20000 });
    await page.getByText('Loading the build...', { exact: false }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const text = await page.locator('[data-implement-page]').innerText();
    assert.doesNotMatch(text, /No MVP started yet/, 'no empty message before the first status answer (must-exclude)');
    assert.doesNotMatch(text, /NOTEBOOK READY/, 'no notebook-ready card before the first status answer');
    release();
    await page.getByText('1 MVP building now', { exact: true }).waitFor({ timeout: 20000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    release();
    await ui.close();
  }
});

test('C-06: a first answer with no MVP shows the empty message', async () => {
  const ui = await openUi('app', { ...REVIEW_STATE, history: [] }, '', { mount: mountBase });
  const { page } = ui;
  try {
    await go(page, '#/build/42/N01-U01');
    await page.getByText('No MVP started yet', { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await page.getByText('Loading the build...', { exact: false }).count(), 0, 'loading text is gone once the answer is in');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

for (const width of [1280, 1440, 1920]) {
  test(`C-05: at ${width} px the open progress panel does not cover or clip the Build page`, async () => {
    const ui = await openUi('implement', { ...STUDIO_STATE, history: [BUILDING()],
      implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
    const { page } = ui;
    try {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
      const card = page.locator('[data-progress-card]');
      await card.waitFor({ timeout: 20000 });
      if (await card.getAttribute('data-progress-open') === 'false') await card.locator('[data-progress-show]').click();
      await page.locator('[data-progress-panel]').waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      const got = await page.evaluate(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, scroll: el.scrollWidth, client: el.clientWidth, name: el.getAttribute('aria-label') || el.dataset.assetTile || el.tagName }; };
        const panel = box(document.querySelector('[data-progress-panel]'));
        const parts = [...document.querySelectorAll('[aria-label="Build summary"], [aria-label="Use case"], [data-asset-tile], [data-asset-tiles]')].map(box).filter((b) => b.w > 0);
        return { panel, parts, doc: document.documentElement.scrollWidth, view: window.innerWidth };
      });
      assert.ok(got.parts.length >= 3, 'the summary, the detail and the asset cards are measured');
      const covered = got.parts.filter((p) => p.r > got.panel.l + 1).map((p) => `${p.name} right=${Math.round(p.r)} panel left=${Math.round(got.panel.l)}`);
      assert.deepEqual(covered, [], `nothing sits under the panel at ${width} px (must-fail: the panel overlays the page)`);
      const clipped = got.parts.filter((p) => p.scroll > p.client + 1).map((p) => `${p.name} ${p.scroll}>${p.client}`);
      assert.deepEqual(clipped, [], 'nothing is clipped');
      const counters = await page.evaluate((panelLeft) => [...document.querySelectorAll('[aria-label="Build summary"] *')]
        .filter((el) => el.children.length === 0 && el.textContent.trim()).map((el) => ({ t: el.textContent.trim(), r: el.getBoundingClientRect().right }))
        .filter((x) => x.r > panelLeft + 1), got.panel.l);
      assert.deepEqual(counters, [], 'the summary counters stay left of the panel');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}
