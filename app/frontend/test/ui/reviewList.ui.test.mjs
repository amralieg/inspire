import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cards = (page) => list(page).locator('[aria-expanded]');
const shownNames = async (page) => (await cards(page).evaluateAll((els) => els.map((el) => el.innerText))).map((t) => ['Alpha basket', 'Middle stock', 'Twin one', 'Twin two', 'Zeta churn'].find((n) => t.includes(n)));

const uc = (no, name, extra = {}) => ({
  No: no, Name: name, Statement: `${name} for the business`, Solution: `Build ${name.toLowerCase()}`, 'Business Value': `${name} pays back`,
  'Tables Involved': 'main.s.orders', Priority: 'Medium', Quality: 'Medium', priority_score: '3.0', quality_score: '3.0', ...extra,
});

const LIST_RESULTS = {
  discovery_type: 'Deep',
  title: 'Acme Use Cases Catalog',
  domains: [
    { domain_name: 'Customer', use_cases: [
      uc('N01-U01', 'Zeta churn', { Subdomain: 'Retention', Priority: 'Very High', inspire_score: '9.0', best_of_best: 'Y', best_of_best_rank: '1', 'Analytics Technique': 'Classification' }),
      uc('N01-U02', 'Alpha basket', { Subdomain: 'Growth', inspire_score: '5.0', 'Analytics Technique': 'Clustering' }),
    ] },
    { domain_name: 'Supply', use_cases: [uc('N02-U01', 'Middle stock', { Subdomain: 'Inventory', inspire_score: '6.0', 'Analytics Technique': 'Forecasting' })] },
    { domain_name: 'Operations', use_cases: [
      uc('N03-U01', 'Twin one', { Subdomain: 'Shifts', inspire_score: '4.0' }),
      uc('N03-U01', 'Twin two', { Subdomain: 'Shifts', inspire_score: '3.5' }),
    ] },
    { domain_name: 'Empty', use_cases: [] },
  ],
  delivery_order: ['N02-U01', 'N09-U09', 'N02-U01'],
};

test('the Review list sorts, searches, clears and expands the way its labels say, and never counts what it does not show (must-exclude)', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: LIST_RESULTS });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await cards(page).first().waitFor();
    await idle(page);

    assert.equal((await page.locator('[data-stat="Domains"] [data-stat-value]').innerText()).trim(), '3', 'a domain with no use case is not counted');

    const order = page.locator('[data-insight="Suggested build order"]');
    const text = await order.innerText();
    assert.doesNotMatch(text, /N09-U09/, 'an id the run does not hold never shows');
    assert.match(text, /1 use case\b/);

    const sort = page.locator('select').filter({ has: page.locator('option', { hasText: 'Sort: Name' }) });
    await sort.selectOption({ label: 'Sort: Name' });
    assert.deepEqual(await shownNames(page), ['Alpha basket', 'Middle stock', 'Twin one', 'Twin two', 'Zeta churn'], 'Sort: Name sorts by name, Best of Best included');
    await sort.selectOption({ label: 'Sort: Domain' });
    assert.deepEqual((await shownNames(page)).slice(0, 2).sort(), ['Alpha basket', 'Zeta churn'], 'Customer comes first under Sort: Domain');
    assert.deepEqual((await shownNames(page)).slice(-1), ['Middle stock'], 'Supply comes last under Sort: Domain');
    await sort.selectOption({ label: 'Sort: Priority tier' });
    assert.equal((await shownNames(page))[0], 'Zeta churn', 'the Very High use case leads under Sort: Priority tier');
    await sort.selectOption({ label: 'Sort: Inspire score (high → low)' });

    const search = page.getByRole('textbox', { name: 'Search use cases' });
    assert.ok((await search.boundingBox()).width >= 200, 'the search box keeps room to type at 1280 px');
    await search.fill('clustering');
    assert.deepEqual(await shownNames(page), ['Alpha basket'], 'search finds the technique shown on the card');
    await search.fill('Supply');
    assert.deepEqual(await shownNames(page), ['Middle stock'], 'search finds the domain shown on the card');
    await search.fill('');

    await page.getByRole('button', { name: 'Show favorites only' }).click();
    await list(page).getByText('No use cases match your filters').waitFor();
    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await cards(page).first().waitFor();
    assert.equal(await cards(page).count(), 5, 'Clear all filters brings every use case back after Favorites only');
    assert.equal(await page.getByRole('button', { name: 'Show favorites only' }).getAttribute('aria-pressed'), 'false');

    await cards(page).filter({ hasText: 'Twin one' }).first().click();
    assert.equal(await cards(page).filter({ hasText: 'Twin one' }).first().getAttribute('aria-expanded'), 'true');
    assert.equal(await cards(page).filter({ hasText: 'Twin two' }).first().getAttribute('aria-expanded'), 'false', 'two use cases that share a number open one at a time');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Review files offer Open only where a browser can show the file, give small files a real size, and say why a download failed (must-exclude)', async () => {
  const folder = '/Workspace/Users/someone/inspire/acme';
  const files = {
    'Acme-dbx_inspire.pdf': { size: 4096 },
    'Acme-dbx_inspire.xlsx': { size: 8192 },
    'readme.md': { size: 300 },
  };
  const mount = (app) => {
    app.get('/api/workspace/list', (_req, res) => res.json({ files: Object.entries(files).map(([name, f]) => ({ name, path: `${folder}/${name}`, is_directory: false, file_size: f.size })) }));
    app.get('/api/workspace/export', (_req, res) => res.status(404).json({ error: 'File not found' }));
  };
  const sessions = REVIEW_STATE.sessions.map((s) => (s.session_id === '42' ? { ...s, generation_path: folder, widget_values: { ...s.widget_values, generation_path: folder } } : s));
  const ui = await openUi('results', { ...REVIEW_STATE, sessions }, '', { mount });
  const { page } = ui;
  try {
    await cards(page).first().waitFor();
    await page.getByRole('heading', { name: /^Quick access: documents/i }).waitFor();
    await idle(page);
    assert.ok(await page.getByRole('button', { name: 'Open Acme-dbx_inspire.pdf' }).count() > 0, 'a PDF opens in a tab');
    assert.equal(await page.getByRole('button', { name: 'Open Acme-dbx_inspire.xlsx' }).count(), 0, 'an Excel file is never offered to open in a tab');
    assert.equal(await page.getByRole('button', { name: 'Open readme.md' }).count(), 0);
    const tree = page.locator('div', { hasText: 'readme.md' }).filter({ has: page.getByRole('button', { name: 'Download readme.md' }) }).last();
    assert.match(await tree.innerText(), /300 B/, 'a 300 byte file never reads 0KB');
    assert.doesNotMatch(await tree.innerText(), /\b0KB\b/);
    await page.getByRole('button', { name: 'Download Acme-dbx_inspire.xlsx' }).first().click();
    const problem = page.locator('[data-file-problem]');
    await problem.waitFor({ timeout: 15000 });
    assert.match(await problem.innerText(), /Inspire could not download Acme-dbx_inspire\.xlsx: File not found\./);
    await problem.getByRole('button', { name: 'Dismiss' }).click();
    assert.equal(await problem.count(), 0);
    await page.getByRole('button', { name: 'Open Acme-dbx_inspire.pdf' }).first().click();
    await problem.waitFor({ timeout: 15000 });
    assert.match(await problem.innerText(), /Inspire could not open Acme-dbx_inspire\.pdf: File not found\./);
    assert.equal(page.context().pages().length, 1, 'a failed Open leaves no empty tab behind');
    assert.deepEqual(ui.pageErrors.filter((e) => !/404/.test(e)), []);
  } finally {
    await ui.close();
  }
});
