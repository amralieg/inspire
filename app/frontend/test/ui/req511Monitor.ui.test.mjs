// REQ-511 Monitor C ("Use cases first", Amr 00:15Z) and REQ-512 full width (Amr 00:20Z). Spec: ~/claude/inspire/briefs/req511_spec.md section 3.
// Wireframe: ~/claude/inspire/wireframes/req511_monitor_C.html. Contract the builder implements (behaviour, not pixels):
// - Hero: [data-monitor-hero] with data-state running|done|failed|offline. It holds the page h1, the 7-phase stepper
//   ([data-run-stepper], 8 steps in 7 columns from src/lib/runPhases.js), the screen's More menu and at most one primary button:
//   none while running, "Open in Review" when done, "Run again" when failed, "Check again" when the checks stopped.
// - More (REQ-510 L1 MoreMenu): "Stop this run" while running (opens the existing Stop the run / Keep it running confirm), and "Run log".
// - Region "Arriving now": live use cases as cards [data-live-use-case] in a grid of 2+ columns, domain chips [data-domain-chip]
//   (aria-pressed) that filter the cards, and the live-use-case-count line. Region "What Inspire is doing" sits to its right.
// - "Every step" button opens a dialog named "Every step" with a search box and a status filter (the old Detailed Steps log).
// - Full width: no 1200px cap; at 1440 the hero and the Arriving now region use the page width.
// Fail-pre (lane/spec511 ef3e6588e): no [data-monitor-hero], Stop is a standalone button, no "Arriving now" region, no "Every step".
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { screenFacts, describe, itemsOf, reachable, shownOutsideMenus } from './req510Declutter.mjs';

test.after(closeBrowser);

const MINUTE = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
let n = 0;
const step = (stage, status, extra = {}) => ({ step_id: String(++n), session_id: '42', stage_name: stage, step_name: `${stage} step`, sub_step_name: '',
  status, message: `${stage} message`, progress_increment: 5, last_updated: ago((60 - n) * MINUTE), result_json: {}, ...extra });
const LIVE = { life_cycle_state: 'RUNNING', start_time: Date.now() - 30 * MINUTE, tasks: [] };
const ENDED = { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS', start_time: Date.now() - 60 * MINUTE, end_time: Date.now() - MINUTE, tasks: [] };
const FAILED = { life_cycle_state: 'TERMINATED', result_state: 'FAILED', state_message: 'Workload failed', start_time: Date.now() - 60 * MINUTE,
  end_time: Date.now() - MINUTE, tasks: [] };

const USE_CASES = [
  { id: 'N01-U01', name: 'Predict customer churn', business_domain: 'Customer', priority: 'High' },
  { id: 'N01-U02', name: 'Score upsell offers', business_domain: 'Customer', priority: 'Medium' },
  { id: 'N01-U03', name: 'Segment shoppers', business_domain: 'Customer', priority: 'Medium' },
  { id: 'N02-U01', name: 'Forecast store stock', business_domain: 'Supply chain', priority: 'High' },
  { id: 'N02-U02', name: 'Spot late suppliers', business_domain: 'Supply chain', priority: 'Low' },
];
const liveSteps = () => [step('Setup', 'ended_success'), step('Business Understanding', 'ended_success'), step('Data Preparation', 'ended_success'),
  step('Use Case Generation', 'started', { result_json: { use_cases: USE_CASES } })];
const doneSteps = () => [step('Setup', 'ended_success'), step('Business Understanding', 'ended_success'), step('Data Preparation', 'ended_success'),
  step('Use Case Generation', 'ended_success', { result_json: { use_cases: USE_CASES } }), step('Domain Clustering', 'ended_success'),
  step('Prioritization', 'ended_success'), step('Implementation', 'ended_success'), step('Executive Readout', 'ended_success')];

function monitorBackend(steps, run, { runStatus = 200 } = {}) {
  return (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: ago(60 * MINUTE),
      completed_percent: run === LIVE ? 50 : 100, completed_on: run === LIVE ? null : ago(MINUTE), last_updated: ago(MINUTE),
      processing_status: run === LIVE ? 'processing' : 'done' } }));
    app.get('/api/inspire/steps', (req, res) => res.json({ steps: req.query.since ? [] : steps }));
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
    app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
    app.get('/api/run/777', (_req, res) => (runStatus === 200
      ? res.json({ run_id: 777, run_name: 'Inspire Discover', run_page_url: 'https://workspace.example.com/#job/1/run/777', ...run })
      : res.status(runStatus).json({ error: 'TEMPORARILY_UNAVAILABLE: The service is temporarily unavailable' })));
  };
}

const hero = (page) => page.locator('[data-monitor-hero]').first();
async function openMonitor(steps, run, opts) {
  const ui = await openUi('monitor', {}, '', { mount: monitorBackend(steps, run, opts) });
  await ui.page.setViewportSize({ width: 1440, height: 900 });
  return ui;
}
async function heroIn(page, state) {
  await page.locator(`[data-monitor-hero][data-state="${state}"]`).first().waitFor({ timeout: 25000 });
}
const arriving = (page) => page.getByRole('region', { name: 'Arriving now', exact: true });

test('Monitor C running: the hero holds the h1, the 7-phase stepper and More, and shows no primary button', async () => {
  const ui = await openMonitor(liveSteps(), LIVE);
  const { page } = ui;
  try {
    await heroIn(page, 'running');
    assert.equal(await hero(page).locator('h1').count(), 1, 'the page h1 sits in the hero');
    const stepper = hero(page).locator('[data-run-stepper]');
    assert.equal(await stepper.count(), 1, 'the run stepper sits inside the hero');
    assert.equal(await stepper.locator('[data-run-step]').count(), 8, '8 phase keys from runPhases.js');
    assert.equal(await stepper.locator('[data-run-step-column]').count(), 7, '7 columns, the parallel pair shares column 7');
    assert.equal(await stepper.locator('[data-run-step="generation"]').getAttribute('data-state'), 'active');
    assert.equal(await hero(page).getByRole('progressbar').count(), 1, 'one progress bar in the hero');
    const facts = await screenFacts(page);
    assert.equal(facts.primaries.length, 0, `no primary while running: ${describe(facts)}`);
    assert.equal(facts.moreCount, 1, `one More menu on the screen: ${describe(facts)}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Monitor C running: Stop this run and Run log live in More; Stop still asks before it stops', async () => {
  const ui = await openMonitor(liveSteps(), LIVE);
  const { page } = ui;
  try {
    await heroIn(page, 'running');
    assert.equal(await shownOutsideMenus(page.getByRole('button', { name: 'Stop this run' })), 0, 'Stop is not a standalone button');
    assert.equal(await shownOutsideMenus(page.getByRole('button', { name: /^Show the run log$/ })), 0, 'the run log toggle is not a standalone button');
    const items = await itemsOf(page, hero(page));
    assert.ok(items, 'the hero has a More menu');
    assert.ok(items.includes('Stop this run'), `More holds Stop this run: [${items}]`);
    assert.ok(items.some((t) => /^Run log$/.test(t)), `More holds Run log: [${items}]`);
    await hero(page).getByRole('button', { name: /^More$/ }).click();
    await page.getByRole('menuitem', { name: 'Stop this run' }).click();
    await page.getByRole('button', { name: 'Stop the run' }).waitFor({ timeout: 5000 });
    assert.equal(await page.getByRole('button', { name: 'Keep it running' }).count(), 1, 'the confirm keeps its way out');
    await page.getByRole('button', { name: 'Keep it running' }).click();
    await hero(page).getByRole('button', { name: /^More$/ }).click();
    await page.getByRole('menuitem', { name: 'Run log' }).click();
    await page.locator('pre[aria-label="Run log"]').waitFor({ timeout: 10000 });
  } finally {
    await ui.close();
  }
});

test('Monitor C running: Arriving now shows live use cases in a grid of 2+ columns, with domain chips that filter them', async () => {
  const ui = await openMonitor(liveSteps(), LIVE);
  const { page } = ui;
  try {
    await heroIn(page, 'running');
    const region = arriving(page);
    await region.waitFor({ timeout: 15000 });
    const cards = region.locator('[data-live-use-case]');
    assert.equal(await cards.count(), 5, 'every live use case is a card');
    const columns = await cards.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
    assert.ok(columns >= 2, `cards sit in a grid of 2+ columns, got ${columns}`);
    assert.match(await region.getByTestId('live-use-case-count').innerText(), /5 use cases so far/);
    const chips = region.locator('[data-domain-chip]');
    assert.ok((await chips.count()) >= 2, 'one chip per domain');
    const supply = chips.filter({ hasText: /Supply chain/ }).first();
    await supply.click();
    assert.equal(await supply.getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => document.querySelectorAll('[data-live-use-case]').length === 2, null, { timeout: 5000 });
    const feed = page.getByRole('region', { name: 'What Inspire is doing', exact: true });
    assert.equal(await feed.count(), 1, 'the side feed is a named region');
    const [a, f] = [await region.boundingBox(), await feed.boundingBox()];
    assert.ok(a && f && f.x >= a.x + a.width - 4, 'the feed sits to the right of Arriving now');
  } finally {
    await ui.close();
  }
});

test('Monitor C: full width at 1440, no 1200px cap on the hero or Arriving now', async () => {
  const ui = await openMonitor(liveSteps(), LIVE);
  const { page } = ui;
  try {
    await heroIn(page, 'running');
    const widths = await page.evaluate(() => {
      const caps = [];
      for (let el = document.querySelector('[data-monitor-hero]'); el && el !== document.body; el = el.parentElement) {
        const mw = getComputedStyle(el).maxWidth;
        if (mw !== 'none' && parseFloat(mw) < 1300) caps.push(`${el.tagName.toLowerCase()} max-width ${mw}`);
      }
      return { hero: document.querySelector('[data-monitor-hero]').getBoundingClientRect().width, caps };
    });
    assert.deepEqual(widths.caps, [], 'no ancestor of the hero caps the page width');
    assert.ok(widths.hero >= 1240, `the hero uses the page width at 1440, got ${widths.hero}`);
    const box = await arriving(page).boundingBox();
    const feed = await page.getByRole('region', { name: 'What Inspire is doing', exact: true }).boundingBox();
    assert.ok(box && feed && feed.x + feed.width - box.x >= 1240, 'Arriving now plus the feed span the page width');
  } finally {
    await ui.close();
  }
});

test('Monitor C done: one primary, Open in Review, in the hero; More keeps Run log and loses Stop; the cards stay', async () => {
  const ui = await openMonitor(doneSteps(), ENDED);
  const { page } = ui;
  try {
    await heroIn(page, 'done');
    const facts = await screenFacts(page);
    assert.deepEqual(facts.primaries, ['Open in Review'], `one primary when done: ${describe(facts)}`);
    assert.equal(await hero(page).getByRole('button', { name: 'Open in Review' }).count(), 1, 'the primary sits in the hero');
    const items = await itemsOf(page, hero(page));
    assert.ok(items && items.some((t) => /^Run log$/.test(t)), `More holds Run log: [${items}]`);
    assert.ok(!items.includes('Stop this run'), 'no Stop once the run ended');
    assert.equal(await arriving(page).locator('[data-live-use-case]').count(), 5, 'the use cases stay on screen when done');
    assert.equal(await hero(page).locator('[data-run-step][data-state="done"]').count(), 8);
  } finally {
    await ui.close();
  }
});

test('Monitor C failed: the hero says failed and its one primary is Run again', async () => {
  const ui = await openMonitor(liveSteps(), FAILED);
  const { page } = ui;
  try {
    await heroIn(page, 'failed');
    const facts = await screenFacts(page);
    assert.deepEqual(facts.primaries, ['Run again'], `one primary when failed: ${describe(facts)}`);
    assert.equal(await hero(page).getByRole('button', { name: 'Run again' }).count(), 1, 'Run again sits in the hero');
    assert.equal(await hero(page).locator('[data-run-step][data-state="error"]').count(), 1, 'the failed phase is marked error');
    assert.equal(await arriving(page).locator('[data-live-use-case]').count(), 5, 'what was written before the failure stays on screen');
  } finally {
    await ui.close();
  }
});

test('Monitor C offline: when Databricks does not answer, the hero says so (data-state offline), never a silent spinner', async () => {
  const ui = await openMonitor(liveSteps(), LIVE, { runStatus: 503 });
  const { page } = ui;
  try {
    await heroIn(page, 'offline');
    assert.match(await hero(page).innerText(), /temporarily unavailable|connection|checking again|not answering/i, 'the hero names the problem');
  } finally {
    await ui.close();
  }
});

test('Monitor C: Every step opens a sheet with search and a status filter, in place of the Detailed Steps log', async () => {
  const ui = await openMonitor(liveSteps(), LIVE);
  const { page } = ui;
  try {
    await heroIn(page, 'running');
    await page.getByRole('button', { name: /^Every step/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Every step' });
    await sheet.waitFor({ timeout: 5000 });
    assert.equal(await sheet.getByRole('searchbox').count() + await sheet.getByRole('textbox', { name: /search/i }).count() > 0, true, 'search box');
    assert.ok((await sheet.getByRole('combobox').count()) + (await sheet.getByRole('radiogroup').count()) > 0, 'a status filter');
    assert.match(await sheet.innerText(), /Use Case Generation|Write use cases/);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden', timeout: 5000 });
  } finally {
    await ui.close();
  }
});

// NoFunctionLost (req509 coverage, monitor index F065, F171-F196, F451-F453): every Monitor function the C layout moves stays one click away.
const RUNNING_CHECKLIST = [
  ['F185 F193 Stop this run', { role: 'menuitem', name: 'Stop this run' }, 'more'],
  ['F190 Run log', { role: 'menuitem', name: /^Run log$/ }, 'more'],
  ['F186 Stage durations', { role: 'menuitem', name: 'Stage durations' }, 'more'],
  ['F187 Notebook output', { role: 'menuitem', name: 'Notebook output' }, 'more'],
  ['F171 Every step', { role: 'button', name: /^Every step/ }, 'main'],
  ['F194 Jump to latest', { role: 'button', name: 'Jump to latest' }, 'main'],
];
const DONE_CHECKLIST = [
  ['F183 Open in Review', { role: 'button', name: 'Open in Review' }, 'main'],
  ['F189 Start a new run', { role: 'menuitem', name: 'Start a new run' }, 'more'],
  ['F190 Run log', { role: 'menuitem', name: /^Run log$/ }, 'more'],
  ['F186 Stage durations', { role: 'menuitem', name: 'Stage durations' }, 'more'],
  ['F171 Every step', { role: 'button', name: /^Every step/ }, 'main'],
];

test('Monitor C NoFunctionLost: every Monitor function stays reachable while running and when done', async () => {
  for (const [steps, run, state, list] of [[liveSteps(), LIVE, 'running', RUNNING_CHECKLIST], [doneSteps(), ENDED, 'done', DONE_CHECKLIST]]) {
    const ui = await openMonitor(steps, run);
    try {
      await heroIn(ui.page, state);
      const lost = [];
      for (const row of list) { const miss = await reachable(ui.page, row); if (miss) lost.push(miss); }
      assert.deepEqual(lost, [], `${state}: functions lost`);
    } finally {
      await ui.close();
    }
  }
});
