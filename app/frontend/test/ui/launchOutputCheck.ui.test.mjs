import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { OUTPUT_CHECK_URL, outputCheckRequest, outputCheckVerdict } from '../../src/lib/outputFolderCheck.js';

test.after(closeBrowser);

const SHOTS = process.env.LAUNCH_SHOTS || '';
const MINE = '/Workspace/Users/someone@example.com/inspire_out';
const BOSS_FOLDER = '/Workspace/Shared/team_out';
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
      if (asked === '/Workspace/broken') return res.status(502).json({ error: 'Inspire could not check that you can write to /broken, so it starts no run: upstream timeout', unwritable: [] });
      return res.status(403).json({ error: REFUSAL, policy: { route: 'POST /api/output-folder/check', rule: 'writer' }, unwritable: ['/Shared/demos'] });
    });
    app.post('/api/run', (_req, res) => {
      calls.runs += 1;
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
  await field.fill('');
  await field.pressSequentially(value, { delay: 15 });
}

test('a folder the person cannot write keeps Get Started off and shows the refusal next to it, and a folder they can write turns it on', async () => {
  const { calls, mount } = folderBackend();
  const ui = await openUi('launch', {}, '', { mount });
  try {
    const { page } = ui;
    await readyToLaunch(page);
    assert.equal(await launchButton(page).isDisabled(), true, 'Get Started is off while the folder is checked or refused');
    await nearLaunch(page).waitFor({ timeout: 15000 });
    await until(async () => (await nearLaunch(page).getAttribute('data-output-check')) === 'refused', 'the refusal next to Get Started');
    assert.equal(await nearLaunch(page).getByText(REFUSAL, { exact: true }).count(), 1);
    assert.match(await nearLaunch(page).innerText(), /Get Started stays off until the output folder check passes\. Change it in Advanced Settings, Generation Path\./);
    assert.equal(await launchButton(page).isDisabled(), true, 'Get Started is off while the folder is refused');
    assert.deepEqual(calls.checks, ['./../demos/'], 'the default folder is checked once');
    assert.deepEqual(calls.urls, ['/api/output-folder/check'], 'the default path travels in the body, never in the URL');
    for (const [width, height] of [[1440, 1000], [390, 900]]) {
      await page.setViewportSize({ width, height });
      await nearLaunch(page).scrollIntoViewIfNeeded();
      await shoot(page, `launch-refused-${width}`);
      const box = await nearLaunch(page).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `the refusal fits at ${width} px`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    const typedBefore = calls.checks.length;
    await setPath(page, MINE);
    await until(async () => (await page.locator('#output-folder-check-field').getAttribute('data-output-check')) === 'passed', 'the passed check under the field');
    assert.equal(calls.checks.length - typedBefore, 1, `typing the path asks once, after it settles: ${JSON.stringify(calls.checks.slice(typedBefore))}`);
    assert.equal(calls.checks.at(-1), MINE);
    assert.equal(await page.locator('#output-folder-check-field').innerText(), 'You can write to /Users/someone@example.com/inspire_out.');
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

test('changing a passed folder turns Get Started off at once, and a check that cannot finish keeps it off with the reason', async () => {
  const { calls, mount } = folderBackend();
  const ui = await openUi('launch', {}, '', { mount });
  try {
    const { page } = ui;
    await readyToLaunch(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await setPath(page, MINE);
    await until(async () => !(await launchButton(page).isDisabled()), 'Get Started on for a folder the person can write');
    await page.getByLabel('Generation Path').press('Backspace');
    assert.equal(await launchButton(page).isDisabled(), true, 'a stale pass never keeps Get Started on (must-exclude)');
    assert.equal(await page.locator('#output-folder-check-field').getAttribute('data-output-check'), 'checking');
    await setPath(page, '/Workspace/broken');
    await until(async () => (await nearLaunch(page).getAttribute('data-output-check')) === 'error', 'the error next to Get Started');
    assert.match(await nearLaunch(page).innerText(), /Inspire could not check that you can write to \/broken, so it starts no run: upstream timeout/);
    assert.match(await nearLaunch(page).innerText(), /Change Generation Path in Advanced Settings above\./);
    assert.equal(await launchButton(page).isDisabled(), true);
    await setPath(page, BOSS_FOLDER);
    await until(async () => (await page.locator('#output-folder-check-field').getAttribute('data-output-check')) === 'passed', 'the manager skip');
    assert.equal(await page.locator('#output-folder-check-field').innerText(), 'You manage this App, so Inspire skips the write check for /Shared/team_out.');
    assert.equal(await launchButton(page).isDisabled(), false);
    assert.equal(calls.runs, 0, 'nothing launched');
    assert.deepEqual(notFound(ui.pageErrors), []);
  } finally {
    await ui.close();
  }
});

test('only an allowed answer passes the check; a refusal, a missing sign-in, a check that cannot finish and an unclear answer all keep Get Started off', () => {
  assert.equal(OUTPUT_CHECK_URL, '/api/output-folder/check');
  for (const [asked, sent] of [['./../demos/', './../demos/'], ['../x/../y', '../x/../y'], ['/Workspace/Users/a/out', '/Workspace/Users/a/out'], [undefined, ''], [null, '']]) {
    const request = outputCheckRequest(asked);
    assert.equal(request.method, 'POST', String(asked));
    assert.deepEqual(JSON.parse(request.body), { generation_path: sent }, String(asked));
  }
  assert.doesNotMatch(OUTPUT_CHECK_URL, /\.\.|%2E%2E/i, 'the Databricks Apps front door refuses a request URL that holds ..');
  const fail = (status, message) => Object.assign(new Error(message), { status });
  assert.deepEqual(outputCheckVerdict('/x', { allowed: true, folder: '/Users/a/x', checked: 'passed' }, null),
    { path: '/x', state: 'passed', text: '', folder: '/Users/a/x', checked: 'passed' });
  assert.equal(outputCheckVerdict('/x', { allowed: true, checked: 'manager' }, null).checked, 'manager');
  assert.equal(outputCheckVerdict('/x', null, fail(403, REFUSAL)).state, 'refused');
  assert.equal(outputCheckVerdict('/x', null, fail(403, REFUSAL)).text, REFUSAL);
  for (const [label, data, err] of [
    ['no sign-in', null, fail(401, 'Inspire checks with your own sign-in')],
    ['a check that cannot finish', null, fail(502, 'upstream timeout')],
    ['a route that is not there', null, fail(404, 'not found')],
    ['allowed false', { allowed: false }, null],
    ['allowed as a string', { allowed: 'true' }, null],
    ['an empty answer', {}, null],
  ]) {
    assert.equal(outputCheckVerdict('/x', data, err).state, 'error', label);
  }
});
