import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_INSPIRE_URL, HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { BUILD_IT, closeAsset, closeBrowser, expandBuild, goToStep, lowContrast, openAsset, openSettings, openUi, toSummary, until } from './uiSupport.mjs';

const SELF_FIX = createRequire(import.meta.url)('../../../backend/test/fixtures/implement_self_fix_cases.json');
const HELD_CASES = createRequire(import.meta.url)('../../../backend/test/fixtures/implement_held_cases.json');
const heldCase = (prefix) => HELD_CASES.cases.find((c) => c.name.startsWith(prefix));

const OWNER = ['owner', 'example.com'].join('@');
const VIBE = 'Put the riskiest customers first';
test.after(closeBrowser);

const builtSpec = (top = {}) => {
  const spec = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return { ...spec, ...top, outputs: { ...spec.outputs, dashboard: true, inspire_url: HARNESS_INSPIRE_URL } };
};
const ready = (version) => ({ state: 'ready', spec_version: version });

const versionRow = (version, status, { top = {}, assets = { dashboard: ready(1), notebook: ready(1) }, ...extra } = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: version, status, change_classes: version === 1 ? 'initial' : 'vibe', created_by: OWNER,
  updated_at: `2026-10-2${version}T04:00:00Z`, spec_json: JSON.stringify(builtSpec(top)), job_id: '77', last_preview_run_id: '9001', result_rows: '3',
  notebook_path: '/Users/owner@example.com/inspire/Acme_implemented/N01-U01',
  dashboard_id: 'd1', dashboard_url: 'https://workspace.example.com/dashboardsv3/d1/published',
  asset_status: JSON.stringify(assets),
  ...extra,
});

const PAGE = 'app:page:n01_u01';
const UNCHECKED = 'Inspire could not check this ask: the App page did not load in time. Nothing shows the ask was missed: press Try again to check it again';
const MISSED_FACT = 'The answers are in dollars';
const ENTRIES = {
  met: { n: 1, requirement: VIBE, part: PAGE, where: 'records', status: 'met', evidence: 'The decision list sorts by risk', rounds: 1, tried: [], checks: [], published_anyway: null },
  missed: { n: 2, requirement: 'Answer in euros', part: 'genie_space', where: '', status: 'not_met', evidence: MISSED_FACT, rounds: 3,
    tried: ['round 3: Asked Genie to answer in euros'], checks: [], published_anyway: null },
  unchecked: { n: 3, requirement: 'Count returns by week', part: 'notebook', where: 'result table', status: 'not_met', unchecked: true, evidence: UNCHECKED, rounds: 3,
    tried: [], checks: [], published_anyway: null },
};
const unmetSentence = (version, entries) => {
  const open = entries.filter((e) => e.status === 'not_met');
  const listed = open.map((e) => `${e.part}: ${e.requirement}: ${e.unchecked ? 'Inspire could not check this ask' : `Genie could not do it in ${e.rounds} build rounds: ${e.evidence}`}`).join('; ');
  const again = open.some((e) => e.unchecked) ? '. Press Try again to check the unchecked asks again' : '';
  return `v${version} is published with ${open.length} unmet ask${open.length === 1 ? '' : 's'} (not met or could not be checked), the rest of the vibe is in place: ${listed}${again}`;
};
const liveAssets = (version) => ({ notebook: ready(version), dashboard: ready(version), genie_space: ready(version), app: ready(version),
  [PAGE]: { ...ready(version), name: 'Decisions' } });
const mvpSpec = (top = {}, outputs = {}) => {
  const spec = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return { ...spec, ...top, outputs: { ...spec.outputs, dashboard: true, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', app_backend: 'delta', alert: false,
    inspire_url: HARNESS_INSPIRE_URL, ...outputs } };
};
const SENT = mvpSpec({ vibes: `${VIBE}\nAnswer in euros\nCount returns by week`, vibe_previous: 'keep', based_on_version: 1, retry_outputs: ['dashboard'],
  confirm_notebook_overwrite: true }, { dashboard_vibes: 'Weekly bars' });
const STORED = {
  ...SENT,
  outputs: { ...SENT.outputs, dashboard_vibes: `Weekly bars\n${VIBE}`, [`${PAGE}_vibes`]: VIBE, genie_space_vibes: 'Answer in euros' },
  data: { ...SENT.data, notes: 'Count returns by week' },
  retry_outputs: ['dashboard', PAGE, 'genie_space'],
};
const mvpRow = (version, status, { spec = mvpSpec(), assets = liveAssets(1), ...extra } = {}) => versionRow(version, status, {
  spec_json: JSON.stringify(spec), asset_status: JSON.stringify(assets), genie_space_id: 'g1', genie_space_url: 'https://workspace.example.com/genie/rooms/g1',
  app_name: 'churn-desk', app_url: 'https://churn-desk-1.aws.example.com', ...extra,
});
const publishedMvp = (checklist, { version = 2, sentence = unmetSentence(version, checklist) } = {}) => mvpRow(version, 'ready_with_warnings', {
  spec: STORED,
  assets: { ...liveAssets(version - 1), checklist, checklist_summary: { met: checklist.filter((e) => e.status === 'met').length, total: checklist.length } },
  status_message: sentence,
});
const APP = { name: 'churn-desk', description: 'Inspire use case N01-U01 (session 42): Predict churn', compute_status: { state: 'ACTIVE' }, app_status: { state: 'RUNNING' } };
const mvpState = (checklist = [ENTRIES.met, ENTRIES.missed], version = 2) => ({
  history: [publishedMvp(checklist, { version }), mvpRow(1, 'ready')], appExists: true, app: APP, me: { userName: OWNER, displayName: 'Owner' },
});
const insertsOf = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));

function leafDiff(want, got, at = []) {
  if (want && typeof want === 'object' && !Array.isArray(want)) return Object.keys(want).flatMap((key) => leafDiff(want[key], got?.[key], [...at, key]));
  return JSON.stringify(want) === JSON.stringify(got) ? [] : [at.join('.')];
}

const progressLine = (page) => page.locator('[data-mvp-progress]').evaluate((box) => {
  const line = box.cloneNode(true);
  line.querySelector('[data-build-log]')?.remove();
  return line.textContent;
});

async function openPublished(state, version = 2) {
  const ui = await openUi('implement', state);
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(ui.page);
    await checklistOf(ui.page, version).waitFor({ timeout: 15000 });
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

const checklistOf = (page, version = 2) => page.getByRole('region', { name: `Vibe checklist of v${version}`, exact: true });
const rowsOf = (page, version = 2) => checklistOf(page, version).locator('[data-requirement]');

const bodiesTo = (page, route) => {
  const sent = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === route) sent.push(JSON.parse(req.postData() || '{}'));
  });
  return sent;
};
const times = (text, phrase) => text.split(phrase).length - 1;

test('a version with unmet asks is published with warnings: the rail lists it under vibes not met and the sentence names each ask once', async () => {
  const ui = await openUi('implement', { history: [publishedMvp([ENTRIES.met, ENTRIES.missed]), mvpRow(1, 'ready')] });
  const { page } = ui;
  try {
    const nav = page.getByRole('navigation', { name: 'Use cases' });
    await nav.getByText('Predict churn').first().waitFor({ timeout: 15000 });
    assert.equal(await nav.getByRole('region', { name: 'Ready', exact: true }).getByText('Predict churn').count(), 0, 'not listed as Ready');
    await expandBuild(page);
    await checklistOf(page).waitFor({ timeout: 15000 });
    const said = await progressLine(page);
    assert.ok(times(said, 'is published with 1 unmet ask') >= 1, `the sentence shows in the progress panel: ${said}`);
    assert.ok(times(said, 'Answer in euros') >= 1, said);
    for (const phrase of ['Publish anyway', 'Rephrase', 'Try again to check']) assert.equal(times(said, phrase), 0, `${phrase} is not offered for a missed ask: ${said}`);
    assert.equal(await page.getByRole('button', { name: 'Publish anyway', exact: true }).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a first build with an unmet ask is published with warnings and never says nothing is live', async () => {
  const first = mvpRow(1, 'ready_with_warnings', { spec: STORED, assets: { ...liveAssets(0), checklist: [ENTRIES.missed] }, dashboard_id: null, dashboard_url: null,
    status_message: unmetSentence(1, [ENTRIES.missed]) });
  const ui = await openUi('implement', { history: [first] });
  const { page } = ui;
  try {
    await expandBuild(page);
    await checklistOf(page, 1).waitFor({ timeout: 15000 });
    const said = await progressLine(page);
    assert.equal(times(said, 'nothing is live yet'), 0, said);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a version whose only open ask could not be checked lists it as could not be checked, not as missed, with no action buttons in its checklist', async () => {
  const ui = await openPublished(mvpState([ENTRIES.met, ENTRIES.unchecked]));
  const { page } = ui;
  try {
    assert.deepEqual(await rowsOf(page).evaluateAll((rows) => rows.map((r) => r.dataset.requirement)), ['met', 'unchecked']);
    const row = rowsOf(page).nth(1);
    assert.equal(await row.locator('[data-requirement-status]').textContent(), `Could not be checked after 3 rounds. ${UNCHECKED}.`);
    assert.equal(await checklistOf(page).locator('[data-checklist-headline]').textContent(), '1 of 2 vibe requirements met');
    assert.equal(await checklistOf(page).getByRole('button', { name: /^(Rephrase|Try again|Publish anyway)$/ }).count(), 0, 'no action button inside the checklist');
    assert.equal(await page.getByRole('button', { name: 'Publish anyway', exact: true }).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a version whose open asks were all missed lists each as not met with its reason, and offers no rephrase or publish action', async () => {
  const ui = await openPublished(mvpState([ENTRIES.met, ENTRIES.missed]));
  const { page } = ui;
  try {
    assert.deepEqual(await rowsOf(page).evaluateAll((rows) => rows.map((r) => r.dataset.requirement)), ['met', 'not_met']);
    assert.equal(await rowsOf(page).nth(1).locator('[data-requirement-status]').textContent(), `Not met after 3 rounds. ${MISSED_FACT}.`);
    assert.equal(await checklistOf(page).getByRole('button', { name: /^(Rephrase|Try again|Publish anyway)$/ }).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a version with a missed ask and one Inspire could not check lists both, and the sentence names each ask once', async () => {
  const checklist = [ENTRIES.met, ENTRIES.missed, ENTRIES.unchecked];
  const ui = await openPublished(mvpState(checklist));
  const { page } = ui;
  try {
    assert.deepEqual(await rowsOf(page).evaluateAll((rows) => rows.map((r) => r.dataset.requirement)), ['met', 'not_met', 'unchecked']);
    const said = await progressLine(page);
    assert.ok(times(said, 'Answer in euros') >= 1, said);
    assert.ok(times(said, 'Count returns by week') >= 1, said);
    assert.ok(times(said, 'is published with 2 unmet asks (not met or could not be checked)') >= 1, `the sentence shows in the progress panel: ${said}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a change no ask made shows the put-back element in green and the unasked change in red, with no held state', async () => {
  const agent = SELF_FIX.cases.find((c) => c.name.startsWith('A held v2'));
  const [fixed, changed] = agent.entries;
  const checklist = [ENTRIES.met, { ...fixed, n: 2 }, { ...changed, n: 3 }];
  const row = mvpRow(2, 'ready_with_warnings', { spec: STORED, assets: { ...liveAssets(1), checklist }, status_message: agent.held_reason });
  const ui = await openPublished({ ...mvpState(), history: [row, mvpRow(1, 'ready')] });
  const { page } = ui;
  try {
    assert.deepEqual(await rowsOf(page).evaluateAll((rows) => rows.map((r) => r.dataset.requirement)), ['met', 'self_fixed', 'unrequested']);
    const [, back, unasked] = [0, 1, 2].map((i) => rowsOf(page).nth(i));
    assert.equal(await back.locator('p').first().textContent(), `Put back by Inspire: “${fixed.requirement}”`);
    assert.match(await back.locator('span[aria-hidden]').first().getAttribute('class'), /\bbg-success-bg\b/);
    assert.equal(await unasked.locator('p').first().textContent(), `Changed with no ask: “${changed.requirement}”`);
    assert.match(await unasked.locator('span[aria-hidden]').first().getAttribute('class'), /\bbg-error-bg\b/);
    assert.equal(await page.locator('[aria-label="v2 is held"]').count(), 0, 'no held panel');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a published version offers no Publish anyway, Rephrase or Try again, and the page posts to no publish route', async () => {
  const ui = await openPublished(mvpState([ENTRIES.met, ENTRIES.missed, ENTRIES.unchecked]));
  const { page, made } = ui;
  const publish = bodiesTo(page, '/api/inspire/implement/publish');
  try {
    for (const name of ['Publish anyway', 'Rephrase', 'Try again']) {
      assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `${name} is gone`);
    }
    assert.deepEqual([publish.length, made.jobs.length], [0, 0], 'nothing is sent or started');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Open all settings on a version with unmet asks: with nothing changed Build it Now stays off, and a changed leaf is the one thing sent', async () => {
  const ui = await openPublished(mvpState([ENTRIES.met, ENTRIES.missed]));
  const { page, made } = ui;
  const sent = bodiesTo(page, '/api/inspire/implement/submit');
  try {
    await openSettings(page);
    await toSummary(page);
    const build = page.getByRole('button', { name: BUILD_IT, exact: true });
    await build.waitFor({ timeout: 15000 });
    assert.equal(await build.isDisabled(), true, 'the spec is the one already built, so there is nothing to build');
    assert.deepEqual([sent.length, made.jobs.length], [0, 0], 'nothing is sent or started');
    await goToStep(page, 'Vibes');
    const vibe = page.getByRole('region', { name: 'Vibes', exact: true }).getByRole('textbox', { name: 'Vibes for the MVP', exact: true });
    await vibe.fill(`${VIBE}\nAnswer in euros\nCount returns by week\nKeep the list to ten rows`, { timeout: 15000 });
    await toSummary(page);
    await page.getByRole('button', { name: BUILD_IT, exact: true }).click({ timeout: 15000 });
    await until(() => made.jobs.length === 1, 'the changed run');
    assert.equal(sent.length, 1);
    const diff = leafDiff(STORED, sent[0].spec).filter((key) => !['based_on_version', 'confirm_notebook_overwrite', 'retry_outputs'].includes(key));
    assert.deepEqual(diff, ['vibes'], `only the changed leaf is sent, the one-version keys are the wizard's: ${JSON.stringify(diff)}`);
    assert.match(sent[0].spec.vibes ?? sent[0].spec.outputs?.vibes ?? '', /Keep the list to ten rows/, 'the new vibe line is what was sent');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
test('what Genie tried names the round the agent wrote on each line, once, also when an ask was met in round 2 of 3', async () => {
  const c = heldCase('an ask met in round 2 of 3');
  assert.deepEqual(c.entries.map((e) => e.tried.map((line) => line.split(':')[0])), [['round 1', 'round 3'], ['round 1', 'round 2', 'round 3'], []],
    HELD_CASES.source);
  const entries = c.entries.map((e, i) => ({ n: i + 1, requirement: e.requirement, part: e.part || 'dashboard', where: '', status: e.status, evidence: e.evidence,
    rounds: e.rounds || 0, tried: e.tried, checks: [], published_anyway: null, unchecked: e.unchecked }));
  const row = mvpRow(3, 'ready_with_warnings', { spec: mvpSpec({}, {}), assets: { ...liveAssets(2), checklist: entries }, status_message: unmetSentence(3, entries) });
  const ui = await openPublished({ ...mvpState(), history: [row, mvpRow(2, 'ready')] }, 3);
  const { page } = ui;
  try {
    const rows = rowsOf(page, 3);
    const tried = (i) => rows.nth(i).getByRole('list', { name: 'What Genie tried' }).getByRole('listitem').allTextContents();
    assert.deepEqual(await tried(0), ['Round 1: the chart sorts by name', 'Round 3: the top 10 moved below the trend chart'],
      'round 2 met the ask, so it is not listed, and round 3 keeps its own number');
    assert.equal(await rows.nth(2).getByRole('list', { name: 'What Genie tried' }).count(), 0, 'the met ask lists nothing tried');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
