// c33 lane A acceptance (REQ-578): the launch form loses the Operation selector and "Generate Use Cases"; every launch from it is
// Discover Use Cases, and a saved draft that still says Generate starts as Discover. LaunchPage keeps rendering the full form when no
// wizard step is given (the legacy launch tests stay valid). Written by the c33 planner; the lane A builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { START_DRAFT_STAMP, START_DRAFT_STEP, WIZARD_DRAFT_VERSION, startDraftKey } from '../../src/lib/wizardDraft.js';

test.after(closeBrowser);

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));

// A draft saved before REQ-578, when the form still offered Generate Use Cases.
const OLD_DRAFT = {
  version: WIZARD_DRAFT_VERSION, stamp: START_DRAFT_STAMP, step: START_DRAFT_STEP, visited: [],
  spec: { params: { '00_business_name': 'Example Co', '15_operation': 'Generate Use Cases' }, priorityChecks: {}, tableScopes: {}, selectedCatalogs: ['main'], wholeCatalogs: ['main'] },
};
const withOldDraft = {
  init: (page) => page.addInitScript(([key, value]) => window.localStorage.setItem(key, value),
    [startDraftKey({ host: 'https://workspace.example.com' }), JSON.stringify(OLD_DRAFT)]),
};

test('REQ-578: the launch form has no Operation selector and no Generate Use Cases anywhere (must-fail on the base)', async () => {
  const ui = await openUi('launch', {});
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 15000 });
    const toggle = page.getByRole('button', { name: /Advanced Settings/ });
    if (await toggle.count()) await toggle.click();
    assert.equal(await page.getByText('Operation', { exact: true }).count(), 0, 'no Operation label');
    assert.equal(await page.locator('select option', { hasText: 'Generate Use Cases' }).count(), 0, 'no Generate Use Cases option');
    assert.doesNotMatch(await page.locator('body').innerText(), /Generate Use Cases/);
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-578: a saved draft that says Generate Use Cases launches as Discover Use Cases (must-fail on the base)', async () => {
  const ui = await openUi('launch', {}, '', withOldDraft);
  const { page, made } = ui;
  try {
    const name = page.getByPlaceholder(BUSINESS);
    await name.waitFor({ timeout: 15000 });
    await until(async () => (await name.inputValue()) === 'Example Co', 'the old draft restored', 10000);
    const toggle = page.getByRole('button', { name: /Advanced Settings/ });
    if (await toggle.count()) await toggle.click();
    assert.equal(await page.getByText('Operation', { exact: true }).count(), 0, 'no Operation label');
    await until(async () => !(await page.getByRole('button', { name: 'Get Started' }).isDisabled()), 'Get Started is ready', 15000);
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.locator('[data-launch-run-unsaved]').click();
    await until(() => made.launches.length === 1, 'the run was sent once', 15000);
    assert.equal(made.launches[0].params['15_operation'], 'Discover Use Cases');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-578: LaunchPage drops the Operation options and takes a wizard step prop (must-fail on the base)', () => {
  const launch = fs.readFileSync(path.join(SRC, 'pages', 'LaunchPage.jsx'), 'utf8');
  assert.doesNotMatch(launch, /OPERATION_WIDGET_OPTIONS|Generate Use Cases/, 'no Generate option or list is left in LaunchPage');
  assert.match(launch, /export default function LaunchPage\(\{[^}]*\bstep\b/, 'LaunchPage takes the wizard step it renders');
});
