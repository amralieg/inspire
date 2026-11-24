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
const DOC_OPTIONS = [/^PDF Catalog/, /^Presentation/, /^Excel/];

async function readyToLaunch(page) {
  await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme Retail');
  await page.locator('button[title="main"]').first().click();
  const advanced = page.getByRole('button', { name: /Advanced Settings/ });
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
  await until(async () => !(await launchButton(page).isDisabled()), 'Get Started on');
}

test('the Launch page offers no document options and the default launch carries no 09 key (REQ-077 removed, REQ-503 FX-116)', async () => {
  const { calls, mount } = launchBackend();
  const ui = await openUi('launch', {}, '', { mount, ...FAKE_CLOCK });
  const { page } = ui;
  try {
    await readyToLaunch(page);
    for (const name of DOC_OPTIONS) assert.equal(await page.getByRole('button', { name }).count(), 0, `${name} is still offered`);
    assert.equal(await page.locator('[data-no-documents]').count(), 0, 'no no-documents note: there is nothing to untick');
    await launchButton(page).click();
    await page.locator('[data-launch-run-unsaved]').click();
    await until(() => calls.runs.length === 1, 'the default launch');
    assert.equal(Object.hasOwn(calls.runs[0].params, '09_generation_options'), false, 'the launch sends no generation option');
    assert.equal(calls.runs[0].params['00_business_name'], 'Acme Retail', 'the rest of the launch is unchanged');
    assert.equal(ui.pageErrors.length, 0);
  } finally {
    await ui.close();
  }
});

test('the Launch page has no Document Languages field and the launch sends no document-format setting; the Generate docs wizard owns documents (REQ-503 FX-116)', async () => {
  const { calls, mount } = launchBackend();
  const ui = await openUi('launch', {}, '', { mount, ...FAKE_CLOCK });
  const { page } = ui;
  try {
    await readyToLaunch(page);
    assert.equal(/Document Languages|Generation Options/i.test(await page.locator('body').innerText()), false, 'a document setting is still on the page');
    await launchButton(page).click();
    await page.locator('[data-launch-run-unsaved]').click();
    await until(() => calls.runs.length === 1, 'the launch');
    assert.equal(Object.hasOwn(calls.runs[0].params, '09_generation_options'), false);
  } finally {
    await ui.close();
  }
});
