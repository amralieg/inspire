import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FAKE_CLOCK, closeBrowser, holdClock, openUi, until } from './uiSupport.mjs';
import { OUTPUT_CHECK_DELAY_MS, OUTPUT_CHECK_URL, outputCheckRequest, outputCheckVerdict } from '../../src/lib/outputFolderCheck.js';

test.after(closeBrowser);

const SHOTS = process.env.LAUNCH_SHOTS || '';
const MINE = '/Workspace/Users/someone@example.com/inspire_out';
const BOSS_FOLDER = '/Workspace/Shared/team_out';
const BOSS_DEFAULT = '/Workspace/Users/boss@example.com/inspire_output';
const FALLBACK = '/Workspace/fallback';
const FALLBACK_SENTENCE = 'Inspire cannot save to your own folder /Users/boss@example.com/inspire_output, so it saves to /Shared/demos, a shared folder that everyone in the workspace can open.';
const FALLBACK_GRANT = 'PATCH /api/2.0/permissions/directories/42 {"access_control_list":[{"service_principal_name":"app-sp","permission_level":"CAN_MANAGE"}]} answered HTTP 403: refused';
const REFUSAL = 'You cannot write to /Shared/demos (you cannot create anything in /Shared) with your own sign-in, and Inspire never writes for you '
  + 'where you cannot write: choose a folder you can manage, such as one under your own user folder, or ask its owner for CAN MANAGE on it, '
  + 'which Databricks needs before anyone can create something in a folder.';
const notFound = (errors) => errors.filter((e) => !/status of (403|404|502)/.test(e));

function folderBackend() {
  const calls = { checks: [], urls: [], runs: 0 };
  const mount = (app) => {
    app.post('/api/output-folder/check', (req, res) => {
      const asked = String((req.body || {}).generation_path || '');
      calls.checks.push(asked);
      calls.urls.push(req.originalUrl);
      if (asked === MINE) return res.json({ allowed: true, folder: '/Users/someone@example.com/inspire_out', checked: 'passed' });
      if (asked === BOSS_FOLDER) return res.json({ allowed: true, folder: '/Shared/team_out', checked: 'manager' });
      if (asked === BOSS_DEFAULT) return res.json({ allowed: true, folder: '/Users/boss@example.com/inspire_output', checked: 'manager', warnings: [] });
      if (asked === FALLBACK) {
        return res.json({ allowed: true, folder: '/Shared/demos', checked: 'manager', warnings: [FALLBACK_SENTENCE], warning_details: [FALLBACK_GRANT] });
      }
      if (asked === '/Workspace/broken') return res.status(502).json({ error: 'Inspire could not check that you can write to /broken, so it starts no run: upstream timeout', unwritable: [] });
      return res.status(403).json({ error: REFUSAL, policy: { route: 'POST /api/output-folder/check', rule: 'writer' }, unwritable: ['/Shared/demos'] });
    });
    app.post('/api/run', (_req, res) => {
      calls.runs += 1;
      if (calls.checks.at(-1) === FALLBACK) return res.json({ run_id: 901, warnings: [FALLBACK_SENTENCE], warning_details: [FALLBACK_GRANT] });
      res.json({ run_id: 901 });
    });
  };
  return { calls, mount };
}

async function shoot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function readyToLaunch(page) {
  await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme Retail');
  await page.locator('button[title="main"]').first().click();
}

const launchButton = (page) => page.getByRole('button', { name: 'Get Started' });
const nearLaunch = (page) => page.locator('#output-folder-check-launch');

async function setPath(page, value) {
  const field = page.getByLabel('Generation Path');
  await holdClock(page);
  await field.fill('');
  await field.pressSequentially(value);
  await page.clock.runFor(OUTPUT_CHECK_DELAY_MS);
  await page.clock.resume();
}

test('a folder the person cannot write keeps Get Started off and shows the refusal next to it, and a folder they can write turns it on', async () => {
  const { calls, mount } = folderBackend();
  const ui = await openUi('launch', {}, '', { mount, ...FAKE_CLOCK });
  try {
    const { page } = ui;
    await readyToLaunch(page);
    assert.equal(await launchButton(page).isDisabled(), true, 'Get Started is off while the folder is checked or refused');
    await nearLaunch(page).waitFor({ timeout: 15000 });
    await until(async () => (await nearLaunch(page).getAttribute('data-output-check')) === 'refused', 'the refusal next to Get Started');
    assert.equal(await nearLaunch(page).getByText(REFUSAL, { exact: true }).count(), 1);
    assert.match(await nearLaunch(page).innerText(), /Get Started stays off until the output folder check passes\. Change Generation Path in Advanced Settings above\./);
    assert.equal(await page.getByRole('button', { name: /Advanced Settings/ }).getAttribute('aria-expanded'), 'true', 'the refusal opens Advanced Settings');
    assert.equal(await launchButton(page).isDisabled(), true, 'Get Started is off while the folder is refused');
    assert.deepEqual(calls.checks, [''], 'the default folder is checked once, left blank so the App picks the person\'s own folder');
    assert.deepEqual(calls.urls, ['/api/output-folder/check'], 'the default path travels in the body, never in the URL');
    for (const [width, height] of [[1440, 1000], [390, 900]]) {
      await page.setViewportSize({ width, height });
      await nearLaunch(page).scrollIntoViewIfNeeded();
      await shoot(page, `launch-refused-${width}`);
      const box = await nearLaunch(page).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `the refusal fits at ${width} px`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    const typedBefore = calls.checks.length;
    await setPath(page, MINE);
    await until(async () => (await page.locator('#output-folder-check-field').getAttribute('data-output-check')) === 'passed', 'the passed check under the field');
    assert.equal(calls.checks.length - typedBefore, 1, `typing the path asks once, after it settles: ${JSON.stringify(calls.checks.slice(typedBefore))}`);
    assert.equal(calls.checks.at(-1), MINE);
    assert.equal(await page.locator('#output-folder-check-field').innerText(), 'Results go to /Users/someone@example.com/inspire_out.');
    assert.equal(await nearLaunch(page).count(), 0, 'nothing blocks Get Started any more');
    assert.equal(await launchButton(page).isDisabled(), false);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('#output-folder-check-field').scrollIntoViewIfNeeded();
      await shoot(page, `launch-passed-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await launchButton(page).click();
    await until(() => calls.runs === 1, 'the launch');
    assert.deepEqual([...new Set(calls.urls)], ['/api/output-folder/check']);
    assert.deepEqual(notFound(ui.pageErrors), []);
  } finally {
    await ui.close();
  }
});

test('changing a passed folder turns Get Started off at once, and a check that cannot finish leaves it on with a note', async () => {
  const { calls, mount } = folderBackend();
  const ui = await openUi('launch', {}, '', { mount, ...FAKE_CLOCK });
  try {
    const { page } = ui;
    await readyToLaunch(page);
    await until(async () => (await nearLaunch(page).getAttribute('data-output-check')) === 'refused', 'the default folder refused');
    assert.equal(await page.getByRole('button', { name: /Advanced Settings/ }).getAttribute('aria-expanded'), 'true', 'the refusal opens Advanced Settings on its own');
    await setPath(page, MINE);
    await until(async () => !(await launchButton(page).isDisabled()), 'Get Started on for a folder the person can write');
    await holdClock(page);
    await page.getByLabel('Generation Path').press('Backspace');
    assert.equal(await launchButton(page).isDisabled(), true, 'a stale pass never keeps Get Started on (must-exclude)');
    assert.equal(await page.locator('#output-folder-check-field').getAttribute('data-output-check'), 'checking');
    await setPath(page, '/Workspace/broken');
    const field = page.locator('#output-folder-check-field');
    await until(async () => (await field.getAttribute('data-output-check')) === 'unchecked', 'the note under the field');
    assert.equal(await nearLaunch(page).count(), 0, 'nothing holds Get Started');
    assert.match(await field.innerText(), /^Inspire could not check the output folder \(.*upstream timeout\)\. Get Started still works, and the run checks the folder again\.$/);
    assert.equal(await launchButton(page).isDisabled(), false, 'a check that could not answer never holds Get Started');
    await setPath(page, BOSS_FOLDER);
    await until(async () => (await page.locator('#output-folder-check-field').getAttribute('data-output-check')) === 'passed', 'the manager skip');
    assert.equal(await page.locator('#output-folder-check-field').innerText(), 'Results go to /Shared/team_out.');
    assert.equal(await launchButton(page).isDisabled(), false);
    assert.equal(calls.runs, 0, 'nothing launched');
    assert.deepEqual(notFound(ui.pageErrors), []);
  } finally {
    await ui.close();
  }
});

test('an App manager on Start sees one quiet line naming where results go and never a write-check line; a fallback shows one sentence with the grant under Details (must-exclude)', async () => {
  const { mount } = folderBackend();
  const ui = await openUi('launch', {}, '', { mount, ...FAKE_CLOCK });
  try {
    const { page } = ui;
    await readyToLaunch(page);
    const field = page.locator('#output-folder-check-field');
    await setPath(page, BOSS_DEFAULT);
    await until(async () => (await field.getAttribute('data-output-check')) === 'passed', 'the manager own folder');
    assert.equal(await field.innerText(), 'Results go to /Users/boss@example.com/inspire_output.');
    assert.equal(await page.getByText(/skips the write check|You manage this App|write check/i).count(), 0, 'no line about the write check (must-exclude)');
    assert.equal(await field.locator('[data-output-check-notes]').count(), 0, 'no warning when the folder works');
    assert.equal(await launchButton(page).isDisabled(), false);
    await shoot(page, 'launch-manager-own-folder');

    await setPath(page, FALLBACK);
    await until(async () => (await field.getAttribute('data-output-check')) === 'passed' && (await field.locator('[data-output-check-notes] li').count()) === 1, 'the fallback note');
    assert.equal(await field.locator('[data-output-check-notes] li').innerText(), FALLBACK_SENTENCE);
    assert.equal(await field.getByText(/Results go to/).count(), 0, 'the quiet line never sits beside a warning that names another folder');
    const details = field.locator('details[data-technical-details]');
    assert.equal(await details.count(), 1);
    assert.equal(await details.locator('summary').innerText(), 'Details');
    assert.equal(await details.locator('pre').isVisible(), false, 'the grant stays folded until opened');
    await details.locator('summary').click();
    assert.equal(await details.locator('pre').innerText(), FALLBACK_GRANT);
    assert.doesNotMatch(await field.locator('[data-output-check-notes]').innerText(), /\/api\/|CAN_MANAGE|HTTP/, 'no technical text inline');
    assert.equal(await page.getByText(/skips the write check|You manage this App/i).count(), 0, 'still no write-check line (must-exclude)');
    await shoot(page, 'launch-manager-fallback');

    await launchButton(page).click();
    const notes = page.getByTestId('launch-notes');
    await notes.waitFor({ timeout: 15000 });
    assert.equal(await notes.locator('li > span').innerText(), FALLBACK_SENTENCE, 'the run page repeats the one sentence');
    const runDetails = notes.locator('details[data-technical-details]');
    await runDetails.locator('summary').click();
    assert.equal(await runDetails.locator('pre').innerText(), FALLBACK_GRANT, 'and keeps the grant under Details');
    assert.equal(await page.getByText(/skips the write check|You manage this App/i).count(), 0, 'no write-check line on the run page either (must-exclude)');
    assert.deepEqual(notFound(ui.pageErrors), []);
  } finally {
    await ui.close();
  }
});

test('an allowed answer passes, a refusal or a missing sign-in holds Get Started, and a check that cannot finish or an unclear answer goes on with a note (must-exclude)', () => {
  assert.equal(OUTPUT_CHECK_URL, '/api/output-folder/check');
  for (const [asked, sent] of [['./../demos/', './../demos/'], ['../x/../y', '../x/../y'], ['/Workspace/Users/a/out', '/Workspace/Users/a/out'], [undefined, ''], [null, '']]) {
    const request = outputCheckRequest(asked);
    assert.equal(request.method, 'POST', String(asked));
    assert.deepEqual(JSON.parse(request.body), { generation_path: sent }, String(asked));
  }
  assert.doesNotMatch(OUTPUT_CHECK_URL, /\.\.|%2E%2E/i, 'the Databricks Apps front door refuses a request URL that holds ..');
  const fail = (status, message) => Object.assign(new Error(message), { status });
  assert.deepEqual(outputCheckVerdict('/x', { allowed: true, folder: '/Users/someone@example.com/x', checked: 'passed' }, null),
    { path: '/x', state: 'passed', text: '', folder: '/Users/someone@example.com/x', checked: 'passed', warnings: [], details: [] });
  assert.deepEqual(outputCheckVerdict('/x', { allowed: true, folder: '/Shared/demos', warnings: ['w', null], warning_details: ['d', '', null] }, null),
    { path: '/x', state: 'passed', text: '', folder: '/Shared/demos', checked: '', warnings: ['w'], details: ['d'] });
  assert.deepEqual(outputCheckVerdict('/x', { allowed: true, warning_details: 'not a list' }, null).details, []);
  assert.equal(outputCheckVerdict('/x', { allowed: true, checked: 'manager' }, null).checked, 'manager');
  assert.equal(outputCheckVerdict('/x', null, fail(403, REFUSAL)).state, 'refused');
  assert.equal(outputCheckVerdict('/x', null, fail(403, REFUSAL)).text, REFUSAL);
  assert.equal(outputCheckVerdict('/x', null, fail(401, 'Inspire checks with your own sign-in')).state, 'refused', 'no sign-in');
  const notFolder = 'Inspire cannot save to https://x/y: it is not a workspace folder or a volume path Inspire can resolve. Give an absolute folder, such as one under your own user folder.';
  assert.deepEqual([outputCheckVerdict('https://x/y', null, fail(400, notFolder)).state, outputCheckVerdict('https://x/y', null, fail(400, notFolder)).text], ['refused', notFolder],
    'a path that is no folder holds Get Started, never a note that lets it start');
  for (const [label, data, err] of [
    ['a check that cannot finish', null, fail(502, 'upstream timeout')],
    ['a route that is not there', null, fail(404, 'not found')],
    ['allowed false', { allowed: false }, null],
    ['allowed as a string', { allowed: 'true' }, null],
    ['an empty answer', {}, null],
  ]) {
    assert.equal(outputCheckVerdict('/x', data, err).state, 'unchecked', label);
  }
});
