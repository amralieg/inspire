// Solution architecture on an opened use case card: with no design yet the card offers to design one; designing shows the diagram with
// one box per flow component in stage order, the governance strip, and the summed cost; a failed design says why and keeps the button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DESIGN = {
  pattern: 'Batch scoring to an operational queue',
  summary: 'Score open orders nightly and work them from a queue.',
  components: [
    { id: 'lakeflow_jobs', name: 'Lakeflow Jobs', lane: 'transform', role: 'scores orders nightly', why: 'no decision is needed in seconds' },
    { id: 'lakebase', name: 'Lakebase (Postgres)', lane: 'serve', role: 'holds the follow-up queue', why: 'the App writes back' },
    { id: 'databricks_app', name: 'Databricks App', lane: 'use', role: 'staff work the queue', why: 'an operational screen' },
    { id: 'unity_catalog', name: 'Unity Catalog governance', lane: 'govern', role: 'governs every table', why: 'always present' },
  ],
  flows: [{ from: 'lakeflow_jobs', to: 'lakebase', label: 'scores' }, { from: 'lakebase', to: 'databricks_app', label: 'queue' }],
  phases: [{ name: 'Pilot', weeks: '1-2', steps: ['Score one region'] }],
  cost_items: [
    { id: 'lakeflow_jobs', name: 'Lakeflow Jobs', usd_low: 20, usd_high: 200, basis: 'serverless jobs' },
    { id: 'lakebase', name: 'Lakebase (Postgres)', usd_low: 100, usd_high: 500, basis: 'one small instance' },
  ],
  cost_low: 120, cost_high: 700, assumptions: [], prerequisites: ['Orders table refreshed daily'], risks: ['Queue not adopted'],
  sources: ['main.s.orders'], review_fixes: 1, design_version: 1, model: 'team-chat', created_at: '', created_by: '',
};

const architectureRoute = (answers) => (page) => page.route((url) => url.pathname === '/api/inspire/implement/architecture', async (route) => {
  const method = route.request().method();
  const answer = answers[method];
  await route.fulfill({ status: answer.status || 200, contentType: 'application/json', body: JSON.stringify(answer.body) });
});

async function openFirstCard(page) {
  const card = page.locator('[data-use-case-no]').first();
  await card.locator('[aria-expanded]').first().waitFor();
  await card.locator('[aria-expanded]').first().click();
  return card;
}

test('an opened card offers a design, then shows the diagram in stage order, the governance strip and the summed cost', async () => {
  const ui = await openUi('results', REVIEW_STATE, '', { init: architectureRoute({ GET: { body: { design: null } }, POST: { body: { design: DESIGN } } }) });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const card = await openFirstCard(page);
    const empty = card.locator('[data-architecture="empty"]');
    await empty.waitFor();
    await card.locator('[data-architecture-generate]').click();
    const shown = card.locator('[data-architecture="design"]');
    await shown.waitFor();
    await idle(page);
    const boxes = await shown.locator('[data-architecture-box]').evaluateAll((els) => els.map((el) => [el.getAttribute('data-architecture-box'), el.getBoundingClientRect().x]));
    assert.deepEqual(boxes.map(([id]) => id).sort(), ['databricks_app', 'lakebase', 'lakeflow_jobs'], 'governance is not a box in the flow');
    const x = Object.fromEntries(boxes);
    assert.ok(x.lakeflow_jobs < x.lakebase && x.lakebase < x.databricks_app, 'boxes read left to right through the stages');
    assert.match(await shown.textContent(), /Governed by Unity Catalog governance/);
    assert.equal((await shown.locator('[data-architecture-cost]').textContent()).trim(), '$120–$700');
    assert.match(await shown.textContent(), /1 reviewer fix applied/);
  } finally {
    await ui.close();
  }
});

test('a failed design says why and keeps the button, so the person can try again (must-exclude)', async () => {
  const ui = await openUi('results', REVIEW_STATE, '', {
    init: architectureRoute({ GET: { body: { design: null } }, POST: { status: 409, body: { error: 'no chat model you can use is ready on this workspace' } } }),
  });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const card = await openFirstCard(page);
    await card.locator('[data-architecture-generate]').click();
    await card.getByRole('alert').filter({ hasText: 'no chat model' }).waitFor();
    assert.equal(await card.locator('[data-architecture="design"]').count(), 0);
    assert.equal(await card.locator('[data-architecture-generate]').isEnabled(), true);
  } finally {
    await ui.close();
  }
});
