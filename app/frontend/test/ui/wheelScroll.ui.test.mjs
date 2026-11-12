import test from 'node:test';
import assert from 'node:assert/strict';
import { RESULTS, STUDIO_STATE } from './implementFixtures.js';
import { closeBrowser, openAsset, openFeatures, openSettings, openUi } from './uiSupport.mjs';
import { dropCopies, fillWithCopies, wheelScrolls } from './wheelScroll.mjs';

test.after(closeBrowser);

const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString().slice(0, 19).replace('T', ' ');
const LAST_LINE = 'Last I checked the alert query against the latest run.';
const LIVE_LOG = `${[...Array.from({ length: 400 }, (_, i) => `${ago(300 - Math.floor(i / 2))} - inspire - INFO - [GENIE N01-U01] [build] Genie: Step ${i}: I checked the notebook and the workflow before I built the dashboard.`),
  `${ago(1)} - inspire - INFO - [GENIE N01-U01] [build] Genie: ${LAST_LINE}`].join('\n')}\n`;

const copies = (region, item, n) => ({
  fill: () => fillWithCopies(region, item, n),
  unfill: () => dropCopies(region),
});

test('the mouse wheel scrolls the use case list, the use case pane, the Build progress log and every drawer to their last item at 1280x800 and 1024x700', async () => {
  const ui = await openUi('implement', { ...STUDIO_STATE, liveLog: LIVE_LOG });
  const { page } = ui;
  try {
    await page.locator('[data-asset-tiles]').waitFor({ timeout: 20000 });
    const list = page.getByRole('navigation', { name: 'Use cases', exact: true });
    await list.locator('section').first().waitFor();
    await wheelScrolls(page, list, () => list.locator('[data-wheel-copy]').last(), { name: 'use case list', ...copies(list, ':scope > section', 30) });

    const pane = page.locator('section[aria-label="Use case"]');
    await wheelScrolls(page, pane, () => pane.locator('[data-progress-card]').last(), { name: 'use case pane', ...copies(pane, ':scope > *', 2) });

    await page.setViewportSize({ width: 1280, height: 800 });
    if ((await page.locator('[data-progress-card]').getAttribute('data-progress-open')) !== 'true') {
      await page.locator('[data-progress-card]').getByRole('button', { name: 'Show progress', exact: true }).click();
    }
    const log = page.locator('[data-mvp-progress] [data-build-log]');
    await log.getByText(LAST_LINE, { exact: true }).waitFor({ state: 'attached', timeout: 30000 });
    await wheelScrolls(page, log, () => log.getByText(LAST_LINE, { exact: true }), { name: 'Build progress log' });
    await page.locator('[data-mvp-progress]').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('[data-mvp-progress]').waitFor({ state: 'detached' });

    await page.setViewportSize({ width: 1280, height: 800 });
    const drawer = (await openAsset(page, 'job')).locator('[role="dialog"] > .overflow-y-auto');
    await wheelScrolls(page, drawer, () => drawer.locator(':scope > :last-child'), { name: 'asset drawer', ...copies(drawer, ':scope > *', 6) });
    await page.keyboard.press('Escape');
    await page.locator('[data-mvp-panel]').waitFor({ state: 'detached' });

    await page.setViewportSize({ width: 1280, height: 800 });
    const features = (await openFeatures(page)).locator('[role="dialog"] > .overflow-y-auto');
    await wheelScrolls(page, features, () => features.locator(':scope > :last-child'), { name: 'vibes drawer', ...copies(features, ':scope > *', 6) });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the mouse wheel scrolls the wizard step and its settings list to their last item at 1280x800 and 1024x700', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page } = ui;
  try {
    await page.locator('[data-asset-tiles]').waitFor({ timeout: 20000 });
    await page.setViewportSize({ width: 1280, height: 800 });
    const wizard = await openSettings(page);
    const body = wizard.locator('[data-wizard-body]');
    await wheelScrolls(page, body, () => body.locator(':scope > :last-child'), { name: 'wizard step', ...copies(body, ':scope > *', 8) });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const many = {
  ...RESULTS,
  domains: RESULTS.domains.map((d) => ({ ...d, use_cases: Array.from({ length: 8 }, (_, k) => d.use_cases.map((u) => ({ ...u, No: `${u.No}${k ? `-${k}` : ''}`, Name: k ? `${u.Name} ${k}` : u.Name }))).flat() })),
};

test('the mouse wheel scrolls the Results use case list and its side filters to their last item at 1280x800 and 1024x700', async () => {
  const ui = await openUi('results', { results: many, useCases: [] });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[aria-expanded]').first().waitFor({ timeout: 20000 });
    const scroller = list.locator('xpath=ancestor-or-self::*[contains(@class,"overflow-y-auto")][1]');
    await wheelScrolls(page, scroller, () => list.locator('[aria-expanded]').last(), { name: 'Results use case list' });
    const side = page.locator('[data-browse] > div').first();
    await wheelScrolls(page, side, () => side.locator('[data-wheel-copy]').last(), { name: 'Results side filters', ...copies(side, ':scope > :first-child', 20) });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the mouse wheel scrolls the Monitor run log to its last line at 1280x800 and 1024x700', async () => {
  const lines = `${Array.from({ length: 300 }, (_, i) => `${ago(300 - i)} - inspire - INFO - step ${i} read the catalog and scored the use cases`).join('\n')}\nthe run log ends here\n`;
  const mount = (app) => {
    app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, run_name: 'Inspire Discover', life_cycle_state: 'RUNNING' }));
    app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
    app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', completed_percent: 40, processing_status: 'running', completed_on: null } }));
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
    app.get('/api/inspire/log', (_req, res) => res.json({ found: true, truncated: false, text: lines, size: lines.length }));
  };
  const ui = await openUi('monitor', {}, '', { mount });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Show the run log' }).click();
    const pre = page.getByLabel('Run log');
    await pre.waitFor({ timeout: 10000 });
    await wheelScrolls(page, pre, () => pre.getByText('the run log ends here'), { name: 'Monitor run log' });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
