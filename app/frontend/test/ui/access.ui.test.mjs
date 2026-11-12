import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, idle, onStep, openUi, profileAt } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { GROUPING_INSTRUCTION, GROUPING_PROFILE, HARNESS_SESSION_ID, HARNESS_SETTINGS, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { activeRing, sideScroll, unnamedControls, weakFocus } from '../../../agent/agent/app_shell/web/test/access.mjs';

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

const SCREEN = { width: 1280, height: 800 };
const sized = (size, theme) => async (page) => {
  await page.setViewportSize(size);
  if (theme === 'dark') {
    await page.addInitScript(() => {
      localStorage.setItem('inspire_theme', 'dark');
      document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('dark'));
    });
  }
};

async function openAt(hash, size, theme = 'light') {
  const ui = await openUi('app', KNOWN, hash, { mount, init: sized(size, theme) });
  await PAGES[hash](ui.page);
  await idle(ui.page);
  return ui;
}

async function focusTopOfPage(page) {
  await page.evaluate(() => document.querySelector('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus());
  await page.keyboard.press('Shift+Tab');
}

async function assertReachable(ui, where, theme, min = 5) {
  assert.equal(await ui.page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark', `${where} draws the ${theme} theme`);
  assert.deepEqual(await unnamedControls(ui.page), [], `${where}: controls a screen reader reads with no name`);
  await focusTopOfPage(ui.page);
  const walk = await weakFocus(ui.page, { max: 45 });
  assert.ok(walk.checked >= min, `${where}: the keyboard reached ${walk.checked} controls`);
  assert.deepEqual(walk.weak, [], `${where}: controls with no visible focus`);
  assert.deepEqual(ui.pageErrors, []);
}

for (const hash of Object.keys(PAGES)) {
  for (const theme of ['light', 'dark']) {
    test(`${hash} at 1280x800 in the ${theme} theme names every control for a screen reader and shows a ring of at least 3:1 contrast on every control the keyboard reaches`, async () => {
      const ui = await openAt(hash, SCREEN, theme);
      try {
        await assertReachable(ui, hash, theme);
      } finally {
        await ui.close();
      }
    });
  }

  test(`${hash} at 200% zoom of a 1280x800 screen never scrolls sideways`, async () => {
    const ui = await openAt(hash, { width: 640, height: 400 });
    try {
      assert.ok(await sideScroll(ui.page) <= 0, `${hash} scrolls sideways by ${await sideScroll(ui.page)} px`);
    } finally {
      await ui.close();
    }
  });
}

const DIAGNOSED = {
  me: { userName: OWNER, displayName: 'Owner' },
  history: [{
    session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'failed', change_classes: 'initial', created_by: OWNER,
    spec_json: JSON.stringify(defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER })),
    status_message: 'Preview run failed: a column cannot be resolved', job_id: '77', implement_run_id: '5555', last_preview_run_id: '9001',
    created_at: '2026-11-08T10:00:00.000Z', updated_at: '2026-11-08T10:12:00.000Z',
  }],
  steps: [{ step_id: 'p', stage_name: 'Implement Use Cases', step_name: 'Inspire is working on preview run', sub_step_name: 'Completed: n01-u01', status: 'ended_error',
    message: 'a column cannot be resolved', last_updated: '2026-11-08T10:12:00.000Z', result_json: JSON.stringify({ use_case_id: 'N01-U01', phase: 'Preview run', spec_version: 1 }) }],
};
const setupMount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json({ envSkipsSetupWizard: false }));
  app.get('/api/health', (_req, res) => res.json({ isDatabricksApp: false }));
  app.get('/api/showcase', (_req, res) => res.json({}));
};
const HARNESS = {
  Setup: { open: 'setup', state: {}, opts: { mount: setupMount }, ready: (page) => page.locator('input, button').first().waitFor({ timeout: 20000 }) },
  'Generate data': { open: 'generate', state: {}, ready: (page) => page.locator('button[type="submit"]').waitFor({ timeout: 20000 }) },
  'Start a run': { open: 'launch', state: { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } }, ready: (page) => page.locator('[data-discovery-panel]').waitFor({ timeout: 20000 }) },
  'Build progress with diagnostics': { open: 'implement', state: DIAGNOSED, ready: (page) => page.locator('[data-progress-card] [data-diagnostics-download]').waitFor({ timeout: 20000 }) },
};

async function openHarness(name, theme, size = SCREEN) {
  const { open, state, opts = {}, ready } = HARNESS[name];
  const ui = await openUi(open, state, '', { ...opts, init: sized(size, theme) });
  await ready(ui.page);
  await idle(ui.page);
  return ui;
}

for (const name of Object.keys(HARNESS)) {
  for (const theme of ['light', 'dark']) {
    test(`${name} at 1280x800 in the ${theme} theme names every control and rings every control the keyboard reaches at 3:1 or more`, async () => {
      const ui = await openHarness(name, theme);
      try {
        await assertReachable(ui, name, theme, 3);
      } finally {
        await ui.close();
      }
    });
  }

  test(`${name} at 200% zoom of a 1280x800 screen never scrolls sideways, left to right and right to left`, async () => {
    const ui = await openHarness(name, 'light', { width: 640, height: 400 });
    try {
      assert.ok(await sideScroll(ui.page) <= 0, `${name} scrolls sideways by ${await sideScroll(ui.page)} px`);
      await ui.page.evaluate(() => { document.documentElement.dir = 'rtl'; });
      await idle(ui.page);
      assert.ok(await sideScroll(ui.page) <= 0, `${name} right to left scrolls sideways by ${await sideScroll(ui.page)} px`);
    } finally {
      await ui.close();
    }
  });
}

test('the diagnostics Download, Copy and Report issue controls each show the App ring at 3:1 or more in both themes', async () => {
  for (const theme of ['light', 'dark']) {
    const ui = await openHarness('Build progress with diagnostics', theme);
    try {
      for (const sel of ['[data-diagnostics-download]', '[data-diagnostics-copy]', '[data-diagnostics-report]']) {
        await ui.page.locator(`[data-progress-card] ${sel}`).focus();
        await ui.page.keyboard.press('Shift+Tab');
        await ui.page.keyboard.press('Tab');
        const ring = await activeRing(ui.page);
        assert.ok(ring.ok, `${theme} ${sel}: ${JSON.stringify(ring)}`);
      }
    } finally {
      await ui.close();
    }
  }
});

for (const theme of ['light', 'dark']) {
  test(`every wizard step at 1280x800 in the ${theme} theme names every control and rings every control the keyboard reaches at 3:1 or more`, async () => {
    const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION } }, '',
      { init: async (page) => { await sized(SCREEN, theme)(page); await profileAt([], GROUPING_PROFILE)(page); } });
    try {
      await goToStep(ui.page, 'Data');
      assert.equal(await ui.page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark');
      const labels = (await ui.page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\.\s*/, '').trim());
      const missed = [];
      let reached = 0;
      for (const label of labels) {
        await goToStep(ui.page, label);
        await idle(ui.page);
        const unnamed = await unnamedControls(ui.page);
        const walk = await weakFocus(ui.page, { max: 45 });
        reached += walk.checked;
        if (unnamed.length || walk.weak.length || !walk.checked) missed.push({ label, checked: walk.checked, unnamed, weak: walk.weak });
      }
      assert.ok(labels.length >= 7, labels.join(' | '));
      assert.ok(reached >= 25, `the keyboard reached ${reached} wizard controls`);
      assert.deepEqual(missed, [], `${theme}: wizard steps with unnamed controls or no visible focus`);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

test('under right to left the arrows and chevrons point the reading way, an open chevron still points down, and a pane resizer moves with the arrow key pressed (must-exclude: left to right stays as is)', async () => {
  const review = await openAt('#/review/42', { width: 1280, height: 800 });
  try {
    const { page } = review;
    const read = () => page.evaluate(() => [...document.querySelectorAll('.lucide-chevron-right, .lucide-arrow-right')].filter((el) => el.getClientRects().length)
      .map((el) => `${el.classList.contains('rotate-90') ? 'open' : 'shut'} ${getComputedStyle(el).scale} ${getComputedStyle(el).rotate}`));
    await page.getByRole('button', { name: /^Domains/ }).click();
    const ltr = await read();
    assert.ok(ltr.some((s) => s.startsWith('open')) && ltr.some((s) => s.startsWith('shut')), `Review draws open and shut chevrons: ${ltr}`);
    assert.ok(ltr.every((s) => s.includes(' none ')), `left to right nothing mirrors: ${ltr}`);
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; return Promise.all(document.getAnimations().map((a) => a.finished)); });
    const rtl = await read();
    assert.deepEqual(rtl.filter((s) => !/^shut -1 1 none$|^open -1 1 -90deg$/.test(s)), [], `right to left every arrow mirrors: ${rtl}`);
  } finally {
    await review.close();
  }
  const build = await openAt('#/build/42', { width: 1280, height: 800 });
  try {
    const { page } = build;
    const press = async (key) => {
      const bar = page.locator('[role="separator"][tabindex="0"]').first();
      const before = Number(await bar.getAttribute('aria-valuenow'));
      await bar.focus();
      await page.keyboard.press(key);
      return Number(await bar.getAttribute('aria-valuenow')) - before;
    };
    assert.ok(await press('ArrowRight') > 0, 'left to right, the right arrow widens the start pane');
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    assert.ok(await press('ArrowRight') < 0, 'right to left, the right arrow moves the divider right and narrows the start pane');
    assert.ok(await press('ArrowLeft') > 0, 'right to left, the left arrow widens it');
  } finally {
    await build.close();
  }
});

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
