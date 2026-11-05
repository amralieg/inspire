import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { REVIEW_LEFT_DEMO } from '../../src/lib/runPages.js';
import { SHOWCASE_NOTE } from '../../src/lib/showcase.js';
import { openShowcase } from '../../../scripts/showcaseRecorder.mjs';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
};
const KNOWN = { ...REVIEW_STATE, knownRuns: ['42', '41', '50', '51', '60', '61'], deniedRuns: ['77'] };
const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cardOf = (page, id) => page.locator(`[data-use-case-no="${id}"]`);
const address = (page) => page.evaluate(() => [window.location.search, window.location.hash]);
const note = (page) => page.locator('[data-review-link-note]');
const errorBox = (page) => page.locator('[data-results-error] span');

async function openedCard(page, id) {
  const box = cardOf(page, id);
  await box.locator('[aria-expanded="true"]').first().waitFor({ timeout: 20000 });
  await page.waitForFunction((no) => {
    const el = [...document.querySelectorAll('[data-use-case-no]')].find((e) => e.getAttribute('data-use-case-no') === no);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= -2 && r.top < window.innerHeight - 40;
  }, id, { timeout: 10000 });
  return box;
}

test('?review=<session>&uc=<use case> opens Review on that run with that use case open and in view, then the address names the run page alone', async () => {
  const ui = await openUi('app', KNOWN, '&review=42&uc=N01-U02', { mount });
  const { page } = ui;
  try {
    await openedCard(page, 'N01-U02');
    assert.equal((await page.locator('h1').innerText()).trim(), 'Review');
    assert.equal(await page.locator('[data-run-heading] [data-run-business]').innerText(), 'Acme');
    assert.equal(await list(page).locator('[aria-expanded="true"]').count(), 1, 'only the linked use case is open');
    assert.deepEqual(await address(page), ['?open=app', '#/review/42'], 'the link query is gone, other queries stay, and the hash names the Review page of the run');
    assert.equal(await note(page).count(), 0);

    await page.evaluate(() => { window.location.hash = '#/review/42/N01-U03'; });
    await openedCard(page, 'N01-U03');
    assert.equal(await list(page).locator('[aria-expanded="true"]').count(), 1, 'a second link in the open tab opens its own use case');
    assert.deepEqual(await address(page), ['?open=app', '#/review/42']);

    await page.reload();
    await page.locator('[data-run-heading] [data-run-business]').filter({ hasText: 'Acme' }).waitFor({ timeout: 20000 });
    assert.equal((await page.locator('h1').innerText()).trim(), 'Review', 'a reload stays on the Review page of the run');
    await list(page).locator('[data-use-case-no]').first().waitFor({ timeout: 20000 });
    assert.equal(await list(page).locator('[aria-expanded="true"]').count(), 0, 'a reload does not open the linked use case again');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the back button after a handled review link returns to the run page without opening the use case again', async () => {
  const ui = await openUi('app', KNOWN, '', { mount });
  const { page, origin } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().waitFor({ timeout: 20000 });
    await page.goto(`${origin}/test/ui/implement.html?open=app&review=42&uc=N01-U02`);
    await openedCard(page, 'N01-U02');
    await page.goto(`${origin}/test/ui/implement.html?open=app`);
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().waitFor({ timeout: 20000 });
    await page.goBack();
    await page.waitForLoadState('load');
    await page.locator('[data-run-heading] [data-run-business]').filter({ hasText: 'Acme' }).waitFor({ timeout: 20000 });
    assert.deepEqual(await address(page), ['?open=app', '#/review/42'], 'the history entry of the link holds the run page, not the link');
    await list(page).locator('[data-use-case-no]').first().waitFor({ timeout: 20000 });
    assert.equal(await list(page).locator('[aria-expanded="true"]').count(), 0, 'going back opens the run, not the linked use case');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a link to a run the Inspire Database does not have, or one the person cannot read, or with no run id, says which and lists the runs', async () => {
  const cases = [
    ['&review=999&uc=N01-U01', 'Inspire has no run 999 in the Inspire Database main.inspire. Here is every run.', 'error', '#/review/999'],
    ['&review=77&uc=N01-U01', 'You cannot read run 77: your sign-in has no read access to the Inspire Database main.inspire. Ask its owner for SELECT on it.', 'error', '#/review/77'],
    ['&review=abc&uc=N01-U01', 'That link names no run Inspire can open: abc is not a run id. Here is every run.', 'note', '#/review'],
    ['&review=&uc=N01-U01', 'That link names no run. Here is every run.', 'note', '#/review'],
  ];
  for (const [query, text, where, hash] of cases) {
    const ui = await openUi('app', KNOWN, query, { mount });
    const { page } = ui;
    try {
      const shown = where === 'error' ? errorBox(page) : note(page);
      await shown.waitFor({ timeout: 20000 });
      assert.equal(await shown.innerText(), text, query);
      await page.getByRole('group', { name: 'Runs' }).locator('[data-run="42"]').waitFor({ timeout: 20000 });
      assert.equal(await page.locator('[data-run-heading]').count(), 0, `${query} opens no run`);
      assert.equal(await page.locator('h1').innerText(), 'Review', 'never a blank page');
      assert.deepEqual(await address(page), ['?open=app', hash], `${query}: the hash names the Review page, never the use case`);
      assert.deepEqual(ui.pageErrors.filter((e) => !/status of 403/.test(e)), [], query);
    } finally {
      await ui.close();
    }
  }
});

test('a link to a run that exists but has no such use case opens the run and says the use case was not found', async () => {
  const ui = await openUi('app', KNOWN, '&review=42&uc=N09-U09', { mount });
  const { page } = ui;
  try {
    await note(page).waitFor({ timeout: 20000 });
    assert.equal(await note(page).innerText(), 'Run 42 has no use case N09-U09, so Review shows every use case of the run.');
    await page.locator('[data-run-heading]').waitFor();
    assert.equal(await list(page).locator('[aria-expanded="true"]').count(), 0);
    assert.ok(await list(page).locator('[data-use-case-no]').count() >= 6, 'every use case of the run is listed');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const ODD_IDS = ['N01 U01', 'N01/U02', 'A&B=1', 'N01+U03', 'تقرير-٣'];
const ODD = {
  ...KNOWN,
  results: {
    ...REVIEW_RESULTS,
    domains: [{ domain_name: 'Customer', use_cases: ODD_IDS.map((id, i) => ({ ...REVIEW_RESULTS.domains[0].use_cases[0], No: id, Name: `Odd case ${i + 1}`,
      best_of_best: 'N', priority_score: String(4 - i * 0.5) })) }],
  },
};

test('quoted use case ids with spaces, a slash, an ampersand, a plus and non-Latin letters each open exactly their use case', async () => {
  for (const id of ODD_IDS) {
    const ui = await openUi('app', ODD, `&review=42&uc=${encodeURIComponent(id)}`, { mount });
    const { page } = ui;
    try {
      await openedCard(page, id);
      assert.equal(await list(page).locator('[aria-expanded="true"]').count(), 1, id);
      assert.equal(await note(page).count(), 0, id);
      assert.deepEqual(await address(page), ['?open=app', '#/review/42'], id);
      assert.deepEqual(ui.pageErrors, [], id);
    } finally {
      await ui.close();
    }
  }
});

test('a review link that arrives during the demo leaves the demo and opens the workspace run with a plain note', async () => {
  const ui = await openUi('app', KNOWN, '', {
    mount: (app) => {
      app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
      app.get('/api/showcase', (_req, res) => res.json({ showcases: [{ id: 'acme', session_id: '42', title: 'Acme retail', business: 'Acme', summary: 'Demo' }] }));
    },
  });
  const { page } = ui;
  try {
    await openShowcase(page);
    await page.getByRole('region', { name: 'Demo' }).getByText(SHOWCASE_NOTE).waitFor({ timeout: 20000 });
    await page.evaluate(() => { window.location.hash = '#/review/42/N01-U02'; });
    await page.locator('[data-review-left-demo]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-review-left-demo]').innerText(), REVIEW_LEFT_DEMO);
    assert.equal(await page.getByRole('region', { name: 'Demo' }).count(), 0, 'the link never opens inside the demo');
    await openedCard(page, 'N01-U02');
    await page.locator('header nav button', { hasText: 'Start' }).click();
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor({ timeout: 20000 });
    await page.locator('header nav button', { hasText: 'Review' }).click();
    await page.locator('[data-run-heading]').waitFor({ timeout: 20000 });
    await list(page).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-review-left-demo]').count(), 0, 'the note goes once the person moves on');
    assert.equal(await list(page).locator('[aria-expanded="true"]').count(), 0, 'and the link does not open again');
  } finally {
    await ui.close();
  }
});

const SETUP_FIRST = { isDatabricksApp: false, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1', inspireDatabase: 'main.inspire' };

test('a review link opened before Inspire is set up waits through setup and then opens its use case', async () => {
  const ui = await openUi('app', KNOWN, '&review=42&uc=N01-U02', {
    mount: (app) => {
      app.get('/api/defaults', (_req, res) => res.json(SETUP_FIRST));
      app.get('/api/showcase', (_req, res) => res.json({}));
    },
  });
  const { page } = ui;
  try {
    const skip = page.getByRole('button', { name: 'Skip setup' });
    await skip.waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-use-case-no]').count(), 0, 'setup comes first');
    assert.deepEqual(await address(page), ['?open=app', '#/review/42/N01-U02'], 'while setup shows, the link waits in the hash');
    await skip.click();
    await openedCard(page, 'N01-U02');
    assert.deepEqual(await address(page), ['?open=app', '#/review/42']);
  } finally {
    await ui.close();
  }
});
