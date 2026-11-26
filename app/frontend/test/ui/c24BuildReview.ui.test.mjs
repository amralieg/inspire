// c24_rc7bld (RC7-C-01, C-02, C-03): Build review wording. Fail-first contract:
// (1) the Review "App storage" line never carries a principal id, a catalog name or installer advice;
// (2) the Build flow says "App", never "Agentic App", in labels, wizard strings and the JSX;
// (3) the Review summary table has no scroll of its own (the dialog body is the one scroll).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { closeBrowser, goToStep, openSettings, openUi } from './uiSupport.mjs';
import { STUDIO_STATE } from './implementFixtures.js';

test.after(closeBrowser);
const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..', '..', '..');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test('RC7-C-01: the App storage line is one plain line: no UUID, no catalog name, no installer advice', async () => {
  const w = await import(pathToFileURL(path.join(app, 'frontend', 'src', 'lib', 'implementWizard.js')).href);
  const who = '3f2c1a9e-7b4d-4e21-9c55-0a1b2c3d4e5f';
  const offers = [
    { state: 'no_catalog', detail: `the catalog inspire_lakebase does not exist and ${who} has no CREATE CATALOG on the metastore; run the Inspire installer again as someone with CREATE CATALOG on the metastore` },
    { state: 'no_catalog', detail: `${who} has no USE CATALOG on the catalog inspire_lakebase; run the Inspire installer again as an owner of it` },
    { state: 'unknown', detail: `the catalog inspire_lakebase does not exist and Inspire could not tell whether ${who} has CREATE CATALOG` },
    { state: 'absent', detail: 'x' },
    { state: 'denied', detail: `${who} cannot create` },
  ];
  for (const offer of offers) {
    const text = w.appStorageText({ outputs: { app: true } }, offer);
    assert.doesNotMatch(text, UUID, text);
    assert.doesNotMatch(text, /installer/i, text);
    assert.doesNotMatch(text, /inspire_lakebase|CREATE CATALOG/, text);
    assert.ok(text.startsWith('Delta'), text);
  }
  assert.equal(w.appStorageText({ outputs: { app: true } }, { state: 'no_catalog', detail: 'd' }), 'Delta tables (Lakebase is not set up in this workspace)');
});

test('RC7-C-01: the backend offer detail never carries a raw principal id', async () => {
  const { createRequire } = await import('node:module');
  const C = createRequire(import.meta.url)(path.join(app, 'backend', 'lib', 'implementControl.js'));
  const who = '3f2c1a9e-7b4d-4e21-9c55-0a1b2c3d4e5f';
  const offer = C.lakebaseOffer({ ok: true }, ['lakebase'], { name: 'inspire_lakebase', who, exists: false, canCreate: false });
  assert.doesNotMatch(offer.detail, UUID, offer.detail);
});

test('RC7-C-02: no "Agentic App" in the Build flow text', () => {
  const files = ['backend/lib/implementOutputLabels.json', 'frontend/src/lib/implementWizard.js', 'frontend/src/pages/ImplementWizard.jsx',
    'agent/agent/app_shell/server/shell_alerts.py', 'agent/agent/app_shell/server/shell_sql.py'];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(app, f), 'utf8'), /Agentic App/, f);
  const nb = fs.readFileSync(path.join(app, 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb'), 'utf8');
  assert.doesNotMatch(nb, /Agentic App/, 'agent notebook');
});

test('RC7-C-03: the Review summary table has no scroll of its own', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page } = ui;
  try {
    await page.locator('[data-asset-tiles]').waitFor({ timeout: 20000 });
    const wizard = await openSettings(page);
    await goToStep(page, 'Review & build');
    await page.setViewportSize({ width: 1024, height: 600 });
    const box = await wizard.locator('[data-picked-summary]').evaluate((el) => ({ overflow: getComputedStyle(el).overflowY, scroll: el.scrollHeight, client: el.clientHeight }));
    assert.notEqual(box.overflow, 'auto');
    assert.notEqual(box.overflow, 'scroll');
    assert.ok(box.scroll <= box.client + 1, `the table grows to its content (scroll ${box.scroll}, client ${box.client})`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
