import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { RESULTS } from './implementFixtures.js';

test.after(closeBrowser);

const MINUTE = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const EMPTY = ['airline.passenger.bookings', 'airline.passenger.flights'];
const NONE_MESSAGE = '0 of 6 use cases meet the High quality bar. Here is what we found, each marked with its reason. '
  + '2 tables have no rows yet: airline.passenger.bookings, airline.passenger.flights. Add sample rows on the Generate data page of the Inspire App, then run again';

const mark = (results, meets) => ({
  ...results,
  domains: results.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((u) => (meets(u)
    ? { ...u, meets_quality_bar: 'Y' }
    : { ...u, meets_quality_bar: 'N', elite_status: 'FALLBACK_BELOW_BAR', best_of_best: '', best_of_best_rank: '',
      fallback_reason: `its main table ${EMPTY[0]} has no rows yet; Relevance check` })) })),
});

const NONE_MEET = {
  ...mark(RESULTS, () => false),
  run_status: 'warning',
  run_message: 'Completed: 0 of 6 use cases meet the High quality bar; 2 tables have no rows yet: airline.passenger.bookings, airline.passenger.flights',
  quality_bar: { mode: 'High', found: 6, meets: 0, below: 6, empty_tables: EMPTY, message: NONE_MESSAGE },
  selection_outcome: { kind: 'tier', bar: 'High', count: 6, message: 'below the bar' },
  elite_outcome: { kind: 'near_miss' },
};

const MIXED = {
  ...mark(RESULTS, (u) => u.Quality === 'High'),
  run_status: 'success',
  quality_bar: { mode: 'High', found: 6, meets: 3, below: 3, empty_tables: [], message: '3 of 6 use cases meet the High quality bar' },
};

const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cards = (page) => list(page).locator('[aria-expanded]');

async function ready(page) {
  await list(page).waitFor();
  await cards(page).first().waitFor();
}

test('a run where nothing meets the bar still lists every use case found, each marked below the bar with its reason, under an amber card', async () => {
  const ui = await openUi('results', { results: NONE_MEET, useCases: [] });
  const { page } = ui;
  try {
    await ready(page);
    assert.equal(await cards(page).count(), 6);
    assert.equal(await list(page).locator('[data-testid="quality-bar-chip"][data-meets="no"]').count(), 6);
    assert.equal(await list(page).locator('[data-testid="quality-bar-chip"][data-meets="yes"]').count(), 0);
    assert.match(await list(page).locator('[data-testid="quality-bar-reason"]').first().innerText(),
      /^Why it is below your bar: its main table airline\.passenger\.bookings has no rows yet/);
    const done = page.locator('[data-testid="execution-complete"]');
    await done.waitFor();
    assert.equal(await done.getAttribute('data-status'), 'warning');
    assert.match(await done.innerText(), /Run finished, with a warning/);
    assert.equal(await page.locator('[data-testid="quality-bar-counts"]').innerText(), '0 of 6 use cases meet the quality bar');
    assert.match(await page.locator('[data-testid="execution-outcome"]').innerText(), /^0 of 6 use cases meet the High quality bar/);
    assert.equal(await page.locator('[data-testid="quality-bar-next-step"]').innerText(),
      'Next step: add rows to the 2 tables that have no rows yet (the Generate data page can add sample rows), then run again.');
    const tiles = await page.locator('[data-stat]').evaluateAll((els) => els.map((el) => el.dataset.stat));
    for (const shown of ['High Priority', 'Avg Inspire score', 'Best of Best']) assert.ok(tiles.includes(shown), `${shown} shows even when nothing meets the bar`);
    assert.equal((await page.locator('[data-stat="High Priority"] [data-stat-value]').innerText()).trim(), 'n/a', 'High Priority claims no count when nothing meets the bar');
    assert.doesNotMatch(await page.locator('body').innerText(), /\[object Object\]/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an object selection outcome never renders as [object Object]', async () => {
  const { quality_bar: _bar, run_message: _msg, ...noBar } = NONE_MEET;
  const ui = await openUi('results', { results: { ...noBar, run_status: 'success' }, useCases: [] });
  const { page } = ui;
  try {
    await ready(page);
    const outcome = page.locator('[data-testid="execution-outcome"]');
    await outcome.waitFor();
    assert.equal(await outcome.innerText(), 'below the bar');
    assert.doesNotMatch(await page.locator('body').innerText(), /\[object Object\]/);
  } finally {
    await ui.close();
  }
});

test('in a mixed run the use cases that meet the bar come first with the chip, and the filter narrows to either side', async () => {
  const ui = await openUi('results', { results: MIXED, useCases: [] });
  const { page } = ui;
  try {
    await ready(page);
    const chips = await cards(page).evaluateAll((els) => els.map((el) => el.querySelector('[data-testid="quality-bar-chip"]')?.dataset.meets || ''));
    assert.deepEqual(chips, ['yes', 'yes', 'yes', 'no', 'no', 'no']);
    assert.match(await cards(page).first().innerText(), /Meets your quality bar/i);
    assert.equal(await page.locator('[data-testid="execution-complete"]').getAttribute('data-status'), 'success');
    assert.equal(await page.locator('[data-testid="quality-bar-counts"]').innerText(), '3 of 6 use cases meet the quality bar');
    assert.deepEqual(await page.locator('select[aria-label="Quality bar"] option').allTextContents(),
      ['Quality bar: Any (6)', 'Meets the quality bar (3)', 'Below the quality bar (3)'], 'the filter labels use the same wording as the count');
    assert.equal(await page.locator('[data-testid="quality-bar-next-step"]').count(), 0);
    const tiles = await page.locator('[data-stat]').evaluateAll((els) => els.map((el) => el.dataset.stat));
    assert.ok(tiles.includes('High Priority') && tiles.includes('Avg Inspire score'), tiles.join(', '));
    assert.match(await page.locator('[data-stat="High Priority"] [data-stat-value]').innerText(), /^\d+$/, 'with some meeting the bar the tile shows its count');
    const filter = page.locator('[data-testid="quality-bar-filter"]');
    await filter.selectOption('below');
    assert.equal(await cards(page).count(), 3);
    assert.equal(await list(page).locator('[data-testid="quality-bar-chip"][data-meets="yes"]').count(), 0);
    await filter.selectOption('meets');
    assert.equal(await cards(page).count(), 3);
    assert.equal(await list(page).locator('[data-testid="quality-bar-chip"][data-meets="no"]').count(), 0);
    await filter.selectOption('all');
    assert.equal(await cards(page).count(), 6);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a run with no quality-bar data shows no chip and no quality-bar filter', async () => {
  const ui = await openUi('results', { results: RESULTS, useCases: [] });
  const { page } = ui;
  try {
    await ready(page);
    assert.equal(await page.locator('[data-testid="quality-bar-filter"]').count(), 0);
    assert.equal(await list(page).locator('[data-testid="quality-bar-chip"]').count(), 0);
  } finally {
    await ui.close();
  }
});

function monitorBackend(results) {
  return (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: {
      session_id: '42', business_name: 'airlines', create_at: ago(90 * MINUTE), processing_status: 'done', completed_percent: 100,
      completed_on: ago(MINUTE), last_updated: ago(MINUTE), results_json: results,
    } }));
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
  };
}

test('the Monitor shows an amber Completed with a warning when no use case meets the bar, with the counts and the empty tables', async () => {
  const ui = await openUi('monitor', { results: NONE_MEET, useCases: [] }, '&run=none', { mount: monitorBackend(NONE_MEET) });
  const { page } = ui;
  try {
    const card = page.locator('[data-testid="monitor-status"]');
    await card.getByText('Completed with a warning', { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await card.getAttribute('data-status'), 'warning');
    assert.match(await card.getAttribute('class'), /bg-warning-bg/);
    assert.doesNotMatch(await card.getAttribute('class'), /bg-success-bg/);
    assert.match(await card.innerText(), /Completed: 0 of 6 use cases meet the High quality bar/);
    assert.equal(await card.locator('[data-testid="monitor-bar-counts"]').innerText(), '0 of 6 use cases meet the quality bar');
    assert.match(await card.locator('[data-testid="monitor-empty-tables"]').innerText(),
      /^These tables have no rows yet: airline\.passenger\.bookings, airline\.passenger\.flights\. Add sample rows on the Generate data page, then run again\.$/);
    assert.equal(await card.getByText('Inspire finished this run.', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Run completed', { exact: true }).count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /\[object Object\]/);
  } finally {
    await ui.close();
  }
});

test('the Monitor warns, never fails, when every table the run read is empty, and says no use case can be grounded in rows', async () => {
  const allEmpty = { ...NONE_MEET, quality_bar: { ...NONE_MEET.quality_bar, all_tables_empty: true } };
  const ui = await openUi('monitor', { results: allEmpty, useCases: [] }, '&run=none', { mount: monitorBackend(allEmpty) });
  const { page } = ui;
  try {
    const card = page.locator('[data-testid="monitor-status"]');
    await card.getByText('Completed with a warning', { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await card.getAttribute('data-status'), 'warning', 'an all-empty run is a warning (must-exclude: never failed)');
    assert.match(await card.locator('[data-testid="monitor-empty-tables"]').innerText(),
      /^Every table you picked is empty, so no use case can be grounded in rows: airline\.passenger\.bookings, airline\.passenger\.flights\. Add sample rows on the Generate data page, then run again\.$/);
  } finally {
    await ui.close();
  }
});

test('the Monitor stays green when the bar is met, and still shows how many were found and met it', async () => {
  const ui = await openUi('monitor', { results: MIXED, useCases: [] }, '&run=none', { mount: monitorBackend(MIXED) });
  const { page } = ui;
  try {
    const card = page.locator('[data-testid="monitor-status"]');
    await card.getByText('Completed', { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await card.getAttribute('data-status'), 'success');
    assert.equal(await card.locator('[data-testid="monitor-bar-counts"]').innerText(), '3 of 6 use cases meet the quality bar');
    assert.equal(await card.locator('[data-testid="monitor-empty-tables"]').count(), 0);
  } finally {
    await ui.close();
  }
});
