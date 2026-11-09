import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { DISCOVERY_MODE_TEXT } from '../../src/lib/discoveryType.js';

test.after(closeBrowser);

const PRIVACY = [
  'Only counts are read, never a data row, and the values of personal columns are never read.',
  'Standard Discovery keeps every count away from the AI.',
  'AI Enhanced Discovery shows the counts to the AI.',
  'The AI runs on Databricks model serving, so your data never leaves Databricks.',
];
const WHY = [
  'Before Inspire keeps a use case, it counts what the use case needs',
  'how many past examples of the outcome there are. A use case the data cannot support is dropped with its reason.',
];
const QUALITY = 'A use case you asked for is always kept, and it shows why the data may be thin.';
const FALSE_CLAIMS = [/nothing is shared/i, /\bunless\b/i, /outside model/i, /\bDeep\b/, /\u2014/];

test('AI Enhanced Discovery is recommended and the default, both modes are explained, and the launch sends the new name', async () => {
  const ui = await openUi('launch', { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } });
  const { page, pageErrors, made } = ui;
  try {
    const panel = page.locator('[data-discovery-panel]');
    await panel.waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-discovery-badge="AI Enhanced Discovery"]').innerText(), 'Recommended');
    assert.equal(await page.locator('[data-discovery-badge="Standard Discovery"]').count(), 0, 'only AI Enhanced Discovery carries the label (must-exclude)');
    assert.match(await panel.innerText(), /AI Enhanced Discovery is recommended/);
    assert.doesNotMatch(await panel.innerText(), /Standard Discovery is recommended/);
    const more = page.locator('[data-discovery-more]');
    assert.equal(await more.evaluate((d) => d.open), false, 'the longer explanation starts folded, so the section reads in a few lines (must-exclude)');
    assert.equal(await page.locator('[data-discovery-panel-part="why"]').isVisible(), false);
    await more.locator('summary').click();
    const privacy = await page.locator('[data-discovery-panel-part="privacy"]').innerText();
    for (const sentence of PRIVACY) assert.ok(privacy.includes(sentence), `privacy states: ${sentence}`);
    const why = await page.locator('[data-discovery-panel-part="why"]').innerText();
    for (const sentence of WHY) assert.ok(why.includes(sentence), `why states: ${sentence}`);
    assert.ok((await page.locator('[data-discovery-panel-part="quality"]').innerText()).includes(QUALITY));
    const standard = page.getByRole('button', { name: /^Standard Discovery/ });
    const enhanced = page.getByRole('button', { name: /^AI Enhanced Discovery/ });
    assert.ok((await standard.innerText()).includes(DISCOVERY_MODE_TEXT['Standard Discovery']));
    assert.ok((await enhanced.innerText()).includes(DISCOVERY_MODE_TEXT['AI Enhanced Discovery']));
    assert.match(await enhanced.innerText(), /\(default\)/);
    assert.doesNotMatch(await standard.innerText(), /\(default\)|Recommended/);
    const shown = [await panel.innerText(), await standard.innerText(), await enhanced.innerText()].join('\n');
    for (const claim of FALSE_CLAIMS) assert.doesNotMatch(shown, claim);
    await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await page.getByRole('button', { name: 'Get Started' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['03_discovery_type'], 'AI Enhanced Discovery', 'AI Enhanced Discovery is the default');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('picking Standard Discovery launches with it', async () => {
  const ui = await openUi('launch', { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } });
  const { page, pageErrors, made } = ui;
  try {
    await page.locator('[data-discovery-panel]').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: /^Standard Discovery/ }).click();
    await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await page.getByRole('button', { name: 'Get Started' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['03_discovery_type'], 'Standard Discovery');
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
});
