// REQ-482: a run that is waiting to start shows motion in its status card, not a still clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

test('a pending run shows a spinning icon in the status card while it waits to start', async () => {
  const mount = (app) => {
    app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, run_name: 'Inspire Discover', life_cycle_state: 'PENDING', start_time: Date.now() - 30000, tasks: [] }));
  };
  const ui = await openUi('monitor', {}, '', { mount });
  const { page } = ui;
  try {
    const card = page.locator('[data-testid="monitor-status"]');
    await card.waitFor({ timeout: 15000 });
    await page.locator('[data-testid="monitor-job-state"]').filter({ hasText: 'Waiting to start' }).waitFor({ timeout: 15000 });
    assert.ok(await card.locator('svg[class*="animate-spin"]').count() >= 1, 'the status card has a spinning icon');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
