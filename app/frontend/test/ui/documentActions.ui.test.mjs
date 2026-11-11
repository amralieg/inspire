import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE, REVIEW_SESSIONS } from './reviewFixtures.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED } : s));

test('the three document buttons are live on a finished run, even when its artifacts folder was never opened (REQ-077, REQ-097)', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS });
  const { page } = ui;
  try {
    await page.locator('[data-document-actions]').waitFor();
    assert.equal((await page.locator('[data-doc-action="strategy-document"]').innerText()).trim(), 'Create strategy document');
    assert.equal((await page.locator('[data-doc-action="use-case-catalog"]').innerText()).trim(), 'Create use case catalog');
    assert.equal((await page.locator('[data-doc-action="excel-workbook"]').innerText()).trim(), 'Create Excel workbook');
    for (const kind of ['strategy-document', 'use-case-catalog', 'excel-workbook']) {
      assert.equal(await page.locator(`[data-doc-action="${kind}"]`).isDisabled(), false, `${kind} is live without any folder opened`);
    }
    assert.equal(await page.getByText(/Open the artifacts folder/).count(), 0, 'the person is never asked to open a folder first');
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
    assert.equal(backend.calls.body.generation_path, GENERATED, 'the job gets the session folder as stored, not a folder with the business name added');
    assert.equal(backend.calls.body.catalog_json_path, undefined, 'the job finds the catalog itself');
    assert.equal(await page.getByText('Acme-dbx_inspire.pptx').count(), 0, 'no file is listed before the job is done');
    for (let i = 0; i < 40 && backend.calls.polls < 1; i += 1) await page.waitForTimeout(1000);
    assert.ok(backend.calls.polls >= 1, 'the job status was read while it ran');
    assert.equal(await page.locator('[data-doc-status="running"]').count(), 1, 'still shown as running after that read');
    backend.calls.finished = true;
    await page.locator('[data-doc-status="done"]').waitFor({ timeout: 60000 });
    await page.getByText('Acme-dbx_inspire.pptx').first().waitFor({ timeout: 20000 });
    assert.ok(backend.calls.polls >= 2, 'the ended status was read after the running one');
    assert.equal(await page.locator('[data-doc-action="strategy-document"]').isDisabled(), false, 'after one Create the buttons stay live');
    assert.equal(await page.locator('[data-doc-action="use-case-catalog"]').isDisabled(), false, 'after one Create the catalog button stays live');
    assert.equal(await page.locator('[data-doc-action="excel-workbook"]').isDisabled(), false, 'after one Create the Excel button stays live');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const MISSING = "This run's catalog file is missing, so documents can't be made from it. Run Discover again to make them.";

test('a finished run whose catalog file is missing says so in plain words, with no path or stack (REQ-077)', async () => {
  const mount = (app) => {
    app.post('/api/documents', (_req, res) => res.status(409).json({ error: MISSING }));
  };
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    await page.locator('[data-doc-action="use-case-catalog"]').waitFor();
    await page.locator('[data-doc-action="use-case-catalog"]').click();
    await page.getByText(MISSING).first().waitFor({ timeout: 20000 });
    const panel = await page.locator('[data-document-actions]').innerText();
    assert.equal(/\/Workspace|Traceback|at .*\(/.test(panel), false, panel);
    assert.equal(await page.locator('[data-doc-action="use-case-catalog"]').isDisabled(), false, 'the buttons stay live to try again');
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of 409/.test(e)), [], 'the 409 is the intended answer; no other page error');
  } finally {
    await ui.close();
  }
});
