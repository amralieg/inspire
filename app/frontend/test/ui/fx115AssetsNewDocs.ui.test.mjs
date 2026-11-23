// FX-115 (REQ-503): "any generated docs will land in the assets". The wizard (FX-114) saves each file into the run's Assets folder, writes the
// saved paths to sessionStorage `inspire:new-docs:<session id>` and fires the window event `inspire:new-docs` ({ detail: { sessionId, paths } }).
// Assets then reloads its listing, and every listed file whose path is marked shows a NEW tag and a Download button; old Discover files keep
// showing, without the tag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toView } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const FOLDER = `${GENERATED}/acme`;
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED } : s));
const OLD = { name: 'Acme-dbx_inspire.pdf', path: `${FOLDER}/Acme-dbx_inspire.pdf`, is_directory: false, file_size: 90000 };
const NEW = ['Acme_infographic.png', 'Acme_deck.pptx', 'Acme_use_cases.xlsx'].map((name) => ({ name, path: `${FOLDER}/${name}`, is_directory: false, file_size: 40000 }));

function backend() {
  const state = { saved: false, lists: 0 };
  const mount = (app) => {
    app.get('/api/workspace/list', (_req, res) => { state.lists += 1; res.json({ files: state.saved ? [OLD, ...NEW] : [OLD] }); });
  };
  return { state, mount };
}
const poll = async (check, what, timeout = 20000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

test('N1: files the wizard saved appear in Assets with a NEW tag and a Download button after the new-docs event; the old Discover PDF has no tag', async () => {
  const be = backend();
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount: be.mount });
  const { page } = ui;
  try {
    await toView(page, 'Assets');
    await page.getByText(OLD.name).first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-new-doc]').count(), 0, 'nothing is new before a save');
    const listsBefore = be.state.lists;
    be.state.saved = true;
    await page.evaluate((paths) => {
      sessionStorage.setItem('inspire:new-docs:42', JSON.stringify(paths));
      window.dispatchEvent(new CustomEvent('inspire:new-docs', { detail: { sessionId: '42', paths } }));
    }, NEW.map((f) => f.path));
    await poll(async () => be.state.lists > listsBefore, 'Assets reloads its listing on the event');
    for (const f of NEW) {
      const tag = page.locator(`[data-new-doc="${f.path}"]`).first();
      await tag.waitFor({ timeout: 20000 });
      assert.equal((await tag.innerText()).trim(), 'NEW', `${f.name} is tagged NEW`);
      assert.ok((await page.getByRole('button', { name: `Download ${f.name}`, exact: true }).count()) >= 1, `${f.name} can be downloaded`);
    }
    assert.equal(await page.locator(`[data-new-doc="${OLD.path}"]`).count(), 0, 'the old Discover document is listed without the tag');
    assert.ok((await page.getByText(OLD.name).count()) >= 1, 'the old Discover document is still listed');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('N2: the NEW tags survive a reload in the same tab (sessionStorage) and belong to their run only', async () => {
  const be = backend();
  be.state.saved = true;
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', {
    mount: be.mount,
    init: (page) => page.addInitScript((paths) => { sessionStorage.setItem('inspire:new-docs:42', JSON.stringify(paths)); sessionStorage.setItem('inspire:new-docs:41', JSON.stringify([`${paths[0]}.other`])); },
      NEW.map((f) => f.path)),
  });
  const { page } = ui;
  try {
    await toView(page, 'Assets');
    await page.locator(`[data-new-doc="${NEW[0].path}"]`).first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-new-doc]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-new-doc')))].length), NEW.length);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
