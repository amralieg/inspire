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

test('the Launch page starts with the strategy PDF ticked, so the default launch builds it (REQ-077, REQ-121)', async () => {
  const { calls, mount } = launchBackend();
  const ui = await openUi('launch', {}, '', { mount, ...FAKE_CLOCK });
  const { page } = ui;
  try {
    await readyToLaunch(page);
    assert.equal(await page.locator('[data-no-documents]').count(), 0, 'no no-documents note while the PDF is ticked');
    await launchButton(page).click();
    await until(() => calls.runs.length === 1, 'the default launch');
    assert.equal(calls.runs[0].params['09_generation_options'], 'PDF Catalog', 'the default launch builds the strategy PDF');
    assert.equal(ui.pageErrors.length, 0);
  } finally {
    await ui.close();
  }
});

test('unticking the PDF in the Launch page shows the no-documents note and sends no document formats (REQ-077 must-exclude, REQ-121)', async () => {
  const { calls, mount } = launchBackend();
  const ui = await openUi('launch', {}, '', { mount, ...FAKE_CLOCK });
  const { page } = ui;
  try {
    await readyToLaunch(page);
    await pdfOption(page).click();
    await page.locator('[data-no-documents]').waitFor();
    await launchButton(page).click();
    await until(() => calls.runs.length === 1, 'the launch with no documents');
    assert.equal(calls.runs[0].params['09_generation_options'], '', 'the person unticked every document');
  } finally {
    await ui.close();
  }
});
