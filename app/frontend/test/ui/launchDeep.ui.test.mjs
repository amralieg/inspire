import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeBrowser, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const PRIVACY = [
  'Only aggregates are used, such as row counts, date ranges, empty shares, join match rates, and the most common values of non-personal category columns.',
  'No data row is ever sent to the AI.',
  'Personal columns are only counted, and their values are never read.',
  'The AI runs on Databricks model serving, so your data never leaves Databricks.',
];
const WHY = [
  'Deep checks your data before it suggests use cases.',
  'It counts the rows in each table, finds the dates each table covers, measures how empty each column is, and tests whether joins between tables really match.',
];
const QUALITY = 'Fewer use cases built on empty or thin tables, broken joins or the wrong dates get through.';
const STANDARD = 'Reads metadata only. Never reads a row of your data.';
const FALSE_CLAIMS = [/nothing is shared/i, /\bunless\b/i, /outside model/i];

test('Deep is labeled Highly recommended, stays the default, and its panel states what Deep reads and what never reaches the AI', async () => {
  const ui = await openUi('launch', { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } });
  const { page, pageErrors, made } = ui;
  try {
    const panel = page.locator('[data-deep-panel]');
    await panel.waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-discovery-badge="Deep"]').innerText(), 'Highly recommended');
    assert.equal(await page.locator('[data-discovery-badge="Standard"]').count(), 0, 'only Deep carries the label');
    assert.match(await panel.innerText(), /Deep discovery is highly recommended/);
    const privacy = await page.locator('[data-deep-panel-part="privacy"]').innerText();
    for (const sentence of PRIVACY) assert.ok(privacy.includes(sentence), `privacy states: ${sentence}`);
    const why = await page.locator('[data-deep-panel-part="why"]').innerText();
    for (const sentence of WHY) assert.ok(why.includes(sentence), `why states: ${sentence}`);
    assert.ok((await page.locator('[data-deep-panel-part="quality"]').innerText()).includes(QUALITY));
    const standard = page.getByRole('button', { name: /^Standard/ });
    assert.ok((await standard.innerText()).includes(STANDARD), 'the Standard promise is unchanged');
    const shown = [await panel.innerText(), await page.getByRole('button', { name: /^Deep/ }).innerText(), await standard.innerText()].join('\n');
    for (const claim of FALSE_CLAIMS) assert.doesNotMatch(shown, claim);
    await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await page.getByRole('button', { name: 'Get Started' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['03_discovery_type'], 'Deep', 'Deep stays the default');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('no Launch page, Results or API text claims nothing is shared with the AI or carves out an outside model', () => {
  const files = ['../../src/pages/LaunchPage.jsx', '../../src/components/ResultsInsights.jsx', '../../../backend/openapi.yaml', '../../../README.md'];
  for (const file of files) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /nothing is shared/i, file);
    assert.doesNotMatch(text, /unless you pick an outside model/i, file);
  }
  const launch = readFileSync(new URL('../../src/pages/LaunchPage.jsx', import.meta.url), 'utf8');
  assert.ok(launch.includes(`desc: '${STANDARD}'`), 'the Standard card text is unchanged');
});
