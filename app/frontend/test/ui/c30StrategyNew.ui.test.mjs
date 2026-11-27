// REQ-121 + REQ-503 (FX-115): the strategy PDF the App builds and saves for a finished run is marked NEW in Assets > Documents,
// like the files the Generate docs wizard saves. A file that was already listed is not marked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toDocuments } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const ROOT = `${GENERATED}/acme`;
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED, output_language: 'English' } : s));
const OTHER = { name: 'Acme_use_cases.xlsx', path: `${ROOT}/Acme_use_cases.xlsx`, is_directory: false, file_size: 40000 };
const LISTED = { name: 'Acme_strategy.pdf', path: `${ROOT}/Acme_strategy.pdf`, is_directory: false, file_size: 90000 };

function backend({ listed = false } = {}) {
  const state = { saves: [], files: listed ? [LISTED, OTHER] : [OTHER] };
  const mount = (app) => {
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
    app.get('/api/workspace/list', (req, res) => res.json({ files: /\/inspire_out\/acme\/?$/.test(String(req.query.path || '')) ? state.files : [] }));
    app.post('/api/inspire/docs/save', (req, res) => {
      state.saves.push(req.body);
      state.files = [...state.files, { name: req.body.name, path: `${req.body.folder}/${req.body.name}`, is_directory: false, file_size: 90000 }];
      res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 });
    });
  };
  return { state, mount };
}

test('S1: the strategy PDF saved after a run is listed in Documents with a NEW tag', async () => {
  const be = backend();
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount: be.mount });
  try {
    await toDocuments(ui.page);
    const end = Date.now() + 40000;
    while (be.state.saves.length < 1 && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    assert.equal(be.state.saves.length, 1, 'the strategy PDF is saved once');
    const path = `${ROOT}/${be.state.saves[0].name}`;
    const tag = ui.page.locator(`[data-new-doc="${path}"]`).first();
    await tag.waitFor({ timeout: 20000 });
    assert.equal((await tag.innerText()).trim(), 'NEW');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('S2: a strategy PDF that was already listed has no NEW tag and no save', async () => {
  const be = backend({ listed: true });
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount: be.mount });
  try {
    await toDocuments(ui.page);
    await ui.page.getByText(LISTED.name).first().waitFor({ timeout: 20000 });
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(be.state.saves.length, 0);
    assert.equal(await ui.page.locator('[data-new-doc]').count(), 0);
  } finally { await ui.close(); }
});
