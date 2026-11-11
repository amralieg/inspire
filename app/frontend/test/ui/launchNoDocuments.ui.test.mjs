import test from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_CLOCK, closeBrowser, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

function launchBackend() {
  const calls = { runs: [] };
  const mount = (app) => {
    app.post('/api/output-folder/check', (_req, res) => res.json({ allowed: true, folder: '/Users/someone@example.com/inspire_out', checked: 'passed' }));
    app.post('/api/run', (req, res) => {
      calls.runs.push(req.body);
      res.json({ run_id: 901 });
    });
  };
  return { calls, mount };
}

const launchButton = (page) => page.getByRole('button', { name: 'Get Started' });
const pdfOption = (page) => page.getByRole('button', { name: /^PDF Catalog/ });

async function readyToLaunch(page) {
  await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme Retail');
  await page.locator('button[title="main"]').first().click();
  const advanced = page.getByRole('button', { name: /Advanced Settings/ });
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
  await until(async () => !(await launchButton(page).isDisabled()), 'Get Started on');
}

test('the Launch page starts with no documents and sends no document formats, and picking PDF sends PDF (REQ-077)', async () => {
  const { calls, mount } = launchBackend();
  const ui = await openUi('launch', {}, '', { mount, ...FAKE_CLOCK });
  const { page } = ui;
  try {
    await readyToLaunch(page);
    await page.locator('[data-no-documents]').waitFor();
    await launchButton(page).click();
    await until(() => calls.runs.length === 1, 'the launch with no documents');
    assert.equal(calls.runs[0].params['09_generation_options'], '', 'the default launch builds no document');
    assert.equal(ui.pageErrors.length, 0);
  } finally {
    await ui.close();
  }
});

test('picking PDF in the Launch page sends PDF and hides the no-documents note (REQ-077 must-exclude)', async () => {
  const { calls, mount } = launchBackend();
  const ui = await openUi('launch', {}, '', { mount, ...FAKE_CLOCK });
  const { page } = ui;
  try {
    await readyToLaunch(page);
    await pdfOption(page).click();
    await page.locator('[data-no-documents]').waitFor({ state: 'detached' });
    await launchButton(page).click();
    await until(() => calls.runs.length === 1, 'the launch with PDF');
    assert.equal(calls.runs[0].params['09_generation_options'], 'PDF Catalog');
  } finally {
    await ui.close();
  }
});
