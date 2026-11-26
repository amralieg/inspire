// c23: the Permission Required dialog lists the request links grouped by catalog, in a bordered scrollable box, one row each,
// and only for the securables the dialog itself asks for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const CATALOGS = ['sales_catalog', 'ops_catalog', 'finance_catalog'];
const tables = CATALOGS.flatMap((c, ci) => Array.from({ length: ci === 0 ? 14 : 13 }, (_v, i) => `${c}.s.t${i}`));
const grant = (full) => { const [c, s, t] = full.split('.'); return `GRANT SELECT ON TABLE \`${c}\`.\`${s}\`.\`${t}\` TO \`app-principal\``; };
const statements = tables.map(grant);
const url = (full) => `https://workspace.example.com/explore/data/${full.split('.').join('/')}`;

const mount = (app) => {
  app.get('/api/catalogs', (_req, res) => res.json({ spGrants: true, source: 'rest', truncated: false,
    catalogs: [{ name: 'sales_catalog', partial: { missing: statements } }],
    permissions: [{ statements, instructions: [], steps: [], principal: 'app-principal', why: 'x' }] }));
  app.get('/api/catalogs/:catalog/schemas', (_req, res) => res.json({ schemas: [] }));
  // The check also answers a link for a catalog this run never asked about.
  app.post('/api/access-request/check', (_req, res) => {
    const links = [...tables, 'not_in_run_catalog'].map((full) => ({ type: full.includes('.') ? 'TABLE' : 'CATALOG', full_name: full, url: url(full) }));
    res.json({ offered: false, links });
  });
};

test('c23: 40 links across 3 catalogs show as 3 parent rows in a scrollable box, and a catalog outside the run is absent', async () => {
  const ui = await openUi('launch', {}, '', { mount });
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('[data-catalog-partial="sales_catalog"] button').waitFor({ timeout: 20000 });
    await idle(page);
    await page.locator('[data-catalog-partial="sales_catalog"] button').click();
    await page.locator('[data-request-links]').waitFor({ timeout: 20000 });
    const rows = page.locator('[data-request-links] [data-request-row]');
    assert.equal(await rows.count(), 3, 'one row per parent catalog, not one per table');
    const box = page.locator('[data-request-links] [data-request-box]');
    const style = await box.evaluate((el) => { const c = getComputedStyle(el); return { y: c.overflowY, max: c.maxHeight, border: c.borderTopWidth }; });
    assert.equal(style.y, 'auto');
    assert.equal(style.max, '256px', 'max height 16rem');
    assert.notEqual(style.border, '0px', 'the box is bordered');
    const text = await page.locator('[data-request-links]').innerText();
    assert.match(text, /ops_catalog — 13 tables/);
    assert.doesNotMatch(text, /not_in_run_catalog/);
    const tag = await rows.first().evaluate((el) => el.tagName);
    assert.equal(tag, 'LI', 'each row is its own element');
    assert.equal(await page.locator('[data-request-links] summary').count(), 3, 'each group is expandable');
  } finally {
    await ui.close();
  }
});
