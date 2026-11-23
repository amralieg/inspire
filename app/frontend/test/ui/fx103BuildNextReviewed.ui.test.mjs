// REQ-497 FX-103 (D-uae-02b): after "Accept and save" the Build next row reads "Reviewed calculation", not "Provisional estimate".
// The totals read is repeated when a value is saved (the page's refresh key moves), so the row follows the card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { barePage, closeBare } from './fx63cBundle.mjs';

test.after(closeBare);

const uc = (id, name) => ({ id, use_case: name, name_with_technique: name, primary_table: 'main.s.t', tables_involved: 'main.s.t' });
const LISTED = [uc('N01-U01', 'Plan Bake Volumes')];

test('a saved and accepted value changes the Build next label from Provisional estimate to Reviewed calculation', async () => {
  const { page, errors } = await barePage();
  try {
    await page.evaluate(() => {
      const { React, createRoot, BuildNextPanel } = window.__lib;
      window.__accepted = false;
      const apiFetch = async (url) => {
        if (url.includes('/usecases')) return { usecases: [] };
        if (url.includes('/implement/history')) return { latest: [] };
        if (url.includes('/value/totals')) return { use_cases: { 'N01-U01': { status: window.__accepted ? 'calculated' : 'estimated', verb: 'REDUCE COST', amount: 60000, currency: 'USD' } } };
        return { use_cases: {} };
      };
      const root = createRoot(document.getElementById('root'));
      window.__show = (key, list) => root.render(React.createElement(BuildNextPanel, { apiFetch, inspireDatabase: 'main.inspire', warehouseId: 'wh1', sessionId: '42', useCases: list, refreshKey: key }));
    });
    await page.evaluate((list) => window.__show(0, list), LISTED);
    const line = page.locator('[data-value-estimate="value"]').first();
    await line.waitFor({ timeout: 10000 });
    assert.match(await line.innerText(), /Provisional estimate/);
    await page.evaluate((list) => { window.__accepted = true; window.__show(1, list); }, LISTED);
    await page.waitForFunction(() => /Reviewed calculation/.test(document.querySelector('[data-value-estimate="value"]')?.textContent || ''), null, { timeout: 10000 });
    assert.doesNotMatch(await line.innerText(), /Provisional estimate/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
