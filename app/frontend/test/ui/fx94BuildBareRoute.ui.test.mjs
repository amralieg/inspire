import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// FX-94 (D-uae-03, REQ-482): "#/build" with no run id showed only the header for 25 s. Business users close an App that looks dead,
// so the page always shows a spinner, an empty message with a way forward, or an error with Retry.
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const base = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
};

async function openBare(mount) {
  const ui = await openUi('app', {}, '', { mount: (app) => { base(app); mount(app); } });
  const { page } = ui;
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.body.innerText.includes('Connecting to workspace'), null, { timeout: 20000 });
  await page.evaluate(() => { window.location.hash = '#/build'; });
  return ui;
}

test('#/build with a slow reply shows "Loading your builds" within 1 s', async () => {
  const ui = await openBare((app) => app.get('/api/inspire/sessions', (_req, res) => setTimeout(() => res.json({ sessions: [] }), 4000)));
  try {
    await ui.page.getByText('Loading your builds', { exact: false }).first().waitFor({ timeout: 1000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('#/build with nothing built shows a plain message and a button to Review', async () => {
  const ui = await openBare((app) => app.get('/api/inspire/sessions', (_req, res) => res.json({ sessions: [] })));
  try {
    await ui.page.getByText('No builds yet. Pick a use case on Review to build one.', { exact: false }).waitFor({ timeout: 10000 });
    await ui.page.getByRole('button', { name: /Go to Review/ }).waitFor({ timeout: 5000 });
    assert.equal(await ui.page.getByText('Loading your builds', { exact: false }).count(), 0, 'the spinner is gone');
  } finally {
    await ui.close();
  }
});

test('#/build with a failed read shows a plain error and Retry, and Retry reads again', async () => {
  let calls = 0;
  const ui = await openBare((app) => app.get('/api/inspire/sessions', (_req, res) => {
    calls += 1;
    if (calls === 1) return res.status(500).json({ error: 'The workspace did not answer.' });
    return res.json({ sessions: [] });
  }));
  try {
    const retry = ui.page.getByRole('button', { name: /Retry/ }).first();
    await retry.waitFor({ timeout: 10000 });
    await retry.click();
    await ui.page.getByText('No builds yet', { exact: false }).waitFor({ timeout: 10000 });
  } finally {
    await ui.close();
  }
});
