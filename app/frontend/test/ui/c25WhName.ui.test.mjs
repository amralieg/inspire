// RC7-C-04: Build step 3 (Where it lives) showed "SQL warehouse for the App: Warehouse: 7c313dcbcd3119c1". Fail-first contract: wherever the wizard labels
// the App's SQL warehouse, the person sees its name (the warehouses API answers id plus name); only an unknown name falls back to "SQL warehouse <id>".
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, toSharedAccess } from './uiSupport.mjs';
import { APP_STORAGE_LABEL } from '../../src/lib/implementWizard.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const RAW_ID = 'wh1';

async function toStorage(page) {
  await goToStep(page, 'Data');
  await goToStep(page, 'What to build');
  await toSharedAccess(page);
  await goToStep(page, 'Where it lives');
}

// A loaded Mac can trip the boot guard's reload and drop the wizard back to step 1; the person starts over, so the test opens the wizard again (3 tries).
async function reachStorage(warehouses) {
  for (let attempt = 1; ; attempt += 1) {
    const ui = await openUi('wizard', { ...ME, warehouses: { warehouses } });
    try {
      await toStorage(ui.page);
      await ui.page.getByText('Step 5 of 6', { exact: true }).waitFor({ timeout: 20000 });
      await ui.page.getByText(APP_STORAGE_LABEL).first().waitFor({ timeout: 20000 });
      return ui;
    } catch (e) {
      await ui.close();
      if (attempt >= 3) throw e;
    }
  }
}

// The line of step 3 that carries the App SQL warehouse, read once the warehouse list has had time to load.
async function warehouseLine(page, until) {
  let text = '';
  for (let i = 0; i < 40; i += 1) {
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const at = body.indexOf(APP_STORAGE_LABEL);
    if (at >= 0) text = body.slice(at, at + 120);
    if (until(text)) break;
    await page.waitForTimeout(250);
  }
  return text;
}

test('step 3 names the App SQL warehouse instead of showing its id', async () => {
  const ui = await reachStorage([{ id: RAW_ID, name: 'Reporting SQL', state: 'RUNNING' }]);
  try {
    const text = await warehouseLine(ui.page, (t) => t.includes('Reporting SQL'));
    assert.ok(text.includes('Reporting SQL'), `step 3 shows the warehouse name, got: ${text}`);
    assert.ok(!text.includes(`Warehouse: ${RAW_ID}`), 'no "Warehouse: <id>" label');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('an unknown warehouse name falls back to "SQL warehouse" plus the id', async () => {
  const ui = await reachStorage([{ id: 'other9', name: 'Other SQL', state: 'RUNNING' }]);
  try {
    const text = await warehouseLine(ui.page, (t) => t.includes(`SQL warehouse ${RAW_ID}`));
    assert.ok(text.includes(`SQL warehouse ${RAW_ID}`), `the fallback is "SQL warehouse <id>", got: ${text}`);
    assert.ok(!text.includes(`Warehouse: ${RAW_ID}`), 'no bare "Warehouse: <id>" label');
  } finally { await ui.close(); }
});
