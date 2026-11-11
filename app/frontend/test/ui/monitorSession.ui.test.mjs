import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until, watchScrolls } from './uiSupport.mjs';
import { aimWheel } from './wheelScroll.mjs';

test.after(closeBrowser);

const MINUTE = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const clock = (iso) => iso.slice(11, 16);

const step = (id, status, stage, name, sub, at, eventAt = null) => ({
  step_id: String(id), session_id: '42', stage_name: stage, step_name: name, sub_step_name: sub, status, message: '', progress_increment: 0,
  last_updated: at, result_json: eventAt ? { event_at: eventAt } : {},
});

function sessionBackend({ session, steps = [], run = null }) {
  const calls = { acks: 0 };
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: ago(90 * MINUTE), ...session() } }));
    app.get('/api/inspire/steps', (req, res) => res.json({ steps: req.query.since ? [] : steps }));
    app.post('/api/inspire/ack', (_req, res) => { calls.acks += 1; res.json({ success: true }); });
    if (run) {
      app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
      app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, run_name: 'Inspire Discover', ...run }));
    }
  };
  return { calls, mount };
}

async function openMonitor(backend, { sessionOnly = true } = {}) {
  return openUi('monitor', {}, sessionOnly ? '&run=none' : '', { mount: backend.mount });
}

async function statusCard(page) {
  const card = page.locator('div.rounded-xl.p-5.mb-6').first();
  await card.waitFor({ timeout: 10000 });
  return card;
}

const badges = (page, text) => page.locator('span').filter({ hasText: new RegExp(`^${text}$`) }).count();

async function detailLine(page) {
  const heading = page.getByRole('heading', { name: 'Detailed Steps' });
  await heading.waitFor({ timeout: 10000 });
  return heading.locator('xpath=following-sibling::p').innerText();
}

for (const [label, processing, percent] of [['after the App acknowledged it', 'done', 37], ['before the App acknowledged it', 'ready', 37], ['just after it started', 'done', 1]]) {
  test(`a Discover run opened from Start with no run id shows Running and its percent ${label}`, async () => {
    const backend = sessionBackend({ session: () => ({ processing_status: processing, completed_percent: percent, completed_on: null, last_updated: ago(MINUTE) }) });
    const ui = await openMonitor(backend);
    try {
      const card = await statusCard(ui.page);
      await card.getByText('Running', { exact: true }).waitFor({ timeout: 10000 });
      assert.equal(await card.getByText(`${percent}% complete`, { exact: true }).count(), 1);
      assert.equal(await card.getByText('Initializing', { exact: true }).count(), 0);
      if (processing === 'ready') await until(() => backend.calls.acks > 0, 'the ack of the new progress');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

test('a run with no news for longer than the bound shows a calm No news line instead of Running, even while processing_status is ready', async () => {
  const last = ago(40 * MINUTE);
  const backend = sessionBackend({ session: () => ({ processing_status: 'ready', completed_percent: 62, completed_on: null, last_updated: last }) });
  const ui = await openMonitor(backend);
  try {
    const card = await statusCard(ui.page);
    const line = card.getByText(/^No news from this run since /);
    await line.waitFor({ timeout: 10000 });
    assert.match(await line.innerText(), new RegExp(`^No news from this run since ([A-Z][a-z]{2} \\d{1,2}, )?${clock(last)} UTC\\.$`));
    assert.equal(await card.getByText('Running', { exact: true }).count(), 0, 'a quiet run is not shown as running');
    assert.equal(await card.getByText('Quiet', { exact: true }).count(), 1);
    assert.equal(await card.getByText('62%', { exact: true }).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a run whose last news is inside the bound still shows Running', async () => {
  const backend = sessionBackend({ session: () => ({ processing_status: 'done', completed_percent: 55, completed_on: null, last_updated: ago(25 * MINUTE) }) });
  const ui = await openMonitor(backend);
  try {
    const card = await statusCard(ui.page);
    await card.getByText('Running', { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await card.getByText(/^No news from this run/).count(), 0);
  } finally {
    await ui.close();
  }
});

const T = '2026-11-02T03:00:00.000Z';
const OPEN_MARKERS = [
  step(1, 'started', 'Setup', 'Inspire is working on database setup', 'In progress: main.inspire', T, '2026-11-02T03:00:00.100000+00:00'),
  step(1, 'ended_success', 'Setup', 'Inspire is working on database setup', 'Completed: main.inspire', '2026-11-02T03:00:02.000Z', '2026-11-02T03:00:01.500000+00:00'),
  step(2, 'started', 'Data Preparation', 'Inspire is working on filter business tables', 'In progress: started', '2026-11-02T03:00:04.000Z'),
  step(3, 'started', 'Final Gate', 'Inspire is working on phase l production checks', 'In progress: started', '2026-11-02T03:00:06.000Z'),
  step(4, 'ended_success', 'Final Gate', 'Inspire is working on phase l production checks', 'Completed: complete', '2026-11-02T03:00:08.000Z'),
];

async function openSteps(page) {
  await page.getByRole('button', { name: /Detailed Steps/ }).click();
  for (const stage of ['Setup', 'Data Preparation', 'Final Gate']) {
    await page.getByRole('button', { name: new RegExp(`^${stage}`) }).filter({ has: page.locator('h3') }).click();
  }
}

test('a completed run opened from Start shows no step in progress when the agent left start markers open', async () => {
  const backend = sessionBackend({
    session: () => ({ processing_status: 'ready', completed_percent: 100, completed_on: ago(MINUTE), last_updated: ago(MINUTE) }), steps: OPEN_MARKERS,
  });
  const ui = await openMonitor(backend);
  try {
    const card = await statusCard(ui.page);
    await card.getByText('Completed', { exact: true }).waitFor({ timeout: 10000 });
    const line = await detailLine(ui.page);
    assert.match(line, /3 stages · 4 steps/);
    assert.doesNotMatch(line, /in progress/);
    await openSteps(ui.page);
    assert.equal(await badges(ui.page, 'In Progress'), 0);
    assert.equal(await badges(ui.page, 'No end recorded'), 2, 'the two steps the agent never closed');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a run that ended with SUCCESS shows no step in progress when the agent left start markers open', async () => {
  const backend = sessionBackend({
    session: () => ({ processing_status: 'done', completed_percent: 100, completed_on: ago(MINUTE), last_updated: ago(MINUTE) }), steps: OPEN_MARKERS,
    run: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' },
  });
  const ui = await openMonitor(backend, { sessionOnly: false });
  try {
    const card = await statusCard(ui.page);
    await card.getByText('Completed', { exact: true }).waitFor({ timeout: 10000 });
    assert.doesNotMatch(await detailLine(ui.page), /in progress/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('while the run is live, a step with only its start recorded is still counted in progress', async () => {
  const backend = sessionBackend({
    session: () => ({ processing_status: 'ready', completed_percent: 40, completed_on: null, last_updated: ago(MINUTE) }), steps: OPEN_MARKERS,
  });
  const ui = await openMonitor(backend);
  try {
    const card = await statusCard(ui.page);
    await card.getByText('Running', { exact: true }).waitFor({ timeout: 10000 });
    assert.match(await detailLine(ui.page), /· 2 in progress/);
    await openSteps(ui.page);
    assert.equal(await badges(ui.page, 'In Progress'), 2);
    assert.equal(await badges(ui.page, 'No end recorded'), 0);
  } finally {
    await ui.close();
  }
});

for (const [motion, behavior] of [['reduce', 'auto'], ['no-preference', 'smooth']]) {
  test(`the steps list follows new steps with a ${behavior} scroll when the person's motion setting is ${motion}`, async () => {
    const backend = sessionBackend({
      session: () => ({ processing_status: 'ready', completed_percent: 40, completed_on: null, last_updated: ago(MINUTE) }), steps: OPEN_MARKERS,
    });
    let scrolls;
    let polls = 0;
    const mount = (app) => {
      app.get('/api/inspire/steps', (req, res) => {
        polls += 1;
        res.json({ steps: req.query.since ? [step(10 + polls, 'started', 'Final Gate', 'Inspire is working on more checks', 'In progress: started', new Date().toISOString())] : OPEN_MARKERS });
      });
      backend.mount(app);
    };
    const ui = await openUi('monitor', {}, '&run=none', {
      mount,
      init: async (page) => { await page.emulateMedia({ reducedMotion: motion }); scrolls = await watchScrolls(page); },
    });
    try {
      await detailLine(ui.page);
      await ui.page.getByRole('button', { name: /Detailed Steps/ }).click();
      let seen = [];
      await until(async () => { seen = seen.concat(await scrolls()); return seen.length > 0; }, 'the steps list followed the new steps', 10000);
      assert.deepEqual([...new Set(seen)], [behavior]);
    } finally {
      await ui.close();
    }
  });
}

test('the steps list follows new steps only while the person is at its end; scrolled up, it keeps their place and offers New steps', async () => {
  const many = Array.from({ length: 60 }, (_, i) => step(100 + i, 'ended_success', 'Data Preparation', `Inspire checked table ${i + 1}`, `Completed: table ${i + 1}`, ago(30 * MINUTE - i * 1000)));
  const backend = sessionBackend({ session: () => ({ processing_status: 'ready', completed_percent: 40, completed_on: null, last_updated: ago(MINUTE) }), steps: many });
  let polls = 0;
  const mount = (app) => {
    app.get('/api/inspire/steps', (req, res) => {
      polls += 1;
      res.json({ steps: req.query.since ? [step(500 + polls, 'ended_success', 'Data Preparation', `Inspire checked new table ${polls}`, `Completed: new table ${polls}`, new Date().toISOString())] : many });
    });
    backend.mount(app);
  };
  const ui = await openUi('monitor', {}, '&run=none', { mount, init: (page) => page.emulateMedia({ reducedMotion: 'reduce' }) });
  const { page } = ui;
  const rows = () => page.getByText(/^Inspire checked/).count();
  const view = () => page.evaluate(() => {
    const end = document.querySelector('[data-steps-end]');
    let el = end.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    const box = el || document.scrollingElement;
    const bottom = el ? el.getBoundingClientRect().bottom : window.innerHeight;
    return { top: box.scrollTop, below: end.getBoundingClientRect().top - bottom };
  });
  const jump = page.getByRole('button', { name: 'New steps' });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await detailLine(page);
    await page.getByRole('button', { name: /Detailed Steps/ }).click();
    await page.getByRole('button', { name: /Data Preparation/ }).last().click();
    await page.getByText('Inspire checked table 60').first().waitFor({ timeout: 10000 });
    await aimWheel(page, 640, 400);
    await page.mouse.wheel(0, 20000);
    await until(async () => (await view()).below <= 40, 'the wheel reaches the end of the steps', 10000);
    const first = await rows();
    await until(async () => (await rows()) > first, 'a new step arrives', 10000);
    await page.waitForTimeout(300);
    assert.ok((await view()).below <= 40, 'at the end it follows each new step (must-exclude: never left behind while at the end)');
    assert.equal(await jump.count(), 0, 'no New steps button while following');
    await aimWheel(page, 640, 400);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(400);
    const reading = await view();
    assert.ok(reading.below > 40, 'wheel up leaves the end');
    const now = await rows();
    await until(async () => (await rows()) >= now + 2, 'two more steps arrive while the person reads', 12000);
    await page.waitForTimeout(300);
    assert.ok(Math.abs((await view()).top - reading.top) <= 2, `new steps keep the reader's place, ${(await view()).top} vs ${reading.top}`);
    await jump.waitFor({ timeout: 5000 });
    for (const block of ['start', 'center', 'end', 'nearest']) {
      await jump.evaluate((button, how) => button.scrollIntoView({ block: how }), block);
      await page.waitForTimeout(300);
      assert.equal(await jump.count(), 1, `scrolling New steps into view (${block}) keeps it, it never hides itself (must-exclude)`);
      assert.ok((await view()).below > 40, `scrolling New steps into view (${block}) does not carry the reader to the end`);
    }
    await jump.click();
    await until(async () => (await view()).below <= 40, 'New steps jumps to the latest step', 5000);
    assert.equal(await jump.count(), 0, 'the button goes once the person is back at the end');
  } finally {
    await ui.close();
  }
});

for (const [label, withEventAt] of [['by the time of each event', true], ['when two rows share one flush time', false]]) {
  test(`a step whose end arrives before its start in one answer still shows its end, ${label}`, async () => {
    const flushed = ago(2 * MINUTE);
    const rows = [
      step(9, 'ended_success', 'Scoring', 'Scoring the use cases', 'Completed: batch 1', flushed, withEventAt ? '2026-11-02T03:10:05.250000+00:00' : null),
      step(9, 'started', 'Scoring', 'Scoring the use cases', 'In progress: batch 1', flushed, withEventAt ? '2026-11-02T03:10:01.000000+00:00' : null),
    ];
    const backend = sessionBackend({ session: () => ({ processing_status: 'ready', completed_percent: 50, completed_on: null, last_updated: ago(MINUTE) }), steps: rows });
    const ui = await openMonitor(backend);
    try {
      const card = await statusCard(ui.page);
      await card.getByText('Running', { exact: true }).waitFor({ timeout: 10000 });
      const line = await detailLine(ui.page);
      assert.match(line, /1 stage · 1 step/);
      assert.doesNotMatch(line, /in progress/);
    } finally {
      await ui.close();
    }
  });
}

test('Start lists a run with no news for longer than the bound as No news, not In Progress, and leaves it out of the in progress count', async () => {
  const run = (sid, extra) => ({ session_id: sid, business_name: `Biz ${sid}`, widget_values: { business: `Biz ${sid}` }, create_at: ago(5 * 60 * MINUTE), ...extra });
  const sessions = [
    run('70', { completed_percent: 100, completed_on: ago(4 * 60 * MINUTE), last_updated: ago(4 * 60 * MINUTE) }),
    run('71', { completed_percent: 20, completed_on: null, last_updated: ago(MINUTE), processing_status: 'done' }),
    run('72', { completed_percent: 40, completed_on: null, last_updated: ago(2 * 60 * MINUTE), processing_status: 'ready' }),
  ];
  const ui = await openUi('choose', { sessions });
  try {
    const row = (sid) => ui.page.locator(`[data-run="${sid}"]`).first();
    await row('72').waitFor({ timeout: 10000 });
    assert.equal(await row('70').getByText('Completed', { exact: true }).count(), 1);
    assert.equal(await row('71').getByText('In Progress', { exact: true }).count(), 1);
    assert.equal(await row('72').getByText('In Progress', { exact: true }).count(), 0, 'a quiet run is not in progress');
    assert.equal(await row('72').getByText('No news', { exact: true }).count(), 1);
    assert.equal(await ui.page.getByText('1 completed · 1 in progress · 1 with no news', { exact: true }).count(), 1);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the run line names the business and the start time on the person\u2019s own clock, with the raw job name only in its tooltip', async () => {
  const raw = 'Inspire AI - Acme Retail - 2026-11-04T14:57:44';
  const started = Date.parse('2026-11-04T14:57:44Z');
  const backend = sessionBackend({
    session: () => ({ processing_status: 'ready', completed_percent: 0, completed_on: null, last_updated: ago(MINUTE) }),
    run: { life_cycle_state: 'PENDING', run_name: raw, start_time: started, tasks: [] },
  });
  const ui = await openMonitor(backend, { sessionOnly: false });
  try {
    const line = ui.page.locator(`p[title="${raw}"]`);
    await line.waitFor({ timeout: 10000 });
    const local = await ui.page.evaluate((ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }), started);
    assert.equal(await line.innerText(), `Acme Retail, started ${local}`);
    assert.equal(await ui.page.getByText(raw, { exact: true }).count(), 0, 'the raw UTC job name is not shown as text');
    assert.equal(await ui.page.getByText('2026-11-04T14:57:44').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a refused view grant shows on the Monitor in one plain sentence, and a granted run shows nothing', async () => {
  const note = 'Inspire could not let pat.lee@example.com view job 1111111111111111 in Databricks: no CAN_MANAGE on job';
  for (const [run, expected] of [[{ viewer_note: note }, `${note}.`], [{ viewer_note: 'Already a sentence.' }, 'Already a sentence.'], [{}, null], [{ viewer_note: '  ' }, null]]) {
    const backend = sessionBackend({
      session: () => ({ processing_status: 'ready', completed_percent: 0, completed_on: null, last_updated: ago(MINUTE) }),
      run: { life_cycle_state: 'PENDING', run_name: 'Inspire AI - Acme Retail', start_time: Date.parse('2026-11-04T14:57:44Z'), run_page_url: 'https://h/jobs/1/runs/777', tasks: [], ...run },
    });
    const ui = await openMonitor(backend, { sessionOnly: false });
    try {
      await ui.page.locator('p[title="Inspire AI - Acme Retail"]').waitFor({ timeout: 10000 });
      const shown = ui.page.locator('[data-viewer-note]');
      if (expected) {
        assert.equal(await shown.innerText(), expected);
        assert.equal(await shown.getAttribute('role'), 'status');
      } else {
        assert.equal(await shown.count(), 0, JSON.stringify(run));
      }
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('a run whose notebook refused its inputs shows the reason on the Monitor, not the platform line, and a failure with no reason keeps the platform line (must-exclude)', async () => {
  const reason = 'Validation failed with 1 error:\n\u274c Generation Path is required';
  const platform = 'Workload failed, see run output for details';
  for (const [error, expected] of [[reason, /Generation Path is required/], ['', new RegExp(platform)]]) {
    const backend = sessionBackend({
      session: () => ({ processing_status: 'ready', completed_percent: 0, completed_on: null, last_updated: ago(MINUTE) }),
      run: { life_cycle_state: 'TERMINATED', result_state: 'FAILED', run_name: 'Inspire AI - Acme Retail', tasks: [
        { task_key: 'inspire_notebook', life_cycle_state: 'TERMINATED', result_state: 'FAILED', state_message: platform, run_id: 9, ...(error ? { error } : {}) }] },
    });
    const ui = await openMonitor(backend, { sessionOnly: false });
    try {
      const card = await statusCard(ui.page);
      await card.getByText(expected).first().waitFor({ timeout: 10000 });
      assert.equal(await card.getByText('The run ended. Inspire is saving the use cases...').count(), 0);
      if (error) assert.equal(await card.getByText(platform).count(), 0, 'the platform line gives way to the reason the notebook gave');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('a running Discovery fills its steps and the use cases each step found while it runs, before the run ends', async () => {
  const state = { polls: 0, percent: 20 };
  const first = step(21, 'started', 'Use Case Generation', 'Inspire is working on use case generation', 'In progress: batch 1', ago(MINUTE));
  const found = { ...step(21, 'ended_success', 'Use Case Generation', 'Inspire is working on use case generation', 'Completed: batch 1', new Date().toISOString()),
    result_json: { prompt_name: 'BASE_USE_CASE_GEN_PROMPT', use_cases_count: 3,
      use_cases: [{ id: 'N01-U01', name: 'Cut stock-outs in the top stores' }, { id: 'N01-U02', name: 'Spot late suppliers early' }, { id: 'N01-U03', name: 'Price slow sellers down' }] } };
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: ago(30 * MINUTE),
      processing_status: 'ready', completed_percent: state.percent, completed_on: null, last_updated: new Date().toISOString() } }));
    app.get('/api/inspire/steps', (req, res) => {
      state.polls += 1;
      if (!req.query.since) return res.json({ steps: [first] });
      if (state.polls === 3) { state.percent = 45; return res.json({ steps: [found] }); }
      return res.json({ steps: [] });
    });
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
  };
  const ui = await openUi('monitor', {}, '&run=none', { mount });
  const { page } = ui;
  try {
    const card = await statusCard(page);
    await card.getByText('Running', { exact: true }).waitFor({ timeout: 10000 });
    assert.match(await detailLine(page), /1 stage · 1 step/);
    assert.match(await detailLine(page), /1 in progress/);
    assert.equal(await page.getByTestId('live-use-case-count').count(), 0, 'no use case is found yet');
    await card.getByText('45% complete', { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('heading', { name: 'Detailed Steps' }).locator('xpath=following-sibling::p').filter({ hasNotText: /in progress/ }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Detailed Steps/ }).click();
    await page.getByRole('button', { name: /^Use Case Generation/ }).filter({ has: page.locator('h3') }).click();
    await page.getByText('Inspire is working on use case generation', { exact: true }).last().click();
    await page.getByText('3 use cases', { exact: true }).first().waitFor({ timeout: 10000 });
    assert.equal(await page.getByTestId('live-use-case-count').innerText(), '3 use cases so far');
    for (const name of ['Cut stock-outs in the top stores', 'Spot late suppliers early', 'Price slow sellers down']) {
      assert.equal(await page.getByText(name, { exact: true }).count(), 2, `${name} shows in the live list and in its step while the run is still going`);
    }
    assert.equal(await card.getByText('Running', { exact: true }).count(), 1, 'the run has not ended');
    assert.equal(await card.getByText('Completed', { exact: true }).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a run with no strategy says in plain words that Inspire uses common business goals', async () => {
  const backend = sessionBackend({ session: () => ({ processing_status: 'done', completed_percent: 40, completed_on: null, last_updated: ago(MINUTE),
    widget_values: { business: 'Acme Retail', discovery_type: 'Standard Discovery' } }) });
  const ui = await openMonitor(backend);
  try {
    await ui.page.getByText('No strategy given, so Inspire uses common business goals').first().waitFor({ timeout: 10000 });
    assert.doesNotMatch(await ui.page.locator('body').innerText(), /built-in goals/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
