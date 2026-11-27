// C28 (REQ-568, REQ-570) fail-first: the results nav has Overview and Use cases only (no Assets page). Overview keeps the business/value content,
// with a left panel of two entries: Story and Documents. Documents lists the overall documents (Excel, PDF, PowerPoint; no overall infographic)
// and only the use cases that have documents (fixture: 2 of 6 have docs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, shot } from './uiSupport.mjs';
import { REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const FOLDER = '/Workspace/Users/someone/inspire/acme';
const FILES = ['Acme_use_cases.xlsx', 'Acme_brief.pdf', 'Acme_deck.pptx', 'Acme_infographic.pdf'];
const DOCS_MADE = ['N01-U03', 'N02-U01'];
const mount = (app) => {
  app.get('/api/workspace/list', (_req, res) => res.json({ files: FILES.map((name) => ({ name, path: `${FOLDER}/${name}`, is_directory: false, file_size: 2048 })) }));
  app.get('/api/workspace/export', (_req, res) => res.type('application/octet-stream').send('bytes'));
};
const init = async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/\/api\/inspire\/usecases\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json().catch(() => ({}));
    const rows = (body.usecases || []).map((r) => (DOCS_MADE.includes(String(r.id)) ? { ...r, docs_generated_at: '2026-11-23T10:00:00Z' } : r));
    await route.fulfill({ response, json: { ...body, usecases: rows } });
  });
};
const sessions = REVIEW_SESSIONS.map((s) => (s.session_id === '42' ? { ...s, generation_path: FOLDER, widget_values: { ...s.widget_values, generation_path: FOLDER } } : s));
const STATE = { ...REVIEW_STATE, sessions };
const nav = (page) => page.getByRole('navigation', { name: 'Results sections' });
const cards = (page) => page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]');
const entry = (page, name) => page.locator('[data-overview-nav]').locator(`[data-overview-panel="${name}"]`);

async function open() {
  const ui = await openUi('results', STATE, '', { mount, init });
  await cards(ui.page).first().waitFor();
  return ui;
}

test('the nav has exactly Overview and Use cases, and no Assets', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await nav(page).waitFor();
    const names = (await nav(page).locator('[data-results-nav-item]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().replace(/ \d+$/, ''));
    assert.deepEqual([...names].sort(), ['Overview', 'Use cases']);
    assert.equal(await nav(page).getByText(/Assets|Business/).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('Overview shows the left panel with Story and Documents; Story keeps the business content', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await nav(page).getByRole('tab', { name: /^Overview/ }).click();
    await entry(page, 'story').waitFor();
    await entry(page, 'documents').waitFor();
    assert.equal(await page.locator('[data-overview-nav] [data-overview-panel]').count(), 2);
    assert.equal(await entry(page, 'story').getAttribute('aria-current'), 'page');
    await page.locator('[data-executive-summary]').waitFor();
    await page.getByRole('region', { name: 'Figures of this run' }).waitFor();
    await shot(page, 'c28_overview_1440x900', false);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('Documents lists the 3 overall formats and only the use cases that have documents', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await nav(page).getByRole('tab', { name: /^Overview/ }).click();
    await entry(page, 'documents').click();
    const docs = page.locator('[data-overview-documents]');
    await docs.waitFor();
    const overall = docs.locator('[data-overall-doc]');
    await overall.first().waitFor();
    assert.deepEqual(await overall.evaluateAll((els) => els.map((e) => e.getAttribute('data-overall-doc')).sort()), ['pdf', 'pptx', 'xlsx']);
    await docs.getByRole('button', { name: 'Download Acme_use_cases.xlsx' }).waitFor({ timeout: 15000 });
    await docs.getByRole('button', { name: 'Download Acme_brief.pdf' }).waitFor();
    await docs.getByRole('button', { name: 'Download Acme_deck.pptx' }).waitFor();
    assert.equal(await docs.getByText(/infographic/i).count(), 0, 'no overall infographic');
    const rows = docs.locator('[data-doc-use-case]');
    assert.equal(await rows.count(), 2, 'only the use cases that have documents');
    assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-doc-use-case')).sort()), DOCS_MADE);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
