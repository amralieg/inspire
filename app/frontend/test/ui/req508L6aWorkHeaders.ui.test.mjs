// REQ-508 L6a (Art Director pass, "A Calm Console"): the work pages (Monitor, Review, Build, Run) share one page header: text-h1 28/36
// weight 600, no gradient text, one icon tile variant, and the 1200px content width. Audit scratch/req508_art_director.md F19-F21.
// Fail-pre (15eb146b9): h1 sizes are text-xl / text-2xl / gradient 2xl-3xl (MonitorPage:404, ResultsPage:1201, ImplementPage:118,
// RunPage:312), no page renders [data-page-header], and the icon tiles differ per page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { HARNESS_USE_CASE } from './implementFixtures.js';
import { assertHeader, headerFacts } from './req508Headers.mjs';

test.after(closeBrowser);

const monitorMount = (app) => {
  app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: new Date().toISOString(),
    completed_percent: 40, completed_on: null, last_updated: new Date().toISOString(), processing_status: 'processing' } }));
  app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
  app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
  app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
  app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, run_name: 'Inspire Discover', life_cycle_state: 'RUNNING', start_time: Date.now(), tasks: [] }));
};

const PAGES = [
  ['Monitor', 'monitor', {}, { mount: monitorMount }],
  ['Review', 'results', { ...REVIEW_STATE, results: { ...REVIEW_STATE.results, run_status: 'success' } }, {}],
  ['Build', 'implement', { useCase: HARNESS_USE_CASE }, {}],
  ['Run', 'run', REVIEW_STATE, {}],
];

for (const [name, open, state, opts] of PAGES) {
  test(`${name}: one page header (text-h1, no gradient, the shared icon tile) and the REQ-520 FRAME page width`, async () => {
    const ui = await openUi(open, state, '', opts);
    const { page } = ui;
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      assertHeader(assert, await headerFacts(page), { name, width: name === 'Monitor' ? null : '1488px' }); // REQ-520 FRAME: 1440px content + gutters (Monitor keeps its uncapped frame)
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}
