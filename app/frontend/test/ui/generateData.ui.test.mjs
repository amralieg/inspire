import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const started = (tables) => [200, {
  ok: true, session_id: '1', pipeline: { inspire_agent_notebook: '/Shared/inspire-ai/agent', ...(tables ? { demo_tables: tables } : {}) },
}];

async function startedLine(demoAnswer) {
  const ui = await openUi('generate', { demoAnswer });
  const { page, pageErrors, made } = ui;
  try {
    await page.getByPlaceholder(/./).first().fill('Acme');
    await page.locator('textarea').fill('A retailer with stores and an online shop');
    await page.locator('button[type="submit"]').click();
    await page.getByText('Pipeline started').waitFor({ timeout: 20000 });
    const line = (await page.locator('ol li').first().innerText()).trim();
    assert.equal(await page.getByText('Generate 5 Delta tables').count(), 0);
    assert.equal(made.launches.length, 1);
    assert.deepEqual(pageErrors, []);
    return line;
  } finally {
    await ui.close();
  }
}

test('the started pipeline names the generated tables and the 13 kind tables when they are planted', async () => {
  assert.equal(await startedLine(started({ generated: 5, kind_signal: 13 })),
    'Write 5 Delta tables from your description and 13 tables that carry the data of every use-case kind, all with UC table and column comments');
});

test('the started pipeline names only the generated tables when the kind tables are switched off', async () => {
  assert.equal(await startedLine(started({ generated: 5, kind_signal: 0 })),
    'Write 5 Delta tables from your description, all with UC table and column comments');
});

test('the started pipeline names no table count when the backend sends none', async () => {
  assert.equal(await startedLine(started(null)), 'Write the demo Delta tables with UC table and column comments');
});
