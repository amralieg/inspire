// RC7-C-04 follow-up: the Start page's admin footer showed "Warehouse: wh1..." (a cut id in mono). Fail-first contract: the footer names the
// SQL warehouse; the id shows only as "SQL warehouse <id>" when the warehouse list does not know the name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

async function footerOf(warehouses) {
  const ui = await openUi('launch', { warehouses: { warehouses } });
  try {
    const footer = ui.page.locator('[data-admin-footer]');
    await footer.waitFor({ timeout: 15000 });
    let text = '';
    await until(async () => {
      text = (await footer.innerText()).replace(/\s+/g, ' ').trim();
      return /Warehouse: (?!wh1\.\.\.)/.test(text);
    }, 'the footer names the warehouse').catch(() => {});
    return { text, mono: await footer.locator('.font-mono').allInnerTexts() };
  } finally {
    await ui.close();
  }
}

test('the Start footer shows the SQL warehouse name, not its id', async () => {
  const { text, mono } = await footerOf([{ id: 'wh1', name: 'Team Serverless', state: 'RUNNING' }]);
  assert.match(text, /Warehouse: Team Serverless$/);
  assert.equal(mono.some((m) => m.includes('wh1')), false, 'the id is not shown as a mono id (must-exclude)');
});

test('the Start footer says "SQL warehouse <id>" when the list does not know the name (must-keep)', async () => {
  const { text } = await footerOf([{ id: 'other', name: 'Another', state: 'RUNNING' }]);
  assert.match(text, /Warehouse: SQL warehouse wh1$/);
  assert.doesNotMatch(text, /wh1\.\.\./);
});
