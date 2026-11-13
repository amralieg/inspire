import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } };
const APP = '11111111-2222-3333-4444-555555555555';
const STATEMENTS = [
  `GRANT USE CATALOG ON CATALOG \`main\` TO \`${APP}\``,
  `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${APP}\``,
  `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP}\``,
];
const PERMISSION = { statements: STATEMENTS, principal: APP, why: 'Discover reads main.s.orders as the App, and the App cannot read it yet.' };
const TEXT = STATEMENTS.map((s) => `${s};`).join('\n');

async function openLaunch(checkPermissions) {
  const ui = await openUi('launch', { ...STATE, checkPermissions });
  const { page, made } = ui;
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await idle(page);
  await until(async () => !(await page.getByRole('button', { name: 'Get Started' }).isDisabled()), 'Get Started opens');
  return { ui, page, made };
}

test('a run whose grants are missing opens Permission Required before the run starts, with the statements and the principal', async () => {
  const { ui, page, made } = await openLaunch([PERMISSION]);
  try {
    await page.getByRole('button', { name: 'Get Started' }).click();
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    assert.match(await dialog.locator('#permission-required-title').innerText(), /^Permission Required$/);
    assert.match(await dialog.innerText(), /Ask your admin to grant this permission to 11111111-2222-3333-4444-555555555555:/);
    assert.equal(await dialog.locator('[data-permission-statements=""]').innerText(), TEXT, 'the three statements are shown, each ending with a semicolon');
    assert.equal(made.launches.filter((l) => !l.check).length, 0, 'no run has started yet');
  } finally {
    await ui.close();
  }
});

test('Close returns to Launch and starts nothing', async () => {
  const { ui, page, made } = await openLaunch([PERMISSION]);
  try {
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.locator('[data-permission-dialog=""]').waitFor({ timeout: 15000 });
    await page.locator('[data-permission-dialog=""]').getByRole('button', { name: 'Close' }).click();
    assert.equal(await page.locator('[data-permission-dialog=""]').count(), 0, 'the dialog closes');
    assert.equal(made.launches.filter((l) => !l.check).length, 0, 'the run did not start');
    assert.equal(await page.getByRole('button', { name: 'Get Started' }).count(), 1, 'the page is still Launch');
  } finally {
    await ui.close();
  }
});

test('Start anyway starts the run after the dialog', async () => {
  const { ui, page, made } = await openLaunch([PERMISSION]);
  try {
    await page.getByRole('button', { name: 'Get Started' }).click();
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Start anyway' }).click();
    await until(async () => made.launches.filter((l) => !l.check).length === 1, 'the run starts once');
    assert.equal(await page.locator('[data-permission-dialog=""]').count(), 0);
  } finally {
    await ui.close();
  }
});

test('Copy puts every statement on the clipboard and shows Copied', async () => {
  const { ui, page } = await openLaunch([PERMISSION]);
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    await page.getByRole('button', { name: 'Get Started' }).click();
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Copy' }).click();
    await until(async () => (await dialog.getByRole('button', { name: 'Copied' }).count()) === 1, 'the button says Copied');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), TEXT);
  } finally {
    await ui.close();
  }
});

test('when the clipboard is refused, Copy selects the statements and falls back to execCommand', async () => {
  const { ui, page } = await openLaunch([PERMISSION]);
  try {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
      document.execCommand = () => true;
    });
    await page.getByRole('button', { name: 'Get Started' }).click();
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Copy' }).click();
    await until(async () => (await dialog.getByRole('button', { name: 'Copied' }).count()) === 1, 'the fallback reports Copied');
    const selected = await page.evaluate(() => window.getSelection().toString());
    assert.match(selected, /GRANT SELECT ON TABLE/, 'the statements are selected for the copy');
  } finally {
    await ui.close();
  }
});

test('a run with nothing to grant starts with no dialog', async () => {
  const { ui, page, made } = await openLaunch([]);
  try {
    await page.getByRole('button', { name: 'Get Started' }).click();
    await until(async () => made.launches.filter((l) => !l.check).length === 1, 'the run starts');
    assert.equal(await page.locator('[data-permission-dialog=""]').count(), 0);
  } finally {
    await ui.close();
  }
});

test('a folder the App cannot write to shows See the grant under the output check, and the dialog gives the Share steps and the CLI line', async () => {
  const FOLDER = '/Workspace/Users/pat.lee@example.com/inspire_output';
  const folder = {
    statements: [], principal: 'inspire-sp', why: `The run writes its files to ${FOLDER}, and the App cannot write there yet.`,
    instructions: [`In Workspace, open ${FOLDER} > Share, add inspire-sp with Can Edit`, `databricks api patch /api/2.0/permissions/directories/<object_id> --json '{"access_control_list":[{"service_principal_name":"inspire-sp","permission_level":"CAN_EDIT"}]}'`],
  };
  const ui = await openUi('launch', { ...STATE, outputRefusal: { message: `Inspire cannot save to ${FOLDER}.`, permissions: [folder] } });
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    const see = page.locator('[data-output-check="refused"] [data-see-grant=""]').first();
    await see.waitFor({ timeout: 15000 });
    await see.click();
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    assert.match(await dialog.locator('#permission-required-title').innerText(), /^Permission Required$/);
    assert.match(await dialog.locator('[data-permission-statements=""]').innerText(), /In Workspace, open .* > Share, add inspire-sp with Can Edit/);
    assert.match(await dialog.locator('[data-permission-statements=""]').innerText(), /databricks api patch \/api\/2\.0\/permissions\/directories\//);
  } finally {
    await ui.close();
  }
});
