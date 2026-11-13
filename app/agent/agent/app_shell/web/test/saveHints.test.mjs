import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';
import { EXAMPLES, plannerRoutes, scenarioRoutes } from './exampleRoutes.mjs';

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

async function open(file, routes) {
  const info = appInfo(EXAMPLES[file].settings, 1, {}, `examples/${file}`);
  return openApp(browser, served.base, info, { routes });
}

test('a disabled override says which of its two fields is missing, and the hint goes once both are filled', async () => {
  const { page, context, seen } = await open('planner.json', plannerRoutes([], [], { keep: true }));
  await EXAMPLES['planner.json'].ready(page);
  await page.getByRole('button', { name: /^Override$/ }).first().click();
  const hint = page.locator('[data-save-missing]');
  assert.equal(await hint.textContent(), 'Add your value and why you override it to save.');
  await page.getByRole('spinbutton').first().fill('95');
  assert.equal(await hint.textContent(), 'Add why you override it to save.');
  await page.getByRole('textbox').last().fill('Supplier cannot deliver');
  assert.equal(await hint.count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a disabled scenario save says it needs a name, and the hint goes once the name is typed', async () => {
  const { page, context, seen } = await open('scenario_lab.json', scenarioRoutes([], []));
  await EXAMPLES['scenario_lab.json'].ready(page);
  const hint = page.locator('[data-save-missing]');
  assert.equal(await hint.textContent(), 'Add a name to save.');
  await page.getByRole('textbox', { name: 'Name this scenario' }).fill('Price up 8%');
  assert.equal(await hint.count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a disabled scenario save shows its reason as the button hover text too, so the reason shows on hover', async () => {
  const { page, context, seen } = await open('scenario_lab.json', scenarioRoutes([], []));
  await EXAMPLES['scenario_lab.json'].ready(page);
  const save = page.getByRole('button', { name: 'Save the scenario' });
  assert.equal(await save.isDisabled(), true);
  assert.equal(await save.getAttribute('title'), 'Add a name to save.');
  await page.getByRole('textbox', { name: 'Name this scenario' }).fill('Price up 8%');
  assert.equal(await save.getAttribute('title'), null);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('REQ-099: the scenario Save on the Scenarios tab shows a spinner and Saving… while the save is open', async () => {
  const { page, context } = await open('scenario_lab.json', { ...scenarioRoutes([], []), 'scenario/save': () => new Promise(() => {}) });
  try {
    await EXAMPLES['scenario_lab.json'].ready(page);
    await page.locator('[data-rail="work"]').click();
    const form = page.locator('[data-scenario-save]');
    await form.waitFor({ timeout: 20000 });
    await form.getByRole('textbox', { name: 'Name this scenario' }).fill('Price up 8%');
    const save = form.locator('button[type="submit"]');
    await save.click();
    await page.waitForTimeout(400);
    const state = await save.evaluate((b) => ({ spinner: !!b.querySelector('.saving-ring'), text: b.textContent.trim(), disabled: b.disabled }));
    assert.equal(state.spinner, true, 'the scenario Save shows a spinner while it saves');
    assert.match(state.text, /Saving…/, 'the scenario Save says Saving… while it saves');
    assert.equal(state.disabled, true, 'the scenario Save cannot be pressed twice');
  } finally {
    await context.close();
  }
});
