// REQ-444 (FX-35): Review navigation, run list and selection. D10 view switch scrolls to top; D11 step chips never cut off;
// D14 Latest Run badge on the newest run; D15 list newest first with the Start count; D17 selection resets when the run changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toView } from './uiSupport.mjs';
import { REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cards = (page) => list(page).locator('[data-use-case-row]');
const heading = (page) => page.locator('[data-run-heading]');
const poll = async (check, what, timeout = 10000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

async function open(state = REVIEW_STATE, extra = {}) {
  const ui = await openUi('results', state, '', extra);
  await cards(ui.page).first().waitFor();
  return ui;
}

test('D10: a view switch from a scrolled Use cases view lands at the top of Business', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.evaluate(() => window.scrollTo(0, 400));
    await poll(async () => (await page.evaluate(() => window.scrollY)) > 100, 'the Use cases view scrolled down');
    await toView(page, 'Business');
    await page.locator('[data-executive-summary]').waitFor();
    await poll(async () => (await page.evaluate(() => window.scrollY)) <= 10, 'scrollY is at most 10 after the switch');
    assert.ok((await page.evaluate(() => window.scrollY)) <= 10);
    // Back keeps working: the view before returns.
    await page.goBack();
    await cards(page).first().waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('D11: on Assets the last step chip of "Run finished" is fully visible (or a scroll hint exists) at 1280 and 390, left to right and right to left', async () => {
  for (const width of [1280, 390]) {
    for (const dir of ['ltr', 'rtl']) {
      const ui = await open();
      const { page } = ui;
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((d) => { document.documentElement.dir = d; }, dir);
        await toView(page, 'Assets');
        const last = page.locator('[data-testid="execution-complete"]').locator('xpath=ancestor::div[contains(@class,"shadow-elevated")]').getByText('Executive Readout', { exact: true });
        await last.waitFor();
        const label = `${width}px ${dir}`;
        const seen = await last.evaluate((el) => {
          const row = el.closest('.border-t');
          const box = el.getBoundingClientRect();
          const cut = row.getBoundingClientRect();
          return {
            inside: box.left >= Math.max(0, cut.left) - 1 && box.right <= Math.min(window.innerWidth, cut.right) + 1,
            hint: Boolean(row.parentElement.querySelector('[data-scroll-hint]')) || row.scrollWidth <= row.clientWidth + 1,
          };
        });
        assert.ok(seen.inside || seen.hint, `${label}: the last chip is cut off with no hint`);
        assert.deepEqual(ui.pageErrors, [], label);
      } finally {
        await ui.close();
      }
    }
  }
});

const full = (sid, business, finished, [runs, rank], extra = {}) => ({
  session_id: sid, completed_percent: 100, business_name: business, widget_values: { business }, create_at: finished,
  last_updated: finished, completed_on: finished, business_runs: runs, business_rank: rank, ...extra,
});
// The order the server lists them (by creation), mixed on purpose; the newest finished run is W11, not W1.
const MIXED = [
  full('42', 'W1 Bakehouse Walk', '2026-11-19T17:09:00Z', [3, 3]),
  full('102', 'W1 Bakehouse Walk', '2026-11-19T09:44:00Z', [3, 3]),
  full('103', 'W1 Bakehouse Walk', '2026-11-21T03:00:00Z', [3, 1]),
  full('104', 'W11 rc2g Walk', '2026-11-21T14:31:00Z', [1, 1]),
  full('105', 'W10 Walk', '2026-11-21T03:25:00Z', [1, 1]),
  full('106', 'W5 Walk', '2026-11-19T09:35:00Z', [1, 1]),
];
const asRuns = async (page) => {
  await heading(page).getByRole('button', { name: 'Change run' }).click();
  const runs = page.getByRole('group', { name: 'Runs' });
  await runs.locator('[data-run="104"]').waitFor();
  return runs;
};

test('D14 and D15: Change run lists the runs newest first and the Latest Run badge sits on the newest run', async () => {
  const ui = await open({ ...REVIEW_STATE, sessions: MIXED });
  const { page } = ui;
  try {
    const runs = await asRuns(page);
    const order = await runs.locator('[data-run]').evaluateAll((els) => els.map((el) => el.getAttribute('data-run')));
    assert.deepEqual(order, ['104', '105', '103', '42', '102', '106'], 'newest finished first');
    const badged = await runs.locator('[data-run]').evaluateAll((els) => els.filter((el) => el.querySelector('[data-latest-run]')).map((el) => el.getAttribute('data-run')));
    assert.deepEqual(badged, ['104'], 'the badge is on the newest run only');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('D15: the Change run header count is the Start count for the same runs, past the first 20', async () => {
  const many = Array.from({ length: 25 }, (_v, i) => full(String(i === 0 ? 42 : 200 + i), `Biz ${i}`, `2026-11-${String(1 + i).padStart(2, '0')}T10:00:00Z`, [1, 1]));
  const mount = (app) => app.get('/api/inspire/sessions', (req, res) => res.json({ sessions: req.query.all === '1' ? many : many.slice(0, 20), truncated: false }));
  const state = { ...REVIEW_STATE, sessions: many };
  const start = await openUi('choose', state, '', { mount });
  let startCount;
  try {
    await start.page.getByText(/\d+ completed/).first().waitFor();
    startCount = Number(/(\d+) completed/.exec(await start.page.locator('body').innerText())[1]);
  } finally {
    await start.close();
  }
  assert.equal(startCount, 25);
  const ui = await open(state, { mount });
  const { page } = ui;
  try {
    await heading(page).getByRole('button', { name: 'Change run' }).click();
    const runs = page.getByRole('group', { name: 'Runs' });
    await runs.getByRole('heading').waitFor();
    const shown = Number(/\((\d+)\)/.exec(await runs.getByRole('heading').innerText())[1]);
    assert.equal(shown, startCount, 'the header counts the same runs Start counts');
    assert.equal(await runs.locator('[data-run]').count(), startCount);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('D17: select 3 cards in one run, switch to another run: nothing is selected and no bulk action is offered', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    for (const n of ['Predict churn', 'Score upsell', 'Segment shoppers']) await page.getByRole('checkbox', { name: `Select ${n}`, exact: true }).check();
    await page.getByRole('button', { name: 'Calculate value for 3', exact: true }).waitFor();
    await heading(page).getByRole('button', { name: 'Change run' }).click();
    const runs = page.getByRole('group', { name: 'Runs' });
    await runs.locator('[data-run="41"]').click();
    await heading(page).getByText(/Completed Oct 29/).waitFor();
    await cards(page).first().waitFor();
    assert.equal(await page.locator('input[type="checkbox"]:checked').count(), 0, 'no card is ticked');
    assert.equal(await page.getByRole('button', { name: /^Calculate value for/ }).count(), 0, 'no bulk action is offered');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
