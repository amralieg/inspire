// C24 (RC7-B-10, RC7-B-13; T-RES-11, T-STR-01): Results -> Assets lists each file with its type and created date (the listing's modified time),
// newest first, and when the run wrote no strategy document it says so in plain words instead of showing nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toView } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED } : s));
const ROOT = `${GENERATED}/acme`;
const at = (day, hour = 12) => Date.UTC(2026, 10, day, hour);
const file = (name, modified_at, file_size = 40000) => ({ name, path: `${ROOT}/${name}`, is_directory: false, file_size, ...(modified_at ? { modified_at } : {}) });
const FOLDER = { name: 'docs', path: `${ROOT}/docs`, is_directory: true, file_size: 0, modified_at: at(19) };
const OLDEST = file('a_catalog.pdf', at(20));
const NEWEST = file('b_use_cases.xlsx', at(26));
const MIDDLE = file('c_deck.pptx', at(23));
const UNDATED = file('d_notes.md', 0);
const STRATEGY = file('Acme_strategy.pdf', at(24));

// Only the run folder (the business folder under the output path) lists the files; a sub folder is empty (a folder that lists itself would loop the tree walk).
const backendOf = (files) => (app) => { app.get('/api/workspace/list', (req, res) => res.json({ files: /\/inspire_out\/acme\/?$/.test(String(req.query.path || '')) ? files : [] })); };
const open = (files) => openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount: backendOf(files) });
const rowOf = (page, f) => page.locator(`[data-asset-row="${f.name}"]`).first();

test('B-10: each Assets file shows its type and created date, and files are listed newest first (a file with no date goes last)', async () => {
  const ui = await open([FOLDER, UNDATED, OLDEST, NEWEST, MIDDLE]);
  const { page } = ui;
  try {
    await toView(page, 'Assets');
    await rowOf(page, NEWEST).waitFor({ timeout: 20000 });
    const types = {};
    for (const f of [OLDEST, NEWEST, MIDDLE, UNDATED]) types[f.name] = (await rowOf(page, f).locator('[data-asset-type]').innerText()).trim();
    assert.deepEqual(types, { 'a_catalog.pdf': 'PDF', 'b_use_cases.xlsx': 'Excel', 'c_deck.pptx': 'PowerPoint', 'd_notes.md': 'Markdown' });
    for (const f of [OLDEST, NEWEST, MIDDLE]) {
      const want = await page.evaluate((ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), f.modified_at);
      assert.equal((await rowOf(page, f).locator('[data-asset-date]').innerText()).trim(), want, `${f.name} shows its created date`);
    }
    assert.equal(await rowOf(page, UNDATED).locator('[data-asset-date]').count(), 0, 'a file the listing gives no time for shows no date');
    const order = await page.locator('[data-asset-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-asset-row')));
    assert.deepEqual(order.filter((n) => n !== 'docs'), ['b_use_cases.xlsx', 'c_deck.pptx', 'a_catalog.pdf', 'd_notes.md'], 'newest first, undated last');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('B-13: a run with no strategy document says so in plain words and points to Generate docs, never "Genie Code"', async () => {
  const ui = await open([OLDEST, NEWEST]);
  const { page } = ui;
  try {
    await toView(page, 'Assets');
    const note = page.locator('[data-testid="strategy-document-note"]');
    await note.waitFor({ timeout: 20000 });
    const text = (await note.innerText()).replace(/\s+/g, ' ');
    assert.match(text, /strategy document/i);
    assert.match(text, /Generate docs/);
    assert.doesNotMatch(text, /Genie Code/i);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('T-STR-01: when the strategy PDF is listed, Assets shows it and adds no "no strategy document" note', async () => {
  const ui = await open([OLDEST, STRATEGY]);
  const { page } = ui;
  try {
    await toView(page, 'Assets');
    await rowOf(page, STRATEGY).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-testid="strategy-document-note"]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
