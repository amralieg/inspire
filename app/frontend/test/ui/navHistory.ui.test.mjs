import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { NAV_TABS } from '../../src/lib/tabs.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const SETUP_FIRST = { isDatabricksApp: false, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1', inspireDatabase: 'main.inspire' };
const DEMOS = { showcases: [{ id: 'acme', session_id: '42', title: 'Acme retail', business: 'Acme', summary: 'Demo' }] };
const mounted = (defaults, showcases = {}) => (app) => {
  app.get('/api/defaults', (_req, res) => res.json(defaults));
  app.get('/api/showcase', (_req, res) => res.json(showcases));
};
const KNOWN = { ...REVIEW_STATE, knownRuns: ['42', '41', '50', '51', '60', '61'] };
const hash = (page) => page.evaluate(() => window.location.hash);
const depth = (page) => page.evaluate(() => window.history.length);
const tab = (page, label) => page.locator('header nav button').filter({ hasText: new RegExp(`${label}$`) });
const current = (page) => page.locator('header nav button[aria-current="page"]').innerText().then((t) => t.replace(/\s+/g, ' ').trim());
const at = (page, want) => page.waitForFunction((h) => window.location.hash === h, want, { timeout: 20000 });

const SHOWN = {
  '#/home': (page) => page.getByText('Scroll to explore').waitFor({ timeout: 20000 }),
  '#/start': (page) => page.getByRole('heading', { name: 'Welcome back' }).waitFor({ timeout: 20000 }),
  '#/review/42': (page) => page.locator('[data-run-heading] [data-run-business]').filter({ hasText: 'Acme' }).waitFor({ timeout: 20000 }),
  '#/build/42': (page) => page.getByRole('heading', { level: 1, name: 'Build' }).waitFor({ timeout: 20000 }),
};

test('the Home tab comes first, opens the home page, and every tab badge counts from it', async () => {
  const ui = await openUi('app', KNOWN, '', { mount: mounted(DEFAULTS) });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await SHOWN['#/start'](page);
    const labels = (await page.locator('header nav button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    assert.deepEqual(labels, NAV_TABS.map((t, i) => `${String(i + 1).padStart(2, '0')} ${t.label}`));
    assert.equal(labels[0], '01 Home');
    assert.equal(await current(page), '02 Start');
    await tab(page, 'Review').click();
    await page.getByRole('heading', { level: 1, name: 'Review' }).waitFor({ timeout: 20000 });
    await tab(page, 'Home').click();
    await SHOWN['#/home'](page);
    assert.equal(await hash(page), '#/home');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('every page change adds one history entry, Back and Forward walk them in order, and a click on the open page adds none (must-exclude)', async () => {
  const ui = await openUi('app', KNOWN, '', { mount: mounted(DEFAULTS) });
  const { page } = ui;
  try {
    await SHOWN['#/home'](page);
    assert.equal(await hash(page), '#/home', 'the first page replaces the entry it loaded in');
    const start = await depth(page);
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await at(page, '#/start');
    await SHOWN['#/start'](page);
    await page.locator('[data-run="42"]').first().click();
    await at(page, '#/review/42');
    await SHOWN['#/review/42'](page);
    await tab(page, 'Build').click();
    await at(page, '#/build/42');
    await SHOWN['#/build/42'](page);
    assert.equal(await depth(page), start + 3, 'three page changes, three entries');

    await tab(page, 'Build').click();
    await idle(page);
    assert.equal(await depth(page), start + 3, 'opening the page already shown adds no entry');
    assert.equal(await hash(page), '#/build/42');

    for (const want of ['#/review/42', '#/start', '#/home']) {
      await page.goBack();
      await at(page, want);
      await SHOWN[want](page);
    }
    for (const want of ['#/start', '#/review/42']) {
      await page.goForward();
      await at(page, want);
      await SHOWN[want](page);
    }
    assert.equal(await current(page), '04 Review');
    assert.equal(await depth(page), start + 3, 'Back and Forward add no entries of their own');
    assert.equal(await page.locator('[data-review-left-demo], [data-run-left-demo]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a reload, or a deep link opened in a new tab, shows the page the address names', async () => {
  for (const want of ['#/start', '#/review/42', '#/build/42', '#/home']) {
    const ui = await openUi('app', KNOWN, '', { mount: mounted(DEFAULTS) });
    const { page, origin } = ui;
    try {
      await SHOWN['#/home'](page);
      await page.goto(`${origin}/test/ui/implement.html?open=app${want}`);
      await SHOWN[want](page);
      assert.equal(await hash(page), want, want);
      await page.reload();
      await SHOWN[want](page);
      assert.equal(await hash(page), want, `${want} after a reload`);
      assert.deepEqual(ui.pageErrors, [], want);
    } finally {
      await ui.close();
    }
  }
  const ui = await openUi('app', KNOWN, '', { mount: mounted(DEFAULTS) });
  const { page, origin } = ui;
  try {
    await page.goto(`${origin}/test/ui/implement.html?open=app#/build/42/N01-U02`);
    await SHOWN['#/build/42'](page);
    await page.locator('nav[aria-label="Use cases"] button[aria-current="true"]').filter({ hasText: 'N01-U02' }).waitFor({ timeout: 20000 });
    assert.equal(await hash(page), '#/build/42/N01-U02', 'a Build link keeps the use case it names');
    await page.evaluate(() => { window.location.hash = '#/nowhere'; });
    await at(page, '#/build/42/N01-U02');
    assert.equal(await current(page), '05 Build', 'a typed address that names no page keeps the page open and puts its address back');
    await page.evaluate(() => window.history.replaceState(null, '', '?open=app#/nowhere'));
    await page.reload();
    await SHOWN['#/home'](page);
    assert.equal(await hash(page), '#/home', 'a load on an address that names no page opens the home page and says so in the address');
  } finally {
    await ui.close();
  }
});

test('an address changed while Inspire still loads opens the page it names once loading ends, never the page of the address it started on', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const slow = (app) => {
    app.get('/api/defaults', async (_req, res) => { await held; res.json(DEFAULTS); });
    app.get('/api/showcase', (_req, res) => res.json({}));
  };
  const ui = await openUi('app', KNOWN, '', { mount: slow });
  const { page } = ui;
  try {
    await page.evaluate(() => { window.location.hash = '#/build/42'; });
    release();
    await SHOWN['#/build/42'](page);
    assert.equal(await hash(page), '#/build/42');
    assert.equal(await page.getByText('Scroll to explore').count(), 0, 'the home page of the first address is not shown (must-exclude)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    release();
    await ui.close();
  }
});

test('opening a page from the address never writes the address of the page it leaves while the page changes', async () => {
  const ui = await openUi('app', KNOWN, '', { mount: mounted(DEFAULTS) });
  const { page } = ui;
  try {
    await SHOWN['#/home'](page);
    await page.evaluate(() => {
      window.writtenHashes = [];
      const replace = window.history.replaceState.bind(window.history);
      window.history.replaceState = (state, title, url) => { window.writtenHashes.push(new URL(url, window.location.href).hash); return replace(state, title, url); };
    });
    await page.evaluate(() => { window.location.hash = '#/build/42'; });
    await SHOWN['#/build/42'](page);
    assert.equal(await hash(page), '#/build/42');
    const written = await page.evaluate(() => window.writtenHashes);
    assert.equal(written.includes('#/home'), false, `the address went back to the page being left: ${written.join(', ')} (must-exclude)`);
    await page.evaluate(() => { window.location.hash = '#/nowhere'; });
    await at(page, '#/build/42');
    assert.equal(await current(page), '05 Build', 'an address that names no page is still put back');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a reload on a page link before Inspire is set up still shows the setup wizard first, then the page', async () => {
  const ui = await openUi('app', KNOWN, '', { mount: mounted(SETUP_FIRST) });
  const { page, origin } = ui;
  try {
    await page.goto(`${origin}/test/ui/implement.html?open=app#/start`);
    const skip = page.getByRole('button', { name: 'Skip setup' });
    await skip.waitFor({ timeout: 20000 });
    assert.equal(await hash(page), '#/start', 'the link waits in the address while setup shows');
    await page.reload();
    await skip.waitFor({ timeout: 20000 });
    assert.equal(await page.getByRole('heading', { name: 'Welcome back' }).count(), 0, 'setup still comes first after a reload (must-exclude)');
    await skip.click();
    await SHOWN['#/start'](page);
    assert.equal(await hash(page), '#/start');
  } finally {
    await ui.close();
  }
});

test('the demo keeps its own addresses: a reload stays in the demo on the same page, and Back moves between demo pages without leaving it', async () => {
  const ui = await openUi('app', KNOWN, '', { mount: mounted(DEFAULTS, DEMOS) });
  const { page } = ui;
  const bar = page.getByRole('region', { name: 'Demo' });
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('[data-start-choice="demo"]').click();
    await bar.waitFor({ timeout: 20000 });
    await at(page, '#/demo/acme/review');
    await tab(page, 'Build').click();
    await at(page, '#/demo/acme/build');
    await page.reload();
    await bar.waitFor({ timeout: 20000 });
    assert.equal(await current(page), '05 Build', 'the reload reopens the demo on its Build page');
    assert.equal(await hash(page), '#/demo/acme/build');
    await page.goBack();
    await at(page, '#/demo/acme/review');
    await page.locator('header nav button[aria-current="page"]').filter({ hasText: /Review$/ }).waitFor({ timeout: 20000 });
    await bar.waitFor();
    assert.equal(await current(page), '04 Review');
    assert.equal(await hash(page), '#/demo/acme/review');
    assert.equal(await page.locator('[data-review-left-demo], [data-run-left-demo]').count(), 0, 'going Back inside the demo never says the demo was left');
  } finally {
    await ui.close();
  }
});
