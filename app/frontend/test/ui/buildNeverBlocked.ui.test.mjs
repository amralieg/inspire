// REQ-483 (FX-78): a Build is never disabled by app read access. Tables the person owns are granted with their permissions
// (green line, no "Send this to"); tables owned by someone else show the grant as a warning, owners named once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_IT, closeBrowser, openUi, toSummary } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { me: { userName: ['owner', 'example.com'].join('@'), displayName: 'Owner' } };
const GRANT = 'GRANT MANAGE ON TABLE `main`.`s`.`orders` TO `inspire-sp`';
const GRANT_B = 'GRANT MANAGE ON TABLE `main`.`s`.`returns` TO `inspire-sp`';
const BY_YOU = { tables: ['main.s.orders'], grant: [GRANT], text: 'When the build starts, Inspire uses your permissions to let the App it makes read main.s.orders' };

async function open({ reads, byYou }) {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  const submits = [];
  await page.route('**/api/inspire/implement/plan**', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const summary = { ...json.summary };
    if (reads) summary.app_reads = reads;
    if (byYou) summary.app_reads_by_you = byYou;
    await route.fulfill({ response, json: { ...json, summary } });
  });
  await page.route('**/api/inspire/implement/submit', (route) => {
    submits.push(route.request().postData());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'mvp', use_case_id: 'N01-U01', run_id: '991', warnings: [] }) });
  });
  await toSummary(page);
  return { ui, page, submits };
}

test('tables the person owns: Build is on, no "Send this to", a green line says Inspire grants with their permissions', async () => {
  const { ui, page, submits } = await open({ byYou: BY_YOU });
  try {
    const build = page.getByRole('button', { name: BUILD_IT, exact: true });
    await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled), BUILD_IT, { timeout: 30000 });
    assert.equal(await page.getByText(/Send this to/).count(), 0);
    assert.equal(await page.locator('[data-app-reads-blocking]').count(), 0);
    await page.locator('[data-app-reads-by-you]').waitFor({ timeout: 15000 });
    assert.match(await page.locator('[data-app-reads-by-you]').innerText(), /uses your permissions/);
    await build.click();
    await ui.page.waitForTimeout(1500);
    assert.equal(submits.length, 1, 'Build posts the submit');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('blocking:true with every table covered by app_reads_by_you still leaves Build on and shows no "Send this to"', async () => {
  const reads = { tables: [{ table: 'main.s.orders', owner: 'owner@example.com' }], owners: ['owner@example.com'], text: 'Inspire cannot share main.s.orders', blocking: true, grant: [GRANT] };
  const { ui, page, submits } = await open({ reads, byYou: BY_YOU });
  try {
    await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled), BUILD_IT, { timeout: 30000 });
    assert.equal(await page.getByText(/Send this to/).count(), 0, 'no Send this to when the person owns the tables');
    assert.equal(await page.getByText(/Build waits/).count(), 0);
    await page.locator('[data-app-reads-by-you]').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: BUILD_IT, exact: true }).click();
    await page.waitForTimeout(1500);
    assert.equal(submits.length, 1, 'Build posts the submit');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('a table owned by someone else: Build stays off, the grant SQL shows once, the owner is named once', async () => {
  const reads = {
    tables: [{ table: 'main.s.returns', owner: 'data-eng' }, { table: 'main.s.refunds', owner: 'data-eng' }],
    owners: ['data-eng', 'data-eng'], text: 'Inspire cannot share main.s.returns', blocking: true, grant: [GRANT_B],
  };
  const { ui, page, submits } = await open({ reads });
  try {
    const box = page.locator('[data-app-reads-grant]');
    await box.waitFor({ timeout: 15000 });
    assert.equal(await box.count(), 1);
    assert.equal((await page.locator('body').innerText()).split(GRANT_B).length - 1, 1, 'the grant SQL shows once');
    const area = page.locator('[data-app-reads-blocking]');
    const said = await area.innerText();
    assert.equal(said.split('data-eng').length - 1, 1, 'the owner is named once');
    assert.match(said, /Build waits until the App can read this data/);
    assert.equal(await page.getByRole('button', { name: BUILD_IT, exact: true }).isDisabled(), true, 'Build stays off for tables someone else owns');
    assert.equal(submits.length, 0, 'nothing posts into the backend refusal');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
