import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const FOLDER = '/Workspace/Users/someone/inspire/acme';
const FILES = { 'Acme-catalog.pdf': 'pdf-bytes', 'Acme-catalog.xlsx': 'xlsx-bytes' };
const mount = (app) => {
  app.get('/api/workspace/list', (_req, res) => res.json({ files: Object.keys(FILES).map((name) => ({ name, path: `${FOLDER}/${name}`, is_directory: false, file_size: 2048 })) }));
  app.get('/api/workspace/export', (req, res) => res.type('application/octet-stream').send(FILES[String(req.query.path).split('/').pop()] || ''));
};
const sessions = REVIEW_SESSIONS.map((s) => (s.session_id === '42' ? { ...s, generation_path: FOLDER, widget_values: { ...s.widget_values, generation_path: FOLDER } } : s));
const STATE = { ...REVIEW_STATE, sessions };

const nav = (page) => page.getByRole('navigation', { name: 'Results sections' });
const item = (page, name) => nav(page).getByRole('button', { name: new RegExp(`^${name}\\b`) });
const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cards = (page) => list(page).locator('[aria-expanded]');
const summary = (page) => page.locator('[data-executive-summary]');
const figures = (page) => page.getByRole('region', { name: 'Figures of this run' });
const mvps = (page) => page.getByRole('group', { name: 'MVPs' });
const download = (page, name) => page.getByRole('button', { name: `Download ${name}` });

async function open(extra = {}) {
  const ui = await openUi('results', STATE, '', { mount, ...extra });
  await cards(ui.page).first().waitFor();
  return ui;
}

test('Results lands on Use cases: the nav lists Use cases, Business and Assets in that order, the Domains tree sits under Use cases, and the summary, figures and files are not shown', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await nav(page).waitFor();
    assert.deepEqual((await nav(page).locator('[data-results-nav-item]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().replace(/ \d+$/, '')), ['Use cases', 'Business', 'Assets']);
    assert.equal(await item(page, 'Use cases').getAttribute('aria-current'), 'page');
    assert.equal(await item(page, 'Business').getAttribute('aria-current'), null);
    assert.equal(await item(page, 'Assets').getAttribute('aria-current'), null);
    assert.match(await item(page, 'Use cases').innerText(), /6/, 'Use cases carries its count');
    assert.equal(await cards(page).count(), 6);
    const under = nav(page).locator('li', { has: page.locator('[data-results-nav-item="usecases"]') });
    assert.equal(await under.getByRole('button', { name: /^Domains\b/ }).count(), 1, 'the Domains tree is under Use cases');
    assert.equal(await under.getByRole('button', { name: /^Supply\b/ }).count(), 1);
    assert.equal(await summary(page).count(), 0);
    assert.equal(await figures(page).count(), 0);
    assert.equal(await download(page, 'Acme-catalog.pdf').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Domains tree folds and unfolds, and a domain narrows the cards', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    const toggle = nav(page).getByRole('button', { name: /^Domains\b/ });
    const supply = nav(page).getByRole('button', { name: /^Supply\b/ });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'open by default');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await supply.count(), 0, 'folded: no domain shows');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await supply.click();
    assert.equal(await cards(page).count(), 2);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Business shows the executive summary, the figure tiles and the MVPs group, and no cards; an MVP tile leads back to the cards it filters', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await item(page, 'Business').click();
    assert.equal(await item(page, 'Business').getAttribute('aria-current'), 'page');
    await summary(page).waitFor();
    await figures(page).waitFor();
    await mvps(page).waitFor();
    assert.equal(await figures(page).locator('[data-stat="Use Cases"]').count(), 1);
    assert.equal(await cards(page).count(), 0);
    assert.equal(await list(page).count(), 0);
    assert.equal(await download(page, 'Acme-catalog.pdf').count(), 0);
    assert.equal(await nav(page).getByRole('button', { name: /^Domains\b/ }).count(), 0, 'the Domains tree shows only with Use cases');
    await mvps(page).getByRole('button', { name: /^MVPs started/ }).click();
    assert.equal(await item(page, 'Use cases').getAttribute('aria-current'), 'page');
    assert.equal(await cards(page).count(), 1, 'the MVP filter is applied on the cards');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Assets shows every generated file with its Download button, and Download sends the same request as before', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await item(page, 'Assets').click();
    assert.equal(await item(page, 'Assets').getAttribute('aria-current'), 'page');
    await download(page, 'Acme-catalog.pdf').first().waitFor({ timeout: 15000 });
    await download(page, 'Acme-catalog.xlsx').first().waitFor();
    assert.equal(await cards(page).count(), 0);
    assert.equal(await summary(page).count(), 0);
    const sent = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/workspace/export' && r.url().includes('Acme-catalog.pdf'));
    await download(page, 'Acme-catalog.pdf').first().click();
    const request = await sent;
    assert.equal(new URL(request.url()).searchParams.get('path'), `${FOLDER}/Acme-catalog.pdf`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the view lives in the URL: it survives a reload and Back returns to the view before', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await item(page, 'Business').click();
    await summary(page).waitFor();
    await item(page, 'Assets').click();
    await download(page, 'Acme-catalog.pdf').first().waitFor({ timeout: 15000 });
    assert.match(page.url(), /view=assets/);
    await page.reload();
    await nav(page).waitFor();
    await until(async () => (await item(page, 'Assets').getAttribute('aria-current')) === 'page', 'Assets is the current view after the reload');
    await download(page, 'Acme-catalog.pdf').first().waitFor({ timeout: 15000 });
    await page.goBack();
    await summary(page).waitFor();
    assert.equal(await item(page, 'Business').getAttribute('aria-current'), 'page');
    await page.goBack();
    await cards(page).first().waitFor();
    assert.equal(await item(page, 'Use cases').getAttribute('aria-current'), 'page');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('at 390 px the nav is a row of 3 tabs above the content and no view scrolls sideways', async () => {
  const ui = await open({ init: (page) => page.setViewportSize({ width: 390, height: 800 }) });
  const { page } = ui;
  try {
    await nav(page).waitFor();
    const tabs = await Promise.all(['Use cases', 'Business', 'Assets'].map((n) => item(page, n).boundingBox()));
    assert.ok(tabs.every((b) => Math.abs(b.y - tabs[0].y) < 2), `one row: ${JSON.stringify(tabs)}`);
    const cardTop = (await cards(page).first().boundingBox()).y;
    assert.ok(tabs.every((b) => b.y + b.height <= cardTop), 'tabs sit above the cards');
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.equal(await sideways(), true, 'Use cases');
    await nav(page).getByRole('button', { name: /^Domains\b/ }).click();
    assert.equal(await sideways(), true, 'Use cases with the Domains fold open');
    await item(page, 'Business').click();
    await summary(page).waitFor();
    assert.equal(await sideways(), true, 'Business');
    await item(page, 'Assets').click();
    await download(page, 'Acme-catalog.pdf').first().waitFor({ timeout: 15000 });
    assert.equal(await sideways(), true, 'Assets');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('right to left, the side panel sits on the right of the content', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    const side = await nav(page).boundingBox();
    const content = await list(page).boundingBox();
    assert.ok(side.x >= content.x + content.width - 1, `nav ${JSON.stringify(side)} vs list ${JSON.stringify(content)}`);
    await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
    const sideLtr = await nav(page).boundingBox();
    const contentLtr = await list(page).boundingBox();
    assert.ok(sideLtr.x + sideLtr.width <= contentLtr.x + 1, 'left to right the panel is on the left');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('leaving Results leaves ?view= behind, so no other page carries it', async () => {
  const appMount = (app) => {
    mount(app);
    app.get('/api/defaults', (_req, res) => res.json({ envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com',
      warehouseId: 'wh1', inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' }));
    app.get('/api/showcase', (_req, res) => res.json({}));
  };
  const ui = await openUi('app', { ...STATE, knownRuns: ['42', '41', '50', '51', '60', '61'] }, '#/review/42', { mount: appMount });
  await cards(ui.page).first().waitFor();
  const { page } = ui;
  try {
    await item(page, 'Assets').click();
    await until(async () => new URL(page.url()).searchParams.get('view') === 'assets', 'the URL holds view=assets');
    await page.evaluate(() => { window.location.hash = '#/start'; });
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('view'), null, page.url());
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
