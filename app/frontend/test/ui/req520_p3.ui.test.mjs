// REQ-520 P3 (art review AD-07, AD-12, AD-23, AD-25): geometry checks for the four remaining frontend polish items.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_INSPIRE_URL, HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, openUi, painted, toView } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };

test('AD-07: at 2560 no Home decorative orb sits outside the 1280 px column band (none hugs the screen edge)', async () => {
  const ui = await openUi('landing');
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.getByText('Scroll to explore').waitFor({ state: 'attached', timeout: 20000 });
    const orbs = await page.evaluate(() => [...document.querySelectorAll('.overflow-y-auto.scrollbar-hide > section [aria-hidden="true"].rounded-full')]
      .filter((el) => /blur-\[/.test(el.className)).map((el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(2560 - r.right) }; }));
    assert.ok(orbs.length >= 5, `found ${orbs.length} orbs`);
    // column 640..1920; an orb may reach 160 px past it (its soft edge), never the screen edge.
    const bad = orbs.filter((o) => o.left < 480 || o.right < 480);
    assert.deepEqual(bad, [], `orbs too close to the screen edge (left, right margin px): ${JSON.stringify(bad)}`);
  } finally { await ui.close(); }
});

test('AD-12: at 2560 the Start KPI tile numbers are at least 24 px', async () => {
  const ui = await openUi('app', REVIEW_STATE, '', { mount: (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
  } });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('[data-portfolio-card] [data-card-value]').first().waitFor({ timeout: 20000 });
    const sizes = await page.locator('[data-portfolio-card] [data-card-value]').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    assert.ok(sizes.length > 0 && sizes.every((s) => s >= 24), `tile number sizes: ${sizes}`);
  } finally { await ui.close(); }
});

test('AD-23: the "Build first" label does not touch any value-map dot', async () => {
  const SCORES = { 'N01-U01': '7.4', 'N01-U02': '8.1', 'N01-U03': '5.2', 'N01-U04': '6.0', 'N02-U01': '9.0', 'N02-U02': '4.5' };
  const results = { ...REVIEW_RESULTS, domains: REVIEW_RESULTS.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((u) => ({ ...u, inspire_score: SCORES[u.No] })) })) };
  const entry = (status, verb, amount) => (status === 'none' ? { status, verb: null, amount: null, currency: null } : { status, verb, amount, currency: 'USD' });
  const TOTALS = { run: { totals: [{ currency: 'USD', amount: 6700000, calculated: 3200000, estimated: 3500000 }], n: 6, n_calculated: 1, n_estimated: 2, n_none: 3, by_verb: [] },
    use_cases: { 'N01-U01': entry('calculated', 'AVOID RISK', 3200000), 'N01-U02': entry('estimated', 'GROW REVENUE', 2400000), 'N01-U03': entry('estimated', 'REDUCE COST', 1100000),
      'N01-U04': entry('none'), 'N02-U01': entry('none'), 'N02-U02': entry('none') } };
  const ui = await openUi('results', { ...REVIEW_STATE, results }, '', { mount: (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
    app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    app.get('/api/inspire/value/totals', (_req, res) => res.json(TOTALS));
    app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
  } });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await toView(page, 'Business');
    const map = page.getByRole('region', { name: 'Value map' });
    await map.locator('[data-map-point]').first().waitFor({ timeout: 15000 });
    const hits = await map.evaluate((el) => {
      const label = [...el.querySelectorAll('svg text')].find((t) => t.textContent.trim() === 'Build first').getBoundingClientRect();
      return [...el.querySelectorAll('[data-map-point]')].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left < label.right && r.right > label.left && r.top < label.bottom && r.bottom > label.top;
      }).map((c) => c.getAttribute('data-use-case-no'));
    });
    assert.deepEqual(hits, [], `dots overlapping the label: ${hits}`);
  } finally { await ui.close(); }
});

test('AD-25: the build diagnostics note carries its own max-w-[75ch]; the page root has no descendant workaround', async () => {
  const owner = ['owner', 'example.com'].join('@');
  const spec = { ...defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner }),
    outputs: { dashboard: true, inspire_url: HARNESS_INSPIRE_URL } };
  const state = { me: { userName: owner, displayName: 'Owner' }, buildStamp: { version: '1.5.0', shell: 'feedface00112233' },
    history: [{ session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'failed', change_classes: 'initial', created_by: owner, spec_json: JSON.stringify(spec),
      status_message: 'Preview run failed: boom', job_id: '77', implement_run_id: '5555', last_preview_run_id: '9001', notebook_path: `/Users/${owner}/inspire/Acme_implemented/N01-U01`,
      created_at: '2026-11-08T10:00:00.000Z', updated_at: '2026-11-08T10:12:00.000Z' }], steps: [] };
  const ui = await openUi('implement', state, '');
  const { page } = ui;
  try {
    await page.locator('[data-progress-card] [data-diagnostics-download]').waitFor({ timeout: 15000 });
    await painted(page);
    const f = await page.evaluate(() => {
      const note = document.querySelector('[data-diagnostics-note]');
      return { noteClass: note.className, rootClass: document.querySelector('[data-implement-page]').className, maxWidth: getComputedStyle(note).maxWidth };
    });
    assert.ok(f.noteClass.includes('max-w-[75ch]'), `note class: ${f.noteClass}`);
    assert.ok(!f.rootClass.includes('data-diagnostics-note'), `page root still carries the workaround: ${f.rootClass}`);
    assert.notEqual(f.maxWidth, 'none');
  } finally { await ui.close(); }
});
