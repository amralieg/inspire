import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE, REVIEW_SESSIONS } from './reviewFixtures.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED } : s));

test('the Review shows the two document buttons, and both wait for the catalog to be listed (REQ-077)', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS });
  const { page } = ui;
  try {
    await page.locator('[data-document-actions]').waitFor();
    assert.equal((await page.locator('[data-doc-action="strategy-document"]').innerText()).trim(), 'Create strategy document');
    assert.equal((await page.locator('[data-doc-action="use-case-catalog"]').innerText()).trim(), 'Create use case catalog');
    assert.equal(await page.locator('[data-doc-action="strategy-document"]').isDisabled(), true, 'no catalog listed, so no job');
    assert.match(await page.locator('[data-document-actions]').innerText(), /Open the artifacts folder/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const BIG = [{ ...SESSIONS[0], output_language: 'English,Arabic' }, ...SESSIONS.slice(1)];

function documentBackend() {
  const calls = { body: null, polls: 0, finished: false, built: false };
  const base = `${GENERATED}/Acme-dbx_inspire.json`;
  const mount = (app) => {
    app.post('/api/documents', (req, res) => { calls.body = req.body; calls.built = true; res.json({ run_id: 901, document: {} }); });
    app.get('/api/run/901', (_req, res) => {
      calls.polls += 1;
      res.json({ run_id: 901, ...(calls.finished ? { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' } : { life_cycle_state: 'RUNNING', result_state: null }) });
    });
    app.get('/api/workspace/list', (_req, res) => {
      const files = [{ name: 'Acme-dbx_inspire.json', path: base, is_directory: false }];
      if (calls.finished) files.push({ name: 'Acme-dbx_inspire.pptx', path: `${GENERATED}/Acme-dbx_inspire.pptx`, is_directory: false });
      res.json({ files });
    });
  };
  return { calls, mount };
}

test('a strategy document shows its progress while the job runs, then the refreshed file list when it is ready (REQ-077)', async () => {
  const backend = documentBackend();
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: BIG, results: REVIEW_RESULTS }, '', { mount: backend.mount });
  const { page } = ui;
  try {
    await page.locator('[data-document-actions]').waitFor();
    await page.waitForResponse((r) => r.url().includes('/api/workspace/list'), { timeout: 20000 }).catch(() => null);
    await page.locator('[data-doc-action="strategy-document"]').waitFor();
    assert.equal(await page.locator('[data-doc-action="strategy-document"]').isDisabled(), false, 'the catalog is listed, so the button is live');
    await page.selectOption('select[aria-label="Strategy document format"]', 'PPTX');
    await page.locator('[data-doc-action="strategy-document"]').click();
    await page.locator('[data-doc-status="running"]').waitFor({ timeout: 20000 });
    assert.match(await page.locator('[data-doc-status="running"]').innerText(), /run 901/);
    assert.equal(await page.locator('[data-doc-action="strategy-document"]').isDisabled(), true, 'a running job holds both buttons');
    assert.equal(backend.calls.body.format, 'PPTX');
    assert.equal(backend.calls.body.output_language, 'English,Arabic', 'every language the session was created with is rebuilt');
    assert.equal(backend.calls.body.catalog_json_path, `${GENERATED}/Acme-dbx_inspire.json`);
    assert.equal(await page.getByText('Acme-dbx_inspire.pptx').count(), 0, 'no file is listed before the job is done');
    for (let i = 0; i < 40 && backend.calls.polls < 1; i += 1) await page.waitForTimeout(1000);
    assert.ok(backend.calls.polls >= 1, 'the job status was read while it ran');
    assert.equal(await page.locator('[data-doc-status="running"]').count(), 1, 'still shown as running after that read');
    backend.calls.finished = true;
    await page.locator('[data-doc-status="done"]').waitFor({ timeout: 60000 });
    await page.getByText('Acme-dbx_inspire.pptx').first().waitFor({ timeout: 20000 });
    assert.ok(backend.calls.polls >= 2, 'the ended status was read after the running one');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
