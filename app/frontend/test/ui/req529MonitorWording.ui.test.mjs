import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-529 (RC6-A-01..03): older runs stored the retired name in step text. Monitor shows "Databricks AI"; the stored rows keep their ids.
const MINUTE = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const row = (id, status, at) => ({
  step_id: String(id), session_id: '42', stage_name: 'Genie Code', step_name: 'Genie Code', sub_step_name: 'Genie Code model', status,
  message: 'Genie Code could not be installed', progress_increment: 0, last_updated: at, result_json: {},
});

async function openOldRun() {
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: ago(30 * MINUTE),
      processing_status: 'ready', completed_percent: 40, completed_on: null, last_updated: ago(MINUTE) } }));
    app.get('/api/inspire/steps', (req, res) => res.json({ steps: req.query.since ? [] : [row(1, 'started', ago(2 * MINUTE))] }));
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
  };
  return openUi('monitor', {}, '&run=none', { mount });
}

test('Monitor of an old run never shows the retired name in the feed, the latest step or Every step', async () => {
  const ui = await openOldRun();
  const { page } = ui;
  try {
    await page.getByRole('button', { name: /Every step/ }).waitFor({ timeout: 15000 });
    assert.doesNotMatch(await page.locator('body').innerText(), /genie[\s-]code/i, 'feed and latest step');
    await page.getByRole('button', { name: /Every step/ }).click();
    const rowButton = page.getByText('Databricks AI', { exact: false }).last();
    await rowButton.click();
    const text = await page.locator('body').innerText();
    assert.doesNotMatch(text, /genie[\s-]code/i, 'dialog expanded');
    assert.match(text, /Databricks AI/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('searching Monitor for "Databricks AI" still lists the step stored under the old name, and the stored name still matches', async () => {
  const ui = await openOldRun();
  const { page } = ui;
  try {
    await page.getByRole('button', { name: /Every step/ }).click();
    const search = page.getByLabel('Search steps');
    await search.fill('Databricks AI');
    await page.getByText('Databricks AI', { exact: false }).last().waitFor({ timeout: 10000 });
    assert.doesNotMatch(await page.locator('body').innerText(), /No steps match|no matching/i);
    assert.ok(await page.getByText('Genie Code', { exact: false }).count() === 0);
    await search.fill('Genie Code');
    assert.ok(await page.getByText('Databricks AI', { exact: false }).count() > 0, 'typing the stored name still finds the step');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
