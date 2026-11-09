import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { sideScroll, unnamedControls, weakFocus } from '../../../agent/agent/app_shell/web/test/access.mjs';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
};
const KNOWN = { ...REVIEW_STATE, knownRuns: ['42', '41', '50', '51', '60', '61'] };

const PAGES = {
  '#/home': (page) => page.getByRole('button', { name: 'Get Started' }).first().waitFor({ timeout: 20000 }),
  '#/start': (page) => page.getByRole('heading', { name: 'Welcome back' }).waitFor({ timeout: 20000 }),
  '#/monitor/42': (page) => heading(page, 'Monitor'),
  '#/review/42': (page) => heading(page, 'Review'),
  '#/build/42': (page) => heading(page, 'Build'),
  '#/run': (page) => heading(page, 'Run'),
};
const heading = (page, name) => page.locator('h1').filter({ hasText: new RegExp(`^${name}$`) }).waitFor({ timeout: 20000 });

async function openAt(hash, size) {
  const ui = await openUi('app', KNOWN, hash, { mount, init: (page) => page.setViewportSize(size) });
  await PAGES[hash](ui.page);
  await idle(ui.page);
  return ui;
}

for (const hash of Object.keys(PAGES)) {
  test(`${hash} at 1280x800 names every control for a screen reader and shows a ring of at least 3:1 contrast on every control the keyboard reaches`, async () => {
    const ui = await openAt(hash, { width: 1280, height: 800 });
    try {
      assert.deepEqual(await unnamedControls(ui.page), [], `${hash}: controls a screen reader reads with no name`);
      const walk = await weakFocus(ui.page, { max: 45 });
      assert.ok(walk.checked >= 5, `${hash}: the keyboard reached ${walk.checked} controls`);
      assert.deepEqual(walk.weak, [], `${hash}: controls with no visible focus`);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });

  test(`${hash} at 200% zoom of a 1280x800 screen never scrolls sideways`, async () => {
    const ui = await openAt(hash, { width: 640, height: 400 });
    try {
      assert.ok(await sideScroll(ui.page) <= 0, `${hash} scrolls sideways by ${await sideScroll(ui.page)} px`);
    } finally {
      await ui.close();
    }
  });
}

test('the checks catch a control with no name, a control with its focus ring removed and a page wider than the screen (must-exclude)', async () => {
  const ui = await openAt('#/start', { width: 640, height: 400 });
  try {
    await ui.page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<div id="seeded" style="position:fixed;top:120px;left:40px;z-index:99;display:flex;gap:16px;padding:16px;background:#fff">'
        + '<select><option>One</option></select><button type="button" style="outline:none">Hidden ring</button><button type="button">Plain ring</button></div>');
      document.body.insertAdjacentHTML('beforeend', '<div style="width:900px;height:1px"></div>');
    });
    assert.deepEqual(await unnamedControls(ui.page, '#seeded'), ['- combobox:']);
    assert.ok(await sideScroll(ui.page) > 0);
    const walk = await weakFocus(ui.page, { max: 3 });
    assert.equal(walk.checked, 3);
    assert.deepEqual(walk.weak.map((w) => w.split(' shows')[0]), ['button "Hidden ring"'], 'only the button with its ring removed fails; the select and the plain button show the App ring');
  } finally {
    await ui.close();
  }
});
