// RC6-B-10: "Show the missing grant" names only the catalog it sits under, never the other ~160 catalogs, and the dialog's
// "Also request access on" list renders one item per entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const names = Array.from({ length: 160 }, (_v, i) => `cat${String(i).padStart(3, '0')}`);
const grants = (n) => [`GRANT USE CATALOG ON CATALOG \`${n}\` TO \`app-principal\``, `GRANT SELECT ON CATALOG \`${n}\` TO \`app-principal\``];
const mount = (app) => {
  app.get('/api/catalogs', (_req, res) => res.json({ spGrants: true, source: 'rest', truncated: false,
    catalogs: names.map((n) => ({ name: n, partial: { missing: grants(n) } })),
    permissions: [{ statements: names.flatMap(grants), instructions: [], steps: [], principal: 'app-principal', why: 'The App cannot read all of what Inspire needs.' }] }));
  app.get('/api/catalogs/:catalog/schemas', (_req, res) => res.json({ schemas: [] }));
  app.post('/api/access-request/check', (req, res) => {
    const seen = [...new Set((req.body.statements || []).map((s) => /`([^`]+)`/.exec(s)[1]))];
    res.json({ offered: true, links: seen.map((n) => ({ url: `https://workspace.example.com/explore/data/${n}`, full_name: n })) });
  });
};

test('RC6-B-10: the missing grant of one catalog lists that catalog only, one item per line', async () => {
  const ui = await openUi('launch', {}, '', { mount });
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('[data-catalog-partial="cat007"] button').waitFor({ timeout: 20000 });
    await idle(page);
    await page.locator('[data-catalog-partial="cat007"] button').click();
    await page.locator('[data-permission-dialog]').waitFor({ timeout: 20000 });
    await page.locator('[data-permission-advanced] summary').click();
    const shown = await page.locator('[data-permission-statements]').allInnerTexts();
    const all = shown.join('\n');
    assert.match(all, /GRANT SELECT ON CATALOG `cat007`/);
    assert.equal((all.match(/GRANT /g) || []).length, 2, 'only the 2 statements of the one catalog');
    assert.doesNotMatch(all, /cat008/);
    const copy = await page.locator('[data-permission-box]').innerText();
    assert.doesNotMatch(copy, /cat006|cat008/);
    assert.equal(await page.locator('[data-request-links] a').count(), 0, 'one container: nothing to list as "also"');
  } finally {
    await ui.close();
  }
});

test('RC6-B-10: the "Also request access on" list renders its entries as separate items', async () => {
  const two = (app) => {
    app.get('/api/catalogs', (_req, res) => res.json({ spGrants: true, source: 'rest', truncated: false,
      catalogs: [{ name: 'ca', partial: { missing: [...grants('ca'), ...grants('cb'), ...grants('cc')] } }],
      permissions: [{ statements: [...grants('ca'), ...grants('cb'), ...grants('cc')], instructions: [], steps: [], principal: 'app-principal', why: 'x' }] }));
    app.get('/api/catalogs/:catalog/schemas', (_req, res) => res.json({ schemas: [] }));
    app.post('/api/access-request/check', (req, res) => {
      const seen = [...new Set((req.body.statements || []).map((s) => /`([^`]+)`/.exec(s)[1]))];
      res.json({ offered: true, links: seen.map((n) => ({ url: `https://workspace.example.com/explore/data/${n}`, full_name: n })) });
    });
  };
  const ui = await openUi('launch', {}, '', { mount: two });
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('[data-catalog-partial="ca"] button').waitFor({ timeout: 20000 });
    await idle(page);
    await page.locator('[data-catalog-partial="ca"] button').click();
    await page.locator('[data-request-links]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-request-links] li').count(), 2, 'each other item is its own list entry');
  } finally {
    await ui.close();
  }
});
