// REQ-508 L6b (Art Director pass, "A Calm Console"): the start pages (Choose, Launch, Config, Generate data, Setup) share the L6a page
// header; Landing keeps its display headline (40/48) as the one decorative page; the Setup wizard counts only the steps that will run.
// Audit scratch/req508_art_director.md F10, F19-F21. Fail-pre (15eb146b9): h1 sizes run text-2xl to 6xl (ChoosePage:319,357,
// LaunchPage:1153, ConfigPage:134, GenerateDataPage:101, SetupWizard:280, LandingPage:651) and Setup always says "Step N of 5",
// counting Authenticate even inside a Databricks App where the token is supplied (SetupWizard.jsx:12-17, 308).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { assertHeader, headerFacts } from './req508Headers.mjs';

test.after(closeBrowser);

// REQ-520 (owner decision "Caps everywhere", approved test change 2026-11-25): each page's content column has the REQ-520 cap; Config keeps no cap.
const PAGES = [
  ['Choose', 'choose', { icon: true, width: '1440px' }],
  ['Launch', 'launch', { icon: true, width: '1088px' }],
  ['Config', 'config', { icon: true }],
  ['Generate data', 'generate', { icon: true, width: '1088px' }],
];

for (const [name, open, opts] of PAGES) {
  test(`${name}: one page header (text-h1, no gradient, the shared icon tile) and the full page width (REQ-512)`, async () => {
    const ui = await openUi(open);
    const { page } = ui;
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      assertHeader(assert, await headerFacts(page), { name, width: null, ...opts });
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

const inApp = (app) => {
  app.get('/api/defaults', (_req, res) => res.json({ envSkipsSetupWizard: false, databricksHost: 'https://workspace.example.com' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', isDatabricksApp: true }));
};

test('Setup: the header at full width (REQ-512), and inside a Databricks App the wizard counts 4 steps with no Authenticate step', async () => {
  const ui = await openUi('setup', {}, '', { mount: inApp });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    assertHeader(assert, await headerFacts(page), { name: 'Setup', width: '1040px', icon: false });
    await page.getByText(/^Step 1 of \d$/).waitFor({ timeout: 15000 });
    assert.equal(await page.getByText(/^Step 1 of \d$/).innerText(), 'Step 1 of 4', 'the token comes from the App, so Authenticate is not a step');
    assert.equal(await page.getByRole('button', { name: /Authenticate/ }).count(), 0, 'no Authenticate step in the indicator');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Setup outside a Databricks App still counts all 5 steps, Authenticate included (must-keep)', async () => {
  const ui = await openUi('setup', {}, '', { mount: (app) => {
    app.get('/api/defaults', (_req, res) => res.json({ envSkipsSetupWizard: false }));
    app.get('/api/health', (_req, res) => res.json({ status: 'ok', isDatabricksApp: false }));
  } });
  const { page } = ui;
  try {
    await page.getByText(/^Step 1 of \d$/).waitFor({ timeout: 15000 });
    assert.equal(await page.getByText(/^Step 1 of \d$/).innerText(), 'Step 1 of 5');
  } finally {
    await ui.close();
  }
});

test('Landing keeps its display headline: 40/48, weight 600, and it is the one page allowed decoration', async () => {
  const ui = await openUi('landing');
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const facts = await headerFacts(page);
    assert.ok(facts.h1, 'Landing renders its h1');
    assert.deepEqual([facts.h1.size, facts.h1.lineHeight, facts.h1.weight], [40, 48, 600], 'the Landing h1 uses text-display');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
