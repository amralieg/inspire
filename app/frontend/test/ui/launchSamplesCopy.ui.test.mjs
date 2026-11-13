import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const DEST = 'main.inspire';
const SALES = 'samples.bakehouse.sales_transactions';
const STATE = {
  catalogs: ['samples', 'main'],
  schemas: { samples: ['bakehouse'], main: ['inspire'] },
  tables: { 'samples.bakehouse': ['sales_transactions', 'trips'], 'main.inspire': ['notes'] },
};

async function pickSamplesSales(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="samples"]').click();
  await page.locator('button[title="samples.bakehouse"]').click();
  await page.locator('button[title="sales_transactions"]').click();
  await page.locator('button[title="main"]').click();
  await idle(page);
}

const offer = (page) => page.locator('[data-samples-offer]');
const startButton = (page) => page.getByRole('button', { name: 'Get Started' });

test('picking a samples table shows the copy offer before Start, and Start waits for the choice', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickSamplesSales(page);
    await offer(page).waitFor({ timeout: 15000 });
    const text = await offer(page).innerText();
    assert.match(text, /samples/, 'the offer names samples');
    assert.match(text, /CREATE TABLE AS SELECT/, 'the offer says the table must be copied');
    assert.match(text, /Value cannot be measured/, 'the offer says why the copy matters');
    assert.equal(await startButton(page).isDisabled(), true, 'Start waits until the person copies or chooses descriptions only');
    assert.match(await page.locator('[data-launch-block]').innerText(), /Copy the samples tables/);
    assert.equal(made.launches.length, 0, 'no run starts from the picker');
  } finally {
    await ui.close();
  }
});

test('copy chosen: one action copies into the schema the person named, and the run then reads the copies, not samples', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickSamplesSales(page);
    await offer(page).waitFor({ timeout: 15000 });
    await page.getByLabel('Copy into').fill(DEST);
    await page.locator('[data-samples-copy]').click();
    await until(() => made.sampleCopies.length === 1, 'the copy was sent once');
    assert.deepEqual(made.sampleCopies[0], { entries: [SALES], destination: DEST }, 'the copy names the samples table and the schema');
    await offer(page).waitFor({ state: 'detached', timeout: 15000 });
    assert.match(await page.locator('[data-samples-copied]').innerText(), /Copied 1 table into main\.inspire\. The run reads your copies\./);
    await until(async () => !(await startButton(page).isDisabled()), 'Start is ready once the copies are in the picks');
    await startButton(page).click();
    await until(() => made.launches.length === 1, 'the run was sent once');
    assert.equal(made.launches[0].params['01_uc_metadata'], `${DEST}.sales_transactions`, 'the run request names the copy');
  } finally {
    await ui.close();
  }
});

test('descriptions only: one plain sentence says value cannot be measured, and the run keeps the samples table', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickSamplesSales(page);
    await offer(page).waitFor({ timeout: 15000 });
    await page.locator('[data-samples-descriptions]').click();
    assert.equal(await page.locator('[data-samples-sentence]').innerText(), 'Value cannot be measured on samples, so this run reads only the table descriptions.');
    await until(async () => !(await startButton(page).isDisabled()), 'Start is ready after the choice');
    await startButton(page).click();
    await until(() => made.launches.length === 1, 'the run was sent once');
    assert.equal(made.launches[0].params['01_uc_metadata'], SALES, 'the run reads the samples table as picked');
    assert.equal(made.launches[0].samples_choice, 'descriptions', 'the /api/run body carries the choice the server refuses without (REQ-109)');
    assert.equal(made.sampleCopies.length, 0, 'nothing was copied');
  } finally {
    await ui.close();
  }
});

test('picking only samples does not fill the Inspire database with a samples schema, so Start asks for one', async () => {
  const ui = await openUi('launch', STATE, '&db=blank');
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="samples"]').click();
    await page.locator('button[title="bakehouse"]').click();
    await page.locator('button[title="sales_transactions"]').click();
    await idle(page);
    assert.match(await page.locator('[data-launch-block]').innerText(), /Set the Inspire Database/);
    assert.equal(await startButton(page).isDisabled(), true);
    assert.equal(made.launches.length, 0);
  } finally {
    await ui.close();
  }
});

test('a table outside samples gets no copy offer and Start is not held (must-exclude)', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="inspire"]').click();
    await page.locator('button[title="notes"]').click();
    await idle(page);
    assert.equal(await offer(page).count(), 0, 'no samples table, so no offer');
    await until(async () => !(await startButton(page).isDisabled()), 'Start is ready without a samples choice');
    assert.equal(made.sampleCopies.length, 0);
  } finally {
    await ui.close();
  }
});

test('a copy the warehouse refuses names the table and the reason, keeps the samples table picked, and copies nothing', async () => {
  const ui = await openUi('launch', { ...STATE, sampleCopyAnswer: [200, { destination: 'main.inspire', copies: [], failed: [{ source: SALES, reason: '[PERMISSION_DENIED] User does not have CREATE TABLE on schema main.inspire' }] }] });
  const { page, made } = ui;
  try {
    await pickSamplesSales(page);
    await offer(page).waitFor({ timeout: 15000 });
    await page.getByLabel('Copy into').fill(DEST);
    await page.locator('[data-samples-copy]').click();
    await until(async () => (await page.locator('[data-samples-error]').innerText()).includes('Could not copy samples.bakehouse.sales_transactions'), 'the refusal names the table');
    assert.match(await offer(page).textContent(), /\[PERMISSION_DENIED\] User does not have CREATE TABLE on schema main\.inspire/, 'the Databricks reason is kept under Details');
    assert.equal(await offer(page).count(), 1, 'the offer stays, because the table is still samples');
    assert.equal(await startButton(page).isDisabled(), true, 'Start still waits for a choice');
    assert.equal(made.launches.length, 0);
  } finally {
    await ui.close();
  }
});
