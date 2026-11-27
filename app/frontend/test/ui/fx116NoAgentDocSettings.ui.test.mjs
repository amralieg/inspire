// FX-116 (REQ-503): the documents are made in the App by the Generate docs wizard, so the run's document settings go (DRY): Advanced
// Settings has no Generation Options (PDF Catalog, Presentation, Excel), a launch sends no `09_generation_options`, Assets has no
// "rebuild the documents" actions, and their components are gone. Old run files (a Discover PDF or workbook) still list in Assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_CLOCK, closeBrowser, openUi, toDocuments, until } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function launchBackend() {
  const calls = { runs: [] };
  const mount = (app) => {
    app.post('/api/output-folder/check', (_req, res) => res.json({ allowed: true, folder: '/Users/someone@example.com/inspire_out', checked: 'passed' }));
    app.post('/api/run', (req, res) => { calls.runs.push(req.body); res.json({ run_id: 901 }); });
  };
  return { calls, mount };
}
const launchButton = (page) => page.getByRole('button', { name: 'Get Started' });
async function launchOnce(ui, calls) {
  const { page } = ui;
  await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme Retail');
  await page.locator('button[title="main"]').first().click();
  const advanced = page.getByRole('button', { name: /Advanced Settings/ });
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
  await until(async () => !(await launchButton(page).isDisabled()), 'Get Started on');
  const settings = await page.locator('body').innerText();
  await launchButton(page).click();
  await page.locator('[data-launch-run-unsaved]').click();
  await until(() => calls.runs.length === 1, 'the launch');
  return { settings, params: calls.runs[0].params };
}

test('Advanced Settings has no Generation Options and a launch sends no 09_generation_options', async () => {
  const { calls, mount } = launchBackend();
  const ui = await openUi('launch', {}, '', { mount, ...FAKE_CLOCK });
  try {
    const { settings, params } = await launchOnce(ui, calls);
    assert.equal(/Generation Options/i.test(settings), false, 'the Generation Options field is still in Advanced Settings');
    for (const name of [/^PDF Catalog/, /^Presentation/, /^Excel/]) assert.equal(await ui.page.getByRole('button', { name }).count(), 0, `a ${name} option is still offered`);
    assert.equal(await ui.page.locator('[data-no-documents]').count(), 0);
    assert.equal(Object.hasOwn(params, '09_generation_options'), false, `the launch still sends 09_generation_options: ${params['09_generation_options']}`);
    assert.equal(params['00_business_name'], 'Acme Retail', 'the rest of the launch is unchanged');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('decision (a): Advanced Settings has no Document Languages field and a launch leaves 12_documents_languages to the notebook default', async () => {
  const { calls, mount } = launchBackend();
  const ui = await openUi('launch', {}, '', { mount, ...FAKE_CLOCK });
  try {
    const { settings, params } = await launchOnce(ui, calls);
    assert.equal(/Document(s)? Languages/i.test(settings), false, 'the Document Languages field is still in Advanced Settings');
    assert.equal(await ui.page.locator('[data-doc-language-default]').count(), 0);
    assert.equal(Object.hasOwn(params, '12_documents_languages'), false, `the launch still sends 12_documents_languages: ${params['12_documents_languages']}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Overview has no rebuild-documents actions, and an old run PDF and workbook still list with a Download button', async () => {
  const GEN = '/Workspace/Users/me@example.com/inspire_out';
  const files = ['Acme-dbx_inspire.pdf', 'Acme-dbx_inspire.xlsx'].map((name) => ({ name, path: `${GEN}/acme/${name}`, is_directory: false, file_size: 5000 }));
  const sessions = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GEN } : s));
  const ui = await openUi('results', { ...REVIEW_STATE, sessions, results: REVIEW_RESULTS }, '', {
    mount: (app) => { app.post('/api/inspire/docs/save', (req, res) => res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 })); app.get('/api/workspace/list', (_req, res) => res.json({ files })); },
  });
  const { page } = ui;
  try {
    await toDocuments(page);
    await page.getByText(files[0].name).first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-document-actions], [data-doc-action]').count(), 0, 'the rebuild-documents actions are still in Overview');
    for (const f of files) assert.ok((await page.getByRole('button', { name: `Download ${f.name}`, exact: true }).count()) >= 1, `${f.name} can still be downloaded`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the document-settings components are gone and nothing imports them; the wizard keeps the language list', () => {
  for (const f of ['components/DocumentActions.jsx', 'lib/documentActions.js', 'components/DocumentLanguagesMultiselect.jsx']) {
    assert.equal(fs.existsSync(path.join(SRC, f)), false, `src/${f} still exists`);
  }
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const importers = walk(SRC).filter((f) => /\.(jsx?|mjs)$/.test(f))
    .filter((f) => /from\s+['"][^'"]*\/(DocumentActions|documentActions|DocumentLanguagesMultiselect)(\.jsx?)?['"]/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(importers.map((f) => path.relative(SRC, f)), []);
  assert.equal(fs.existsSync(path.join(SRC, 'constants', 'documentLanguages.js')), true, 'the wizard picks its languages from constants/documentLanguages.js');
});
