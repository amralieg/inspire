import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, STUDIO_STATE, built, builtSpec } from './implementFixtures.js';
import { closeBrowser, onStep, openUi, startMvp, toVibes, until } from './uiSupport.mjs';

const HOSTED_NO_TOKEN = 'Inspire needs permission to act as you to show this page; a workspace admin turns on user authorization for Apps, then reopen Inspire';
const RUN_BANNER = 'Inside Inspire, only for testing. Give it its own App for real use.';
const RUN_EMPTY = 'No use case is deployed yet. To try a page Inside Inspire, open the use case in Build, press Vibe/Add/Remove Features, then Open all settings, '
  + 'and on App placement pick '
  + 'Inside Inspire. Use cases with an App of their own show up here too.';
const INSIDE_BLURB = 'Inspire runs the page in its Run tab, with no App of its own. Each viewer sees only the data they may read. Use it to try a page, '
  + 'then give it its own App.';
const INSIDE_ACCESS_REASON = 'Inside Inspire, each viewer signs in as themselves and sees only the data they may read';
const INSIDE_BACKEND_REASON = 'Lakebase needs an App of its own';
const INSIDE_WAREHOUSE_LABEL = 'SQL warehouse each viewer reads with (each viewer needs CAN USE on it)';

test.after(closeBrowser);

const hostedRecord = { id: 'n01-u01-a', source: '/Workspace/Users/someone/inspire/n01-u01-a/v2', version: 2, warehouse_id: 'wh2', page: 'n01_u01',
  published_at: '2026-10-30T05:00:00Z' };
const registryRow = (session, uc, version, { app, appName = '', appUrl = '', name }) => ({
  session_id: session, use_case_id: uc, spec_version: version, status: 'ready', created_by: OWNER, app_name: appName, app_url: appUrl,
  spec_json: JSON.stringify({ use_case_name: name, outputs: { app: true, app_owners: [] } }),
  asset_status: JSON.stringify({ app }), updated_at: '2026-10-30T06:00:00Z', dashboard_id: null, genie_space_id: null,
});
const REGISTRY = [
  registryRow('42', 'N01-U01', 2, { app: { placement: 'inspire', hosted: hostedRecord, app_name: '', app_url: '' }, name: 'Predict churn' }),
  registryRow('43', 'N02-U01', 1, { app: { state: 'ready' }, appName: 'inspire-hub-acme', appUrl: 'https://inspire-hub-acme.example.com', name: 'Plan shifts' }),
];
const SCOPE = [{ session_id: '42', use_case_id: 'N01-U01', domain: 'Retention' }, { session_id: '43', use_case_id: 'N02-U01', domain: 'Operations' }];

function hostedFake({ stderr, ...state }) {
  const asked = [];
  return {
    asked,
    useReader: () => {},
    setListed: () => {},
    stateOf: (id, { owner }) => {
      asked.push([id, owner]);
      return { reason: '', error: '', ...state, ...(owner && stderr ? { stderr } : {}) };
    },
  };
}

const hostedPage = (app) => app.get('/run/:id/{*rest}', (req, res) => res.type('html').send(`<p data-hosted="${req.params.id}">hosted page</p>`));

async function openRun(state, headers = null) {
  return openUi('run', state, '', {
    mount: hostedPage,
    init: headers ? (page) => page.setExtraHTTPHeaders(headers) : undefined,
  });
}

test('the Run tab sits right after Build in the header', async () => {
  const ui = await openUi('header');
  try {
    const nav = ui.page.locator('header nav button');
    await nav.first().waitFor();
    assert.deepEqual(await nav.allTextContents(), ['01Start', '02Monitor', '03Review', '04Build', '05Run']);
    assert.equal(await nav.nth(4).isEnabled(), true);
    assert.doesNotMatch(await ui.page.locator('header').innerText(), /\bv\d/i, 'the header shows no version badge');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const onFull = (page, id) => page.locator(`[data-run-full="inspire:${id}"]`).waitFor({ timeout: 20000 });
const toggle = (page) => page.locator('[data-run-control-toggle]');
const backToInspire = async (page) => {
  if (await toggle(page).getAttribute('aria-expanded') !== 'true') await toggle(page).click();
  await page.getByRole('button', { name: 'Back to Inspire', exact: true }).click();
  await page.locator('[data-run-page-root]').waitFor({ timeout: 20000 });
};

test('Run lists every deployed use case by domain, opens an Inside Inspire page full window with its banner in the Inspire menu, and an App of its own with Open App', async () => {
  const ui = await openRun({ registry: REGISTRY, useCaseScope: SCOPE, hostedRun: hostedFake({ state: 'ready' }) },
    { 'x-forwarded-access-token': 'user-token', 'x-forwarded-email': OWNER });
  const { page } = ui;
  try {
    await page.locator('[data-run-banner]').waitFor({ timeout: 15000 });
    assert.deepEqual(await page.locator('[data-run-domain]').evaluateAll((els) => els.map((e) => e.dataset.runDomain)), ['Operations', 'Retention']);
    assert.equal((await page.locator('[data-run-banner]').textContent()).trim(), RUN_BANNER);
    assert.equal(await page.locator('[data-run-state]').textContent(), 'Ready');
    assert.equal(await page.locator('[data-run-frame]').count(), 0, 'the list never squeezes the page into a frame beside it');
    const newTab = page.locator('[data-run-new-tab="n01-u01-a"]');
    assert.deepEqual([await newTab.getAttribute('href'), await newTab.getAttribute('target'), (await newTab.textContent()).trim()],
      ['/run/n01-u01-a/#/n01_u01', '_blank', 'Open in a new tab']);
    await page.locator('[data-run-open="n01-u01-a"]').click();
    await onFull(page, 'n01-u01-a');
    const frame = page.locator('[data-run-frame]');
    assert.equal(await frame.getAttribute('src'), '/run/n01-u01-a/#/n01_u01');
    await page.frameLocator('[data-run-frame]').locator('[data-hosted="n01-u01-a"]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-run-page-root]').count(), 0);
    await toggle(page).click();
    assert.equal((await page.locator('[data-run-full] [data-run-banner]').textContent()).trim(), RUN_BANNER, 'the Inspire menu still says it is only for testing');
    assert.equal(await page.locator('[data-run-full] [data-run-state]').textContent(), 'Ready');
    assert.equal(await page.locator('[data-run-no-token]').count(), 0, 'Inspire may act as this viewer');
    await backToInspire(page);
    await page.locator('[data-run-page="app:43:N02-U01"]').click();
    const open = page.locator('[data-run-open-app]');
    await open.waitFor();
    assert.deepEqual([await open.getAttribute('href'), await open.getAttribute('target'), (await open.textContent()).trim()],
      ['https://inspire-hub-acme.example.com', '_blank', 'Open App']);
    assert.equal(await page.locator('[data-run-frame]').count(), 0, 'an App of its own opens outside Inspire');
    assert.equal(await page.locator('[data-run-banner]').count(), 0);
    assert.equal(await page.locator('[data-run-full]').count(), 0, 'an App of its own never opens full window inside Inspire');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the chosen page panel is as tall as what it shows, never stretched to a long list beside it (must-exclude: the list keeps its own height)', async () => {
  const many = Array.from({ length: 14 }, (_, i) => registryRow(String(50 + i), `N03-U${String(i + 1).padStart(2, '0')}`, 1,
    { app: { state: 'ready' }, appName: `hub-${i}`, appUrl: `https://hub-${i}.example.com`, name: `Use case ${i + 1}` }));
  const scope = many.map((r, i) => ({ session_id: String(50 + i), use_case_id: `N03-U${String(i + 1).padStart(2, '0')}`, domain: 'Operations' }));
  const ui = await openRun({ registry: [...REGISTRY, ...many], useCaseScope: [...SCOPE, ...scope], hostedRun: hostedFake({ state: 'ready' }) },
    { 'x-forwarded-access-token': 'user-token', 'x-forwarded-email': OWNER });
  const { page } = ui;
  try {
    await page.locator('[data-run-banner]').waitFor({ timeout: 15000 });
    const sizes = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Deployed use cases"]');
      const panel = nav.nextElementSibling;
      const last = [...panel.children].pop();
      return { nav: nav.getBoundingClientRect().height, panel: panel.getBoundingClientRect().height,
        gap: panel.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom };
    });
    assert.ok(sizes.nav > sizes.panel + 100, JSON.stringify(sizes));
    assert.ok(sizes.gap <= 20, `the panel ends ${sizes.gap} px below what it shows`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Run shows a page that cannot start as Failed with its reason, the stderr lines only to an owner, and why it cannot open with no user authorization', async () => {
  const failed = { state: 'failed', error: 'the page stopped with exit code 1', stderr: ['Traceback (most recent call last):', 'ValueError: no pages'] };
  const owner = await openRun({ registry: REGISTRY, useCaseScope: SCOPE, hostedRun: hostedFake(failed) },
    { 'x-forwarded-access-token': 'user-token', 'x-forwarded-email': OWNER });
  try {
    await owner.page.locator('[data-run-state="failed"]').waitFor({ timeout: 15000 });
    assert.equal(await owner.page.locator('[data-run-state]').textContent(), 'Failed: the page stopped with exit code 1');
    assert.equal(await owner.page.locator('[data-run-stderr]').textContent(), 'Traceback (most recent call last):\nValueError: no pages');
    await owner.page.locator('[data-run-open="n01-u01-a"]').click();
    await onFull(owner.page, 'n01-u01-a');
    assert.equal(await owner.page.getByRole('status', { name: 'Run full window' }).textContent(), 'yes', 'the page tells its host it fills the window');
    assert.equal(await toggle(owner.page).getAttribute('aria-expanded'), 'true', 'a page that failed opens the Inspire menu so its reason shows');
    assert.equal(await owner.page.locator('[data-run-control-state]').textContent(), 'Failed');
    assert.equal(await owner.page.locator('[data-run-full] [data-run-stderr]').textContent(), 'Traceback (most recent call last):\nValueError: no pages');
  } finally {
    await owner.close();
  }
  const fake = hostedFake(failed);
  const viewer = await openRun({ registry: REGISTRY, useCaseScope: SCOPE, hostedRun: fake });
  try {
    await viewer.page.locator('[data-run-state="failed"]').waitFor({ timeout: 15000 });
    assert.deepEqual(fake.asked.at(-1), ['n01-u01-a', false], 'the server asks for the state as a person who does not own the use case');
    assert.equal(await viewer.page.locator('[data-run-stderr]').count(), 0, 'someone who does not own the use case never sees its stderr');
    assert.equal(await viewer.page.locator('[data-run-no-token]').textContent(), HOSTED_NO_TOKEN);
    await viewer.page.locator('[data-run-open="n01-u01-a"]').click();
    await onFull(viewer.page, 'n01-u01-a');
    assert.equal(await toggle(viewer.page).getAttribute('aria-expanded'), 'true');
    assert.equal(await viewer.page.locator('[data-run-full] [data-run-no-token]').textContent(), HOSTED_NO_TOKEN, 'the Inspire menu says why the page cannot open');
    assert.deepEqual(viewer.pageErrors, []);
  } finally {
    await viewer.close();
  }
});

test('with nothing deployed Run says how to put a page Inside Inspire from the Build wizard', async () => {
  const ui = await openRun({ registry: [], hostedRun: hostedFake({ state: 'stopped' }) });
  try {
    await ui.page.locator('[data-run-empty]').waitFor({ timeout: 15000 });
    assert.equal(await ui.page.locator('[data-run-empty]').textContent(), RUN_EMPTY);
    assert.match(RUN_EMPTY, /Vibe\/Add\/Remove Features, then Open all settings, and on App placement pick Inside Inspire/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the wizard offers Inside Inspire as not recommended, then locks per-user access, Delta tables and a warehouse, and sends a valid spec', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  const next = () => page.getByRole('button', { name: 'Next' }).click();
  try {
    await onStep(page, 'Choose');
    for (const step of ['Data', 'First run', 'Results', 'Delivery', 'App placement']) {
      await next();
      await onStep(page, step);
    }
    await page.getByText('Finding the Apps Inspire built').waitFor({ state: 'detached' });
    const card = page.locator('[data-app-place="inspire"]');
    assert.equal((await card.locator('[data-placement-tag]').textContent()).trim(), 'Not recommended, only for testing');
    assert.equal(await page.getByLabel('App name').count(), 1, 'a new App asks for its name');
    await page.getByRole('radio', { name: /^Inside Inspire/ }).check();
    await card.locator('[data-app-warehouse="pick"]').waitFor();
    assert.equal(await card.locator('[data-placement-blurb]').textContent(), INSIDE_BLURB);
    assert.equal(await card.getByText(INSIDE_WAREHOUSE_LABEL).count(), 1);
    assert.equal(await page.getByLabel('App name').count(), 0, 'no App name Inside Inspire');
    assert.equal(await page.locator('[data-app-list]').count(), 0, 'the list of existing Apps is hidden');
    assert.equal(await page.getByRole('radiogroup', { name: 'How Inspire organizes Apps' }).count(), 0);
    await next();
    await onStep(page, 'App access');
    assert.equal(await page.getByRole('radio', { name: /^Sensitive data/ }).isChecked(), true);
    assert.equal(await page.getByRole('radio', { name: /^Internal data/ }).isDisabled(), true);
    assert.equal(await page.getByRole('note', { name: 'Why each person signs in as themselves' }).textContent(), `${INSIDE_ACCESS_REASON}.`);
    assert.equal(await page.getByRole('radio', { name: /^Lakebase/ }).isDisabled(), true);
    assert.equal(await page.getByRole('note', { name: 'Why Lakebase is off' }).textContent(), INSIDE_BACKEND_REASON);
    await page.locator('[data-inside-warehouse]').waitFor();
    await startMvp(page);
    await until(() => made.jobs.length === 1, 'the build');
    const inserted = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
      .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));
    assert.equal(inserted.length, 1);
    const [sent] = inserted;
    assert.deepEqual([sent.outputs.app_placement, sent.outputs.app_access, sent.outputs.app_backend, sent.outputs.app_name, sent.outputs.app_warehouse_id,
      sent.outputs.merge.app], ['inspire', 'user', 'delta', '', 'wh1', '']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const inspireApp = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  hostedPage(app);
};

test('a #/run/<id> link opens the Run tab on that page, and a link to a page that is not there opens the plain Run tab with the reason', async () => {
  const cases = [
    ['#/run/n01-u01-a', null],
    ['#/run/n09-u09-x', 'Inspire has no page n09-u09-x Inside Inspire that you can open: it may be uninstalled, moved to an App of its own, or not shared with you. '
      + 'Here is every deployed use case.'],
    ['#/run/Not_An_Id', 'That link names no page Inside Inspire. Here is every deployed use case.'],
  ];
  for (const [hash, reason] of cases) {
    const missing = new Set();
    const ui = await openUi('app', { registry: REGISTRY, useCaseScope: SCOPE, hostedRun: hostedFake({ state: 'ready' }) }, hash, {
      mount: inspireApp,
      init: (page) => {
        page.on('response', (r) => { if (r.status() === 404) missing.add(new URL(r.url()).pathname); });
        return page.setExtraHTTPHeaders({ 'x-forwarded-access-token': 'user-token', 'x-forwarded-email': OWNER });
      },
    });
    const { page } = ui;
    try {
      if (reason) {
        await page.locator('[data-run-page-root]').waitFor({ timeout: 20000 });
        await page.locator('[data-run-domain]').first().waitFor({ timeout: 15000 });
        const active = await page.locator('header nav button', { hasText: 'Run' }).getAttribute('class');
        assert.ok(active.includes('text-db-red-fg'), `${hash}: the Run tab is the open one`);
        assert.equal(await page.locator('[data-run-unknown]').textContent(), reason, hash);
      } else {
        await onFull(page, 'n01-u01-a');
        assert.equal(await page.locator('[data-run-frame]').getAttribute('src'), '/run/n01-u01-a/#/n01_u01');
        assert.equal(await page.locator('header').count(), 0, `${hash}: the link opens the page full window, with no Inspire header over it`);
        await backToInspire(page);
        assert.equal(await page.locator('[data-run-unknown]').count(), 0, hash);
        assert.equal(await page.locator('[data-run-page="inspire:n01-u01-a"]').getAttribute('aria-current'), 'true');
        const active = await page.locator('header nav button', { hasText: 'Run' }).getAttribute('class');
        assert.ok(active.includes('text-db-red-fg'), `${hash}: Back to Inspire lands on the Run tab`);
      }
      assert.deepEqual([...missing], [], `${hash}: nothing the App asks for is missing`);
      assert.deepEqual(ui.pageErrors, [], hash);
    } finally {
      await ui.close();
    }
  }
});

const MOVE_NOTE = "churn-desk is left as it is and no longer refreshed; Inspire runs this use case's page in its Run tab instead and deletes nothing.";

async function toPlacement(page) {
  await onStep(page, 'Choose');
  for (const step of ['Data', 'First run', 'Results', 'Delivery', 'App placement']) {
    await page.getByRole('button', { name: 'Next' }).click();
    await onStep(page, step);
  }
}

test('a use case with its own App can move its page Inside Inspire: the wizard says the App is left as it is before the build, and Keep it goes back', async () => {
  const ui = await openUi('wizard', { ...STUDIO_STATE, me: { userName: OWNER, displayName: 'Owner' } }, '', {
    init: (page) => page.setExtraHTTPHeaders({ 'x-forwarded-host': 'inspire.example.com' }),
  });
  const { page, made } = ui;
  try {
    await toPlacement(page);
    const keep = page.locator('[data-app-place="held"]');
    assert.equal(await keep.getByRole('radio').isChecked(), true, 'the App it has is kept unless you choose otherwise');
    assert.equal((await keep.textContent()).includes('Keep it in churn-desk'), true);
    await page.getByRole('radio', { name: /^Inside Inspire/ }).check();
    const note = page.getByRole('note', { name: 'What happens to the App it has now' });
    assert.equal(await note.textContent(), MOVE_NOTE);
    await keep.getByRole('radio').check();
    assert.equal(await note.count(), 0);
    assert.equal(await page.getByLabel('App name').inputValue(), 'churn-desk', 'Keep it puts the App back');
    await page.getByRole('radio', { name: /^Inside Inspire/ }).check();
    await note.waitFor();
    await toVibes(page);
    await page.locator('[data-plan-move-note]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-plan-move-note]').textContent(), MOVE_NOTE, 'the wizard says it again right before Start MVP');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start MVP' && !b.disabled), null, { timeout: 15000 });
    await page.getByRole('button', { name: 'Start MVP', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the build');
    const [sent] = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
      .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));
    assert.deepEqual([sent.outputs.app_placement, sent.outputs.app_name, sent.outputs.merge.app, sent.outputs.inspire_url],
      ['inspire', '', '', 'https://inspire.example.com'], 'the page moves Inside Inspire and the weekly email can link to it');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a use case whose page sits in an App shared with others says that App keeps what Inspire built there when the page moves Inside Inspire', async () => {
  const spec = builtSpec();
  const joined = built({ app_name: 'inspire-hub-acme', app_url: 'https://inspire-hub-acme-1.aws.databricksapps.com',
    spec_json: JSON.stringify({ ...spec, outputs: { ...spec.outputs, app_name: 'inspire-hub-acme', merge: { dashboard: '', genie_space: '', app: 'inspire-hub-acme' } } }) });
  const ui = await openUi('wizard', { ...STUDIO_STATE, history: [joined], me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    await toPlacement(page);
    await page.getByRole('radio', { name: /^Inside Inspire/ }).check();
    const note = page.getByRole('note', { name: 'What happens to the App it has now' });
    assert.match(await note.textContent(), /^inspire-hub-acme (is shared with other use cases|also holds the pages of .+), so it keeps what Inspire built there for this use case; /);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const VIEWER_HEADERS = { 'x-forwarded-access-token': 'user-token', 'x-forwarded-email': OWNER };
const runState = () => ({ registry: REGISTRY, useCaseScope: SCOPE, hostedRun: hostedFake({ state: 'ready' }) });
const onRunPage = (page, id) => onFull(page, id);
const address = (page) => page.evaluate(() => [window.location.search, window.location.hash]);
const toResults = async (page) => {
  await page.locator('header nav button', { hasText: 'Review' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-run-page-root]'));
};

test('the email link ?run=<id> that a sign-in keeps opens its page on the Run tab, the address turns into #/run/<id>, and leaving the Run tab clears it', async () => {
  const ui = await openUi('app', runState(), '&run=n01-u01-a', { mount: inspireApp, init: (page) => page.setExtraHTTPHeaders(VIEWER_HEADERS) });
  const { page } = ui;
  try {
    await onRunPage(page, 'n01-u01-a');
    assert.deepEqual(await address(page), ['?open=app', '#/run/n01-u01-a'], 'the run query is gone and the hash names the page');
    assert.equal(await page.locator('[data-run-frame]').getAttribute('src'), '/run/n01-u01-a/#/n01_u01');
    await page.reload();
    await onRunPage(page, 'n01-u01-a');
    await backToInspire(page);
    await page.waitForFunction(() => window.location.hash === '');
    await page.locator('[data-run-page="app:43:N02-U01"]').click();
    await page.locator('[data-run-open-app]').waitFor();
    assert.equal(await page.evaluate(() => window.location.hash), '');
    await page.locator('[data-run-page="inspire:n01-u01-a"]').click();
    await onRunPage(page, 'n01-u01-a');
    await page.waitForFunction(() => window.location.hash === '#/run/n01-u01-a');
    await backToInspire(page);
    assert.deepEqual(ui.pageErrors, []);
    await toResults(page);
    await page.waitForFunction(() => window.location.hash === '');
    await page.reload();
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-run-page-root]').count(), 0, 'a reload after leaving the Run tab opens the home page, not the Run tab');
  } finally {
    await ui.close();
  }
});

test('a second run link in a tab that is already open moves the Run tab to that page, from the Run tab and from any other tab', async () => {
  const ui = await openUi('app', runState(), '#/run/n01-u01-a', { mount: inspireApp, init: (page) => page.setExtraHTTPHeaders(VIEWER_HEADERS) });
  const { page } = ui;
  try {
    await onRunPage(page, 'n01-u01-a');
    await page.evaluate(() => { window.location.hash = '#/run/n09-u09-x'; });
    await page.locator('[data-run-unknown]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-run-unknown]').textContent(), 'Inspire has no page n09-u09-x Inside Inspire that you can open: it may be '
      + 'uninstalled, moved to an App of its own, or not shared with you. Here is every deployed use case.');
    assert.deepEqual(ui.pageErrors, []);
    await toResults(page);
    await page.evaluate(() => { window.location.hash = '#/run/n01-u01-a'; });
    await onRunPage(page, 'n01-u01-a');
    assert.deepEqual(await address(page), ['?open=app', '#/run/n01-u01-a']);
    await backToInspire(page);
    assert.equal(await page.locator('[data-run-unknown]').count(), 0);
  } finally {
    await ui.close();
  }
});

const SETUP_FIRST = { isDatabricksApp: false, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1', inspireDatabase: 'main.inspire' };

test('a run link opened before Inspire is set up waits through setup and then opens its page on the Run tab', async () => {
  const ui = await openUi('app', runState(), '&run=n01-u01-a', {
    mount: (app) => {
      app.get('/api/defaults', (_req, res) => res.json(SETUP_FIRST));
      app.get('/api/showcase', (_req, res) => res.json({}));
      hostedPage(app);
    },
    init: (page) => page.setExtraHTTPHeaders(VIEWER_HEADERS),
  });
  const { page } = ui;
  try {
    const skip = page.getByRole('button', { name: 'Skip setup' });
    await skip.waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-run-page-root]').count(), 0, 'setup comes first');
    assert.deepEqual(await address(page), ['?open=app', '#/run/n01-u01-a'], 'the link waits in the address while setup shows');
    await skip.click();
    await onRunPage(page, 'n01-u01-a');
  } finally {
    await ui.close();
  }
});

const VH_PAGE = '<!doctype html><title>Hosted</title><style>html,body{margin:0}</style><div data-vh style="height:100vh"></div>';
const sizedApp = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/run/:id/{*rest}', (_req, res) => res.type('html').send(VH_PAGE));
};
const windowOf = (el) => ({ w: window.innerWidth, h: window.innerHeight, vh: Math.round(el.getBoundingClientRect().height) });

for (const [width, height] of [[1440, 900], [1920, 1080]]) {
  test(`at ${width}x${height} an Inside Inspire page fills the whole window, the same size as the page opened on its own, with no Inspire frame around it`, async () => {
    const ui = await openUi('app', runState(), '#/run/n01-u01-a', {
      mount: sizedApp,
      init: async (page) => {
        await page.setViewportSize({ width, height });
        await page.setExtraHTTPHeaders(VIEWER_HEADERS);
      },
    });
    const { page } = ui;
    try {
      await onFull(page, 'n01-u01-a');
      const inside = page.frameLocator('[data-run-frame]').locator('[data-vh]');
      await inside.waitFor({ timeout: 15000 });
      const host = await page.evaluate(() => {
        const frame = document.querySelector('[data-run-frame]');
        const r = frame.getBoundingClientRect();
        const capped = [];
        for (let el = frame; el; el = el.parentElement) {
          const s = getComputedStyle(el);
          if (s.maxWidth !== 'none' || s.maxHeight !== 'none' || s.gridTemplateColumns !== 'none') capped.push(`${el.tagName} ${el.className}`);
        }
        const root = document.scrollingElement;
        return {
          box: [r.left, r.top, r.width, r.height], capped, scroll: [root.scrollWidth, root.scrollHeight], client: [root.clientWidth, root.clientHeight],
          list: document.querySelectorAll('[data-run-page-root]').length, header: document.querySelectorAll('header').length, cls: frame.className,
        };
      });
      const framed = await inside.evaluate(windowOf);
      await page.goto(`${ui.origin}/run/n01-u01-a/#/n01_u01`);
      const standalone = await page.locator('[data-vh]').evaluate(windowOf);
      assert.deepEqual(standalone, { w: width, h: height, vh: height }, 'the page opened on its own fills the window');
      assert.deepEqual(framed, standalone, 'Inside Inspire the page sees the same window, and its 100vh is the real window height');
      assert.deepEqual(host.box, [0, 0, width, height], 'the frame covers the whole window');
      assert.deepEqual(host.capped, [], 'no max-width wrapper, use case column or height cap sits around the frame');
      assert.doesNotMatch(host.cls, /72vh|max-w/);
      assert.deepEqual(host.scroll, host.client, 'Inspire itself does not scroll, so there is never a second scrollbar');
      assert.deepEqual([host.list, host.header], [0, 0], 'the Run list and the Inspire header are not drawn behind the page');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

const SECOND = { ...hostedRecord, id: 'n03-u01-b', page: 'n03_u01', version: 1 };
const TWO_PAGES = {
  registry: [...REGISTRY, registryRow('44', 'N03-U01', 1, { app: { placement: 'inspire', hosted: SECOND, app_name: '', app_url: '' }, name: 'Plan routes' })],
  useCaseScope: [...SCOPE, { session_id: '44', use_case_id: 'N03-U01', domain: 'Operations' }],
  hostedRun: hostedFake({ state: 'ready' }),
};
const hashOf = (page) => page.evaluate(() => window.location.hash);
const switchItems = (page) => page.getByRole('navigation', { name: 'Switch use case' }).locator('[data-run-switch]')
  .evaluateAll((els) => els.map((e) => [e.dataset.runSwitch, e.getAttribute('aria-current')]));

test('full window, the Inspire menu switches use case, opens the page in a new tab and goes back to Inspire, and browser back and forward move between them', async () => {
  const ui = await openUi('app', TWO_PAGES, '#/run/n01-u01-a', { mount: inspireApp, init: (page) => page.setExtraHTTPHeaders(VIEWER_HEADERS) });
  const { page } = ui;
  try {
    await onFull(page, 'n01-u01-a');
    assert.equal(await toggle(page).getAttribute('aria-expanded'), 'false', 'a ready page starts with the menu folded away');
    assert.equal(await toggle(page).getAttribute('aria-label'), 'Inspire menu: back to Inspire, switch use case, or open in a new tab');
    await toggle(page).click();
    assert.deepEqual(await switchItems(page), [['inspire:n03-u01-b', null], ['inspire:n01-u01-a', 'true']],
      'every page Inside Inspire is one click away, in the order the Run list shows them');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[data-run-control-toggle]').getAttribute('aria-expanded') === 'false');
    await toggle(page).click();
    await page.locator('[data-run-switch="inspire:n03-u01-b"]').click();
    await onFull(page, 'n03-u01-b');
    assert.equal(await page.locator('[data-run-frame]').getAttribute('src'), '/run/n03-u01-b/#/n03_u01');
    await page.frameLocator('[data-run-frame]').locator('[data-hosted="n03-u01-b"]').waitFor({ timeout: 15000 });
    assert.equal(await hashOf(page), '#/run/n03-u01-b', 'the address names the page shown, so it can be shared');
    assert.equal(await toggle(page).getAttribute('aria-expanded'), 'false');

    await toggle(page).click();
    const link = page.locator('[data-run-full] [data-run-new-tab="n03-u01-b"]');
    assert.deepEqual([await link.getAttribute('href'), await link.getAttribute('target')], ['/run/n03-u01-b/#/n03_u01', '_blank']);
    const [tab] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
    await tab.locator('[data-hosted="n03-u01-b"]').waitFor({ timeout: 15000 });
    assert.equal(new URL(tab.url()).pathname, '/run/n03-u01-b/', 'the new tab holds the page alone, the way an App of its own shows it');
    await tab.close();

    await backToInspire(page);
    assert.equal(await hashOf(page), '');
    assert.equal(await page.locator('[data-run-page="inspire:n03-u01-b"]').getAttribute('aria-current'), 'true', 'Inspire shows the page you came back from');
    assert.equal(await page.locator('header').count(), 1);
    await page.goBack();
    await onFull(page, 'n03-u01-b');
    assert.equal(await hashOf(page), '#/run/n03-u01-b', 'browser back returns to the page');
    await page.goForward();
    await page.locator('[data-run-page-root]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-run-full]').count(), 0, 'browser forward returns to the Run list');

    await page.locator('[data-run-page="inspire:n01-u01-a"]').click();
    await onFull(page, 'n01-u01-a');
    assert.equal(await hashOf(page), '#/run/n01-u01-a');
    await page.goBack();
    await page.locator('[data-run-page-root]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-run-full]').count(), 0, 'browser back from a page opened from the list closes it');
    assert.equal(await hashOf(page), '');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
