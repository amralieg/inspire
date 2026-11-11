import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER, RESULTS } from './implementFixtures.js';
import { closeBrowser, goToStep, openUi, profileAt } from './uiSupport.mjs';
import { WHEEL_SCREENS, wheelEveryRegion, wheelScrolls } from './wheelScroll.mjs';

test.after(closeBrowser);

const body = (page) => page.locator('body');
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const wheeled = (names) => names.filter((n) => n.includes('wheeled'));

test('every Results scroll region, with the Genie notebook list open when the run has notebooks, takes the mouse wheel to their last item at 1280x800 and 1024x700', async () => {
  const ui = await openUi('results', { results: RESULTS, useCases: [] });
  const { page } = ui;
  try {
    await page.getByRole('region', { name: 'Use case list' }).waitFor({ timeout: 20000 });
    const toggle = page.locator('#genie-quick-access-toggle');
    if (await toggle.count()) await toggle.click();
    const names = await wheelEveryRegion(page, body(page), 'Results', { min: 1, copies: 12 });
    assert.ok(names.length >= 1, JSON.stringify(names));
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

for (const [kind, delta, pause, events] of [['mouse wheel notches of 100 pixels', 100, 150, 1], ['trackpad strokes of eight 15 pixel steps', 15, 16, 8]]) {
  test(`the Landing slides move one by one to the last slide with ${kind} at 1280x800 and 1024x700`, async () => {
    const ui = await openUi('landing');
    const { page } = ui;
    try {
      for (const [width, height] of WHEEL_SCREENS) {
        await page.setViewportSize({ width, height });
        const slides = page.locator('[data-landing-slides]');
        await slides.waitFor({ timeout: 20000 });
        await slides.evaluate((el) => { el.scrollTop = 0; });
        await page.waitForTimeout(300);
        await page.mouse.move(width / 2, height / 2);
        const tops = [];
        for (let i = 0; i < 400; i += 1) {
          for (let k = 0; k < events; k += 1) {
            await page.mouse.wheel(0, delta);
            await frames(page);
          }
          await page.waitForTimeout(pause);
          const at = await slides.evaluate((el) => [Math.round(el.scrollTop), el.scrollHeight - el.clientHeight]);
          tops.push(at[0]);
          if (at[0] >= at[1] - 2) break;
          if (tops.length > 4 && tops.at(-1) <= tops.at(-5)) break;
        }
        await page.waitForTimeout(600);
        const end = await slides.evaluate((el) => [Math.round(el.scrollTop), el.scrollHeight - el.clientHeight]);
        assert.ok(end[0] >= end[1] - 2, `${kind} at ${width}x${height}: the slides stop at ${end[0]} of ${end[1]} ${JSON.stringify(tops.slice(-12))}`);
        const last = page.locator('[data-landing-about]');
        const seen = await last.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1; });
        assert.ok(seen, `${kind} at ${width}x${height}: the last slide's footer is on screen`);
      }
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

test('the Launch catalog list with 60 catalogs takes the mouse wheel to its last catalog at 1280x800 and 1024x700', async () => {
  const catalogs = Array.from({ length: 60 }, (_, i) => `catalog_${String(i).padStart(2, '0')}`);
  const ui = await openUi('launch', { catalogs, schemas: { catalog_00: ['s'] }, tables: { 'catalog_00.s': ['orders'] } });
  const { page } = ui;
  try {
    await page.getByText('catalog_59', { exact: true }).first().waitFor({ state: 'attached', timeout: 20000 });
    const names = await wheelEveryRegion(page, body(page), 'Launch', { min: 1, copies: 0 });
    assert.ok(wheeled(names).length >= 1, JSON.stringify(names));
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Monitor stages, steps and discovered use cases of a long run take the mouse wheel to their last item at 1280x800 and 1024x700', async () => {
  const useCases = Array.from({ length: 40 }, (_, i) => ({ id: `N01-U${String(i).padStart(2, '0')}`, name: `Forecast demand for store ${i}`, business_domain: 'Sales', priority: 'High' }));
  const steps = Array.from({ length: 64 }, (_, i) => ({ step_id: String(i), session_id: '42', stage_name: `Stage ${Math.floor(i / 4)}`, step_name: `Step ${i}`,
    sub_step_name: '', status: 'ended_success', message: '', progress_increment: 1, last_updated: ago(64 - i),
    result_json: i === 10 ? { prompt_name: 'BASE_USE_CASE_GEN_PROMPT', use_cases: useCases } : {} }));
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: ago(90), processing_status: 'done',
      completed_percent: 60, completed_on: null, last_updated: ago(1) } }));
    app.get('/api/inspire/steps', (req, res) => res.json({ steps: req.query.since ? [] : steps }));
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
  };
  const ui = await openUi('monitor', {}, '&run=none', { mount });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Detailed Steps' }).click({ timeout: 15000 });
    await page.getByText('Stage 15', { exact: true }).first().waitFor({ timeout: 15000 });
    const names = await wheelEveryRegion(page, body(page), 'Monitor', { min: 2, copies: 0 });
    assert.ok(wheeled(names).length >= 2, JSON.stringify(names));
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const COUNTRIES = Array.from({ length: 120 }, (_, i) => `Country ${String(i).padStart(3, '0')}`);
const COLUMNS = Array.from({ length: 30 }, (_, i) => ({ name: `attribute_${i}`, type: 'string', distinct: 10 + i, smallest: 5, largest: 9000, nulls: 0, parent: null }));
const BIG_PROFILE = {
  table: 'main.sales.orders', records: 482100, applies: true, qualifies: true, standalone: false,
  reason: 'Inspire recommends region, then country because Anomaly Detection works out what is normal inside each group.',
  columns: [{ name: 'region', type: 'string', distinct: 6, smallest: 210, largest: 301100, nulls: 0, parent: null },
    { name: 'country', type: 'string', distinct: 120, smallest: 12, largest: 18200, nulls: 3, parent: 'region' }, ...COLUMNS],
  recommended: ['region', 'country'],
  example: { column: 'country', small_groups: [{ value: 'Country 119', records: 12 }], moves_to: 'Region 5' },
  time_column: 'order_date', recent: { days: 30, records: 31200 },
  suggested_groups: [{ value: 'Country 000', records: 18200, kind: 'biggest' }, { value: 'Country 050', records: 1400, kind: 'typical' }, { value: 'Country 119', records: 12, kind: 'smallest' }],
  group_column: 'country', group_sizes: COUNTRIES.map((value, i) => ({ value, records: 18200 - i * 100 })),
  groups_for: 'region, country',
  group_list: COUNTRIES.map((c, i) => ({ value: `Region ${i % 6} / ${c}`, records: 18200 - i * 100, parts: [{ column: 'region', value: `Region ${i % 6}` }, { column: 'country', value: c }] })),
  column_groups: { region: Array.from({ length: 6 }, (_, i) => ({ value: `Region ${i}`, records: 80000 - i * 1000 })), country: COUNTRIES.map((value, i) => ({ value, records: 18200 - i * 100 })),
    ...Object.fromEntries(COLUMNS.map((c) => [c.name, Array.from({ length: c.distinct }, (_, k) => ({ value: `${c.name} ${k}`, records: 5000 - k }))])) },
  first_run: { all: 482100, groups: 196120, recent: 31200, records: null }, default_scope: 'records', read_at: '2026-11-01T15:00:00Z',
};
const INSTRUCTION = '## Parameters\n| widget | type | default | allowed | used for |\n|---|---|---|---|---|\n'
  + '| `act_now_share` | text | 0.05 | 0 to 1 | Act now share |\n| `group_by` | text | all | | Data groups |\n| `run_scope` | text | all | | First run |\n';
const STEPS = ['What to deliver', 'Data & results', 'Data groups', 'First run', 'Measure', 'Where it lives', 'Who uses the App', 'App look', 'Run it', 'Review & build'];

const OPEN_ALL = {
  'Data groups': async (page) => {
    await page.locator('[data-show-all="grouping"]').click();
    await page.locator('[data-show-all="combine"]').click();
    await page.locator('[data-grouping-combine-column="country"]').waitFor();
  },
  'First run': async (page) => {
    await page.locator('[data-first-run-choice="groups"] input[type="radio"]').check();
    await page.locator('[data-scope-group]').first().waitFor();
    const more = page.locator('[data-scope-group]').first().locator('xpath=ancestor::*[@role="group"][1]').locator('[data-show-all]');
    if (await more.count()) await more.click();
    await page.locator('[data-scope-group]').nth(40).waitFor({ state: 'attached' });
  },
};

test('every scroll region of every one of the 10 Build wizard steps, with 120 data groups and 32 columns, takes the mouse wheel to its last item at 1280x800 and 1024x700', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init: profileAt([], BIG_PROFILE) });
  const { page } = ui;
  const seen = [];
  try {
    await page.locator('[data-wizard-body]').waitFor({ timeout: 20000 });
    for (const step of STEPS) {
      const labels = await page.locator('[data-wizard-header] ol li').allTextContents();
      assert.ok(labels.some((l) => l.replace(/^\d+\. /, '') === step), `the wizard has the ${step} step: ${labels.join(' | ')}`);
      await page.setViewportSize({ width: 1280, height: 800 });
      await goToStep(page, step);
      await (OPEN_ALL[step] || (() => null))(page);
      seen.push(...await wheelEveryRegion(page, page.locator('[data-wizard-body]'), `wizard ${step}`, { min: 1, copies: 0 }));
    }
    assert.ok(seen.some((n) => n.startsWith('wizard Data groups ') && /: wheeled\/wheeled$/.test(n)), JSON.stringify(seen));
    assert.ok(seen.some((n) => n.startsWith('wizard First run ') && /: wheeled\/wheeled$/.test(n)), JSON.stringify(seen));
    console.log('WIZARD REGIONS', JSON.stringify(seen));
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Launch chips of 80 chosen tables and the metadata preview take the mouse wheel to their last table at 1280x800 and 1024x700', async () => {
  const tables = Array.from({ length: 80 }, (_, i) => `t_${String(i).padStart(2, '0')}`);
  const ui = await openUi('launch', { catalogs: ['catalog_00'], schemas: { catalog_00: ['s'] }, tables: { 'catalog_00.s': tables } });
  const { page } = ui;
  try {
    await page.locator('button[title="catalog_00"]').click();
    await page.locator('button[title="s"]').click();
    for (const t of tables) await page.locator(`button[title="${t}"]`).click();
    const lastChip = page.getByRole('button', { name: 'Remove catalog_00.s.t_79', exact: true });
    await lastChip.waitFor({ timeout: 15000 });
    const chips = lastChip.locator('xpath=../..');
    await wheelScrolls(page, chips, () => lastChip, { name: 'Launch chosen tables' });
    const all = tables.map((t) => `catalog_00.s.${t}`).join(',');
    await page.getByRole('button', { name: 'Metadata Selected 80 tables', exact: true }).click();
    const preview = page.getByText(all, { exact: true });
    await preview.waitFor();
    await wheelScrolls(page, preview.locator('..'), () => preview, { name: 'Launch metadata preview' });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
