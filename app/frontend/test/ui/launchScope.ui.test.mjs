import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = {
  catalogs: ['main', 'samples'],
  schemas: { main: ['s', 'x'], samples: ['bakehouse'] },
  tables: { 'main.s': ['orders', 'customers'], 'main.x': ['stock'], 'samples.bakehouse': ['sales'] },
};
const launchOf = async (page, made) => {
  await idle(page);
  await page.getByRole('button', { name: 'Get Started' }).click();
  await until(() => made.launches.length === 1, 'the launch was sent once');
  return made.launches[0].params;
};
const pickedLine = (page) => page.getByText('Selected Metadata', { exact: true }).locator('xpath=..');

test('a whole catalog picked next to a schema of another catalog stays in scope, and every count names the same scope (must-exclude)', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="samples"]').click();
    await page.locator('button[title="main.s"]').click();
    await page.locator('button[title="orders"], button[title="s.orders"]').first().waitFor({ timeout: 15000 });
    await idle(page);
    assert.match(await pickedLine(page).innerText(), /1 schema, 1 catalog/);
    assert.match(await page.getByText('Metadata Selected', { exact: true }).locator('xpath=..').innerText(), /1 schema, 1 catalog/);
    assert.equal(await page.getByText(/^The whole catalog samples is in scope/).count() > 0, true, 'the catalog picked whole still warns that it is read whole');
    const params = await launchOf(page, made);
    assert.equal(params['01_uc_metadata'], 'main.s,samples');
    assert.equal(params['04_table_election'], 'Let Inspire Decides', 'no table is picked, so the default table choice stays');
  } finally {
    await ui.close();
  }
});

test('tables picked in one schema never drop a whole schema picked next to it', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="x"]').click();
    await page.locator('button[title="s.orders"]').click();
    await idle(page);
    assert.match(await pickedLine(page).innerText(), /1 table, 1 schema/);
    const params = await launchOf(page, made);
    assert.equal(params['01_uc_metadata'], 'main.s.orders,main.x');
    assert.equal(params['04_table_election'], 'All Tables', 'named tables are read as named unless the person chose otherwise');
  } finally {
    await ui.close();
  }
});

test('the Table Election the person chose is kept when they pick tables, and an automatic All Tables goes back when the tables are cleared', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await idle(page);
    await page.locator('button[title="orders"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    const election = page.locator('select:has(option[value="Transactional Only"])');
    assert.equal(await election.inputValue(), 'Let Inspire Decides', 'clearing the only picked table puts back the default the run started with');
    await election.selectOption('Transactional Only');
    await page.locator('button[title="customers"]').click();
    const params = await launchOf(page, made);
    assert.equal(params['01_uc_metadata'], 'main.s.customers');
    assert.equal(params['04_table_election'], 'Transactional Only', 'picking a table never overrides the Table Election the person chose');
  } finally {
    await ui.close();
  }
});

test('a schema listing Unity Catalog refuses says so, never "No schemas", and names the catalog', async () => {
  const ui = await openUi('launch', { catalogs: ['locked'] }, '', {
    init: (page) => page.route((url) => url.pathname === '/api/catalogs/locked/schemas', (route) => route.fulfill({
      status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'PERMISSION_DENIED: User does not have USE CATALOG on Catalog locked.' }),
    })),
  });
  const { page } = ui;
  try {
    await page.locator('button[title="locked"]').click();
    await page.getByText('Inspire could not list the schemas. The message above says why.').waitFor({ timeout: 15000 });
    assert.equal(await page.getByText(/No schemas/).count(), 0);
    assert.match(await page.locator('body').innerText(), /locked/);
  } finally {
    await ui.close();
  }
});

test('a table listing that fails says so, never "No tables", while a schema with no tables says which schema is empty', async () => {
  const ui = await openUi('launch', { catalogs: ['main'], schemas: { main: ['s', 'e'] }, tables: { 'main.e': [] } }, '', {
    init: (page) => page.route((url) => url.pathname === '/api/tables/main/s', (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'listing failed' }),
    })),
  });
  const { page } = ui;
  try {
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.getByText('Inspire could not list the tables. The message above says why.').waitFor({ timeout: 15000 });
    assert.match(await page.locator('body').innerText(), /Inspire could not list the tables of main\.s: listing failed/);
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="e"]').click();
    await page.getByText('No tables you can see in main.e').waitFor({ timeout: 15000 });
    assert.equal(await page.getByText(/could not list the tables/).count(), 0, 'a listing that worked clears the earlier failure');
  } finally {
    await ui.close();
  }
});

test('a business with a run still going is told before a second run starts, and another business or a finished run raises no note (must-exclude)', async () => {
  const now = Date.now();
  const sessions = [
    { session_id: '9001', business_name: 'Acme', completed_percent: 35, create_at: new Date(now - 20 * 60000).toISOString(), last_updated: new Date(now - 30000).toISOString(), processing_status: 'done' },
    { session_id: '9002', business_name: 'Globex', completed_percent: 100, completed_on: new Date(now - 60000).toISOString(), create_at: new Date(now - 90 * 60000).toISOString(), last_updated: new Date(now - 60000).toISOString(), processing_status: 'done' },
  ];
  const ui = await openUi('launch', { ...STATE, sessions });
  const { page, made } = ui;
  try {
    const note = page.locator('[data-testid="launch-live-run"]');
    await page.getByPlaceholder(BUSINESS).fill('Globex');
    await idle(page);
    assert.equal(await note.count(), 0, 'a finished run of the business raises no note');
    await page.getByPlaceholder(BUSINESS).fill(' acme ');
    await note.waitFor({ timeout: 15000 });
    assert.match(await note.innerText(), /^Acme already has a run going \(35% done\), started .+\. Get Started starts a second run next to it, and each run keeps its own use cases\.$/);
    assert.doesNotMatch(await note.innerText(), /9001/);
    await page.locator('button[title="main"]').click();
    const params = await launchOf(page, made);
    assert.equal(params['00_business_name'].trim(), 'acme', 'the note never blocks the run the person asked for');
  } finally {
    await ui.close();
  }
});
