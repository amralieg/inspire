import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, lowContrast, openUi, setDark, settled, steadyBox, toView, until } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE, RUN_SUMMARY } from './reviewFixtures.js';
import { LATEST_RUN_LABEL } from '../../src/lib/reviewFigures.js';
import * as V from '../../src/lib/v130UseCase.js';
import * as A from '../../src/lib/artifactFiles.js';
import { START_MVP_LABEL } from '../../src/lib/implementWizard.js';
import { panelSettled, readerOf } from './reviewRows.mjs';


test.after(closeBrowser);

const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cards = (page) => list(page).locator('[data-use-case-row]');
const card = (page, name) => cards(page).filter({ hasText: name });
const portfolio = (page) => page.getByRole('region', { name: 'Across all runs' });
const insight = (page, title) => page.locator(`[data-insight="${title}"]`);
const heading = (page) => page.locator('[data-run-heading]');

async function ready(page) {
  await list(page).waitFor();
  await cards(page).first().waitFor();
}

function outsideHosts(page) {
  const sent = [];
  page.on('request', (r) => {
    const url = r.url();
    if (/^(data|blob):/.test(url)) return;
    if (!/^https?:\/\/127\.0\.0\.1:\d+\//.test(url)) sent.push(url);
  });
  return sent;
}

test('Review lists the documents of an absolute output folder, and never asks for a relative or .. folder when the agent notebook path is unknown (must-exclude)', async () => {
  const listed = async (generationPath) => {
    const sessions = REVIEW_SESSIONS.map((s) => (s.session_id === '42' ? { ...s, generation_path: generationPath } : s));
    const ui = await openUi('results', { ...REVIEW_STATE, sessions }, '', { mount: (app) => app.post('/api/inspire/docs/save', (req, res) => res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 })) });
    const asked = [];
    ui.page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/api/workspace/list') asked.push(u.searchParams.get('path'));
    });
    try {
      await ready(ui.page);
      await toView(ui.page, 'Overview');
      await settled(ui.page, '[aria-label="Figures of this run"]');
      await idle(ui.page);
      assert.deepEqual(ui.pageErrors, []);
      return [...new Set(asked)]; // the strategy PDF save reloads the folder once
    } finally {
      await ui.close();
    }
  };
  assert.deepEqual(await listed('/Workspace/Users/a@example.com/out/'), ['/Workspace/Users/a@example.com/out/acme', '/Users/a@example.com/out/acme'],
    'an absolute output folder is listed in both workspace forms, so the harness does load documents');
  const relative = await listed('./../demos/');
  assert.deepEqual(relative.filter((p) => !p.startsWith('/') || p.split('/').some((seg) => seg === '.' || seg === '..')), [], relative.join(', '));
});

test('on a small screen the figures of the run below the fold already read their numbers before anyone scrolls to them', async () => {
  const ui = await openUi('results', REVIEW_STATE, '', { init: (page) => page.setViewportSize({ width: 390, height: 260 }) });
  const { page } = ui;
  try {
    await ready(page);
    await toView(page, 'Overview');
    const tile = (label) => page.locator(`[aria-label="Figures of this run"] [data-stat="${label}"]`);
    const below = await tile('Live assets').evaluate((el) => el.getBoundingClientRect().top >= window.innerHeight);
    assert.equal(below, true, 'the last figure starts below the fold, so the check covers a tile nobody has scrolled to');
    await settled(page, '[aria-label="Figures of this run"]');
    await idle(page);
    const read = async (label) => (await tile(label).locator('[data-stat-value]').innerText()).trim();
    assert.equal(await read('Best of Best'), '2');
    assert.equal(await read('Subdomains'), '5');
    assert.equal(await read('Live assets'), '4');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Review heads the open run with its catalog, business and date, shows each figure of this run once, and no totals across runs', async () => {
  const ui = await openUi('results', REVIEW_STATE);
  const { page } = ui;
  const outside = outsideHosts(page);
  try {
    await ready(page);
    await toView(page, 'Overview');
    assert.equal((await page.locator('h1').innerText()).trim(), 'Review', 'the page title is the tab');
    const head = heading(page);
    assert.equal(await head.getByRole('heading', { level: 2 }).innerText(), 'Acme Use Cases Catalog', 'a run with no catalog title reads Use Cases');
    assert.equal(await head.locator('[data-run-business]').innerText(), 'Acme');
    assert.match(await head.innerText(), /^This run\n/i);
    assert.match(await head.innerText(), /Completed Oct 31, 2026/);
    assert.equal(await head.locator('[data-latest-run]').innerText(), LATEST_RUN_LABEL);
    assert.equal(await head.getByRole('button', { name: 'Change run' }).count(), 1, 'Change run sits with the run it changes');

    const stat = (label, want) => page.waitForFunction(([l, w]) => {
      const el = document.querySelector(`[aria-label="Figures of this run"] [data-stat="${l}"] [data-stat-value]`);
      return el && el.textContent.trim() === w;
    }, [label, want], { timeout: 5000 });
    await stat('Best of Best', '2');
    await stat('Live assets', '4');
    await stat('Subdomains', '5');
    assert.equal(await page.locator('[data-portfolio], [data-portfolio-card]').count(), 0, 'with the portfolio read, Review still shows no totals across runs');
    assert.equal(await portfolio(page).count(), 0);
    assert.equal(await page.getByText('Totals in this Inspire Database').count(), 0);
    const runScope = await page.evaluate(() => {
      const words = ['Use Cases', 'Domains', 'High Priority'];
      const seen = Object.fromEntries(words.map((w) => [w, 0]));
      for (const el of document.querySelectorAll('main *, body *')) {
        if (el.closest('[data-browse]') || el.closest('[data-run-heading]')) continue;
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ');
        if (words.includes(own)) seen[own] += 1;
      }
      return seen;
    });
    assert.deepEqual(runScope, { 'Use Cases': 1, Domains: 1, 'High Priority': 1 },
      'above the use case browser, the Run finished strip no longer repeats the run cards');
    await toView(page, 'Overview');
    assert.equal(await page.getByText('Every step of the run finished.').count(), 1);
    const summary = page.locator('[data-executive-summary]');
    assert.deepEqual(await summary.locator('p').allInnerTexts(), RUN_SUMMARY.paragraphs, 'the summary results_json holds, in its paragraphs');
    assert.equal(await page.locator('canvas').count(), 0, 'opening a finished run fires no confetti');
    assert.deepEqual(outside, [], 'Review loads nothing from an outside host');

    await head.getByRole('button', { name: 'Change run' }).click();
    const runs = page.getByRole('group', { name: 'Runs' });
    await runs.locator('[data-run="42"]').waitFor();
    assert.equal((await runs.getByRole('heading').innerText()).trim().toLowerCase(), 'runs (6)');
    const row = (sid) => runs.locator(`[data-run="${sid}"]`);
    const badges = {};
    for (const sid of ['42', '41', '50', '51', '60', '61']) badges[sid] = await row(sid).locator('[data-latest-run]').count();
    assert.deepEqual(badges, { 42: 1, 41: 0, 50: 0, 51: 0, 60: 0, 61: 0 },
      'only a business with two runs gets the label, on its newest; one run and unnamed runs get none');
    assert.equal(await row('42').locator('[data-run-figures]').innerText(), '6 use cases · 2 domains · 5 subdomains · 2 Best of Best · 1 MVP, 1 live · 4 live assets');
    assert.equal(await row('51').locator('[data-run-figures]').innerText(), '3 use cases · 1 domain', 'a run the portfolio does not list falls back to its overview');
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const measured = await lowContrast(page, ['[aria-label="Runs"]']);
      assert.ok(measured.checked >= 18, `${dark ? 'dark' : 'light'}: measured ${measured.checked}`);
      assert.deepEqual(measured.low, [], `${dark ? 'dark' : 'light'} run list`);
    }
    await row('41').click();
    await toView(page, 'Use cases');
    await ready(page);
    await toView(page, 'Overview');
    assert.equal(await heading(page).locator('[data-latest-run]').count(), 0, 'an older run of a business has no label');
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const measured = await lowContrast(page, ['[data-run-heading]', '[data-executive-summary]']);
      assert.ok(measured.checked >= 6, `${dark ? 'dark' : 'light'}: measured ${measured.checked}`);
      assert.deepEqual(measured.low, [], `${dark ? 'dark' : 'light'} run heading and summary`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a run whose results_json holds no summary string shows no summary panel', async () => {
  const { executive_summary: _gone, ...bare } = REVIEW_RESULTS;
  for (const [label, summary] of [['none', undefined], ['empty', ''], ['an object', { markdown: 'Written by no agent' }], ['a list', ['Written by no agent']]]) {
    const ui = await openUi('results', { ...REVIEW_STATE, results: { ...bare, domains_summary: '', ...(summary === undefined ? {} : { executive_summary: summary }) } });
    const { page } = ui;
    try {
      await ready(page);
      await toView(page, 'Overview');
      await page.locator('[data-stat="Use Cases"]').waitFor();
      assert.equal(await page.locator('#executive-summary').count(), 0, label);
      assert.equal(await page.getByText('Executive summary', { exact: true }).count(), 0, label);
      assert.deepEqual(ui.pageErrors, [], label);
    } finally {
      await ui.close();
    }
  }
});

const progressive = (extra = {}) => ({
  title: 'Use Cases Catalog (In Progress)', domains_summary: '', table_registry: {}, column_registry: {},
  domains: REVIEW_RESULTS.domains, _progressive: true, _use_case_count: 6, _step_count: 9, ...extra,
});

test('a run that is still going shows the summary its results_json already holds, and none when it holds none', async () => {
  for (const [label, stepResults, shown] of [
    ['written', progressive({ executive_summary: RUN_SUMMARY.results_json.executive_summary }), RUN_SUMMARY.paragraphs],
    ['not yet', progressive({ executive_summary: '' }), []],
  ]) {
    const ui = await openUi('results', { ...REVIEW_STATE, results: null, stepResults });
    const { page } = ui;
    try {
      await ready(page);
      await page.getByText('Live Preview').waitFor();
      assert.match(await page.locator('[data-testid="live-use-case-count"]').innerText(), /^\d+ use cases? so far$/, label);
      assert.doesNotMatch(await page.locator('body').innerText(), /completed steps/, label);
      await toView(page, 'Overview');
      assert.deepEqual(await page.locator('[data-executive-summary] p').allInnerTexts(), shown, label);
      assert.deepEqual(ui.pageErrors, [], label);
    } finally {
      await ui.close();
    }
  }
});

test('Start lists the runs with Latest Run only on the newest run of a business with two or more runs, on its first page and on the launch form', async () => {
  const want = { 42: 1, 41: 0, 50: 0, 51: 0, 60: 0, 61: 0 };
  const read = async (page, scope) => {
    const seen = {};
    for (const sid of Object.keys(want)) seen[sid] = await scope.locator(`[data-run="${sid}"] [data-latest-run]`).count();
    return seen;
  };
  const choose = await openUi('choose', REVIEW_STATE);
  try {
    await choose.page.getByText('Beta Foods', { exact: true }).first().waitFor();
    assert.equal(await choose.page.locator('button button').count(), 0, 'no button sits inside another button');
    await choose.page.locator('[data-run="42"]').waitFor();
    await choose.page.getByRole('button', { name: /Show 1 more run/ }).click();
    await choose.page.locator('[data-run="61"]').waitFor();
    assert.deepEqual(await read(choose.page, choose.page), want);
    assert.equal(await choose.page.locator('button button').count(), 0, 'and none after Show more either');
    const opened = () => choose.page.locator('output[aria-label="Opened runs"]').textContent();
    await choose.page.locator('[data-run="42"]').scrollIntoViewIfNeeded();
    const box = await steadyBox(choose.page.locator('[data-run="42"]'));
    await choose.page.mouse.click(box.x + box.width - 10, box.y + box.height / 2);
    assert.equal(await opened(), '42', 'a click anywhere on the row opens the run, its chevron edge too');
    await choose.page.locator('[data-run="51"]').getByRole('button', { name: /^More for / }).click();
    await choose.page.getByRole('menuitem', { name: 'Quick view' }).click();
    await choose.page.locator('[data-run="51"]').getByRole('button', { name: /^More for / }).click();
    await choose.page.getByRole('menuitem', { name: 'Hide quick view' }).waitFor();
    await choose.page.keyboard.press('Escape');
    assert.equal(await opened(), '42', 'Quick View opens its panel and not the run');
    await choose.page.locator('[data-run="42"]').getByRole('button', { name: /Acme/ }).first().waitFor();
    assert.deepEqual(choose.pageErrors, []);
  } finally {
    await choose.close();
  }
  const launch = await openUi('launch', REVIEW_STATE);
  try {
    // REQ-510 L3: the run overview opens, expanded, from More > Recent runs.
    await launch.page.getByRole('button', { name: 'More', exact: true }).click();
    await launch.page.getByRole('menuitem', { name: 'Recent runs' }).click();
    const overview = launch.page.getByRole('region', { name: 'Discovery Overview' });
    await overview.locator('[data-run="61"]').waitFor();
    assert.deepEqual(await read(launch.page, overview), want);
    assert.equal(await overview.getByRole('button', { name: 'Open in Review' }).count(), 6);
    assert.equal(await overview.locator('[data-run="60"]').getByText('No business name').count(), 1);
  } finally {
    await launch.close();
  }
});

const blankBelow = (page) => page.locator('[data-insight]').evaluateAll((els) => els.map((el) => {
  const kids = [...el.querySelectorAll('*')].filter((k) => k.getBoundingClientRect().height > 0);
  const last = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
  return { title: el.dataset.insight, blank: Math.round(el.getBoundingClientRect().bottom - last) };
}));

test('the insight cards stack at full width with no Strategy coverage card and no Data foundations card, the Suggested build order is back and opens a use case, and no card holds a tall empty area', async () => {
  const ui = await openUi('results', REVIEW_STATE);
  const { page } = ui;
  try {
    await ready(page);
    await toView(page, 'Overview');
    const grid = page.locator('[data-insights-grid]');
    await grid.waitFor();
    assert.ok(REVIEW_STATE.results.foundations.length > 0, 'the results still carry shared foundations');
    assert.equal(await grid.getAttribute('data-insights-grid'), '2');
    assert.equal(await grid.getAttribute('data-insights-columns'), '1');
    assert.equal(await insight(page, 'Strategy coverage').count(), 0, 'no Strategy coverage card');
    assert.equal(await insight(page, 'Data foundations').count(), 0, 'no Data foundations card (must-exclude)');
    assert.equal(await page.locator('[data-foundation]').count(), 0, 'no shared foundation list');
    for (const width of [1440, 1024, 700]) {
      await page.setViewportSize({ width, height: 1000 });
      await settled(page, '[data-insights-grid]');
      const order = await page.locator('[data-insight]').evaluateAll((els) => els.map((el) => el.dataset.insight));
      assert.deepEqual(order, ['Suggested build order', 'Feedback and value'], `${width}: the build order, then the feedback note`);
      const widths = await page.locator('[data-insight]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
      assert.equal(new Set(widths).size, 1, `${width}: each card takes the whole width`);
      for (const b of await blankBelow(page)) assert.ok(b.blank <= 24, `${width}: ${b.title} ends where its content ends (${b.blank}px blank)`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    const note = insight(page, 'Feedback and value');
    assert.equal(await note.locator('[data-feedback-note]').innerText(), V.FEEDBACK_OFF_TEXT);
    assert.doesNotMatch(await note.innerText(), /\bv?\d+\.\d+(\.\d+)?\b/, 'no version number');

    const steps = insight(page, 'Suggested build order').getByRole('list', { name: 'Suggested build order' }).getByRole('listitem');
    assert.equal(await steps.count(), 5, 'five steps before Show all');
    assert.deepEqual((await steps.first().innerText()).split('\n').map((t) => t.trim()).filter(Boolean), ['1.', 'Predict churn', 'Customer', '7.4']);
    assert.deepEqual((await steps.nth(1).innerText()).split('\n').map((t) => t.trim()).filter(Boolean), ['2.', 'Forecast stock', 'Supply'], 'a use case without a quality score shows no Inspire Score, not its priority (must-exclude)');
    await toView(page, 'Use cases');
    await page.getByPlaceholder('Search use cases...').fill('no use case matches this');
    await page.getByText('No use cases match your filters.').waitFor();
    await toView(page, 'Overview');
    await insight(page, 'Suggested build order').getByRole('button', { name: 'Score upsell' }).click();
    await until(async () => (await card(page, 'Score upsell').getAttribute('data-open')) !== null && (await readerOf(page).count()) === 1, 'the use case opens');
    assert.equal(await page.getByPlaceholder('Search use cases...').inputValue(), '', 'the filters that hid it are cleared');
    await toView(page, 'Overview');
    for (const dark of [false, true]) {
      await setDark(page, dark);
      await panelSettled(page);
      const measured = await lowContrast(page, ['[data-insights-grid]']);
      assert.ok(measured.checked >= 2, `${dark ? 'dark' : 'light'}: measured ${measured.checked}`);
      assert.deepEqual(measured.low, [], `${dark ? 'dark' : 'light'} insight cards`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('with feedback on and none given yet, the feedback note says how to give it, next to the build order', async () => {
  const feedback = (app) => app.get('/api/inspire/feedback', (_req, res) => res.json({ available: true, latest: [], history: [] }));
  const { strategy_coverage: _s, ...noCoverage } = REVIEW_RESULTS;
  const ui = await openUi('results', { ...REVIEW_STATE, results: noCoverage }, '', { mount: feedback });
  const { page } = ui;
  try {
    await ready(page);
    await toView(page, 'Overview');
    const grid = page.locator('[data-insights-grid="2"]');
    await grid.waitFor();
    assert.equal(await grid.getAttribute('data-insights-columns'), '1');
    assert.equal(await insight(page, 'Feedback and value').locator('[data-feedback-note]').innerText(), V.FEEDBACK_EMPTY_TEXT);
    const widths = await page.locator('[data-insight]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
    assert.equal(new Set(widths).size, 1, 'each card takes the whole width');
    for (const b of await blankBelow(page)) assert.ok(b.blank <= 24, `${b.title}: ${b.blank}px blank`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a live preview heads the run with its business name and offers no MVP start for use cases the run has not saved yet (must-exclude)', async () => {
  const { title: _final, ...preview } = REVIEW_RESULTS;
  const live = await openUi('results', { ...REVIEW_STATE, results: null, stepResults: { ...preview, _progressive: true, _use_case_count: 3, _step_count: 4 } });
  try {
    await ready(live.page);
    await live.page.getByText('Live Preview', { exact: true }).waitFor();
    const named = (await heading(live.page).locator('h2').innerText()).trim();
    const business = (await heading(live.page).locator('[data-run-business]').innerText()).trim();
    assert.equal(named, `${business} Use Cases Catalog`, 'the heading names the business, never its description');
    assert.equal(await live.page.getByRole('button', { name: START_MVP_LABEL }).count(), 0, 'a preview row is not in the use case table yet');
    assert.ok((await live.page.getByText(`${START_MVP_LABEL} opens on each use case once the run has saved it.`).count()) > 0);
    assert.deepEqual(live.pageErrors, []);
  } finally {
    await live.close();
  }
  const saved = await openUi('results', REVIEW_STATE);
  try {
    await ready(saved.page);
    // REQ-511: the MVP start is the Build MVP button of each use case row (it opens the same wizard).
    assert.ok((await saved.page.locator('[data-use-case-row]').getByRole('button', { name: /^(Build|Open|Rebuild) MVP$/ }).count()) > 0, 'a finished run still offers the MVP start');
  } finally {
    await saved.close();
  }
});




const GATE_DROPS = [
  { no: 'N09-U01', name: 'Guess tomorrow from weather alone', domain: 'Sales', subdomain: 'Demand', gate: 'D5', gate_name: 'logical possibility check', gate_score: 2, bob_score: 2 },
  { no: 'N09-U02', name: 'رصد الأسعار الخاطئة', domain: 'Pricing', subdomain: '', gate: 'D14', gate_name: 'engineering test', gate_score: 1.5, bob_score: 2 },
];

test('Review keeps the use cases the quality gates dropped in one collapsed read-only group, each with the gate in plain words, its score and the code under Details, and none of them reaches the list or the figures (must-exclude)', async () => {
  const stats = async (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[aria-label="Figures of this run"] [data-stat]')]
    .map((el) => [el.getAttribute('data-stat'), el.querySelector('[data-stat-value]')?.textContent.trim()])));
  const before = await openUi('results', REVIEW_STATE);
  let baseline;
  try {
    await ready(before.page);
    await idle(before.page);
    baseline = { stats: await stats(before.page), cards: await cards(before.page).count() };
    assert.equal(await before.page.locator('[data-quality-gate-drops]').count(), 0, 'a run with no dropped use case, or an older run, shows no group');
    assert.equal(await before.page.locator('[role="alert"]').count(), 0, 'and no error');
  } finally {
    await before.close();
  }
  const ui = await openUi('results', { ...REVIEW_STATE, results: { ...REVIEW_RESULTS, quality_gate_drops: GATE_DROPS } }, '', { init: (page) => page.setViewportSize({ width: 1280, height: 900 }) });
  const { page } = ui;
  try {
    await ready(page);
    await idle(page);
    const group = page.locator('[data-quality-gate-drops]');
    await group.waitFor();
    assert.equal(await group.evaluate((el) => el.open), false, 'the group starts collapsed');
    assert.equal((await group.locator(':scope > summary').innerText()).replace(/\s+/g, ' ').trim(), 'Dropped by quality gates 2');
    assert.deepEqual(await stats(page), baseline.stats, 'Use Cases, High Priority and every other figure leave the dropped ones out (must-exclude)');
    assert.equal(await cards(page).count(), baseline.cards, 'the use case list leaves them out (must-exclude)');
    for (const drop of GATE_DROPS) assert.equal(await list(page).getByText(drop.name).count(), 0);
    await group.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await group.evaluate((el) => el.open), true, 'the keyboard opens it');
    const first = group.locator('[data-dropped-use-case="N09-U01"]');
    assert.equal(await first.locator('[data-dropped-reason]').innerText(), 'It scored 2 out of 10 on the logical possibility check, below the 3 every use case needs.');
    assert.equal(await first.locator('[data-dropped-score]').innerText(), '2 / 10');
    assert.doesNotMatch(await first.locator('[data-dropped-reason]').innerText(), /D5/, 'the gate code stays under Details');
    await first.locator('summary').click();
    assert.match(await first.locator('[data-technical-details]').innerText(), /Quality gate D5/);
    assert.equal(await group.locator('button, a, input, select, textarea').count(), 0, 'read-only: no action on a dropped use case');
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const dir of ['ltr', 'rtl']) {
        await page.evaluate((d) => { document.documentElement.dir = d; }, dir);
        const fits = await group.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= window.innerWidth);
        assert.equal(fits, true, `the group fits at ${width} px in ${dir}`);
      }
    }
    assert.equal(await group.locator('[data-dropped-use-case="N09-U02"] p[dir="auto"]').first().innerText(), 'رصد الأسعار الخاطئة');
  } finally {
    await ui.close();
  }
});
