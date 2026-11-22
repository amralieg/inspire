// REQ-482: a run that is waiting to start shows motion in its status card, not a still clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

test('a pending run shows a spinning icon in the status card while it waits to start', async () => {
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: new Date().toISOString(), completed_percent: 0, completed_on: null, last_updated: new Date().toISOString(), processing_status: 'running' } }));
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
    app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
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
