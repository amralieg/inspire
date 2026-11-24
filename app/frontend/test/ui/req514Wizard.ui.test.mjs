// REQ-514: in the build MVP wizard the App (with its Genie) is decided and always built; Dashboard and Alert are the only two options.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, startMvp } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const submittedSpec = (made) => {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1, 'one version was written');
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
};

async function openDelivery() {
  const ui = await openUi('wizard', ME);
  try {
    await goToStep(ui.page, 'What to build');
    await ui.page.locator('[data-choice="outputs"]').waitFor({ timeout: 15000 });
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

test('the App with its Genie is a fixed card with no input, saying it is always built', async () => {
  const ui = await openDelivery();
  const { page } = ui;
  try {
    const card = page.locator('[data-output="app"]');
    assert.equal(await card.count(), 1, 'one App card');
    assert.equal(await card.locator('input,button,[role="checkbox"],[role="switch"]').count(), 0, 'the App card has no control');
    const text = await card.innerText();
    assert.match(text, /App/);
    assert.match(text, /Genie/);
    assert.match(text, /always built/i);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('exactly two options show, Dashboard and Alert, and no other asset choice exists', async () => {
  const ui = await openDelivery();
  const { page } = ui;
  try {
    const boxes = page.locator('[data-choice="outputs"] input[type="checkbox"], [data-choice="outputs"] [role="switch"], [data-choice="outputs"] [role="checkbox"]');
    assert.equal(await boxes.count(), 2, 'two options in the choice');
    await page.getByRole('checkbox', { name: /^Dashboard/ }).waitFor();
    await page.getByRole('checkbox', { name: /^Alert/ }).waitFor();
    for (const gone of [/^Notebook/, /^Genie Agent/, /^Metric view/i, /^Job/]) assert.equal(await page.getByRole('checkbox', { name: gone }).count(), 0, `no ${gone} choice`);
    assert.equal(await page.locator('[data-output]').count(), 3, 'App, Dashboard and Alert cards only');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the build sends the App and its Genie, plus only the extras ticked', async () => {
  const walk = async (ticked) => {
    const ui = await openDelivery();
    try {
      for (const name of ticked) await ui.page.getByRole('checkbox', { name: new RegExp(`^${name}`) }).check();
      await startMvp(ui.page);
      await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
      return submittedSpec(ui.made).outputs;
    } finally {
      await ui.close();
    }
  };
  const none = await walk([]);
  assert.deepEqual([none.app, none.genie_space, none.dashboard, none.alert], [true, true, false, false], 'no extras ticked');
  const alert = await walk(['Alert']);
  assert.deepEqual([alert.app, alert.genie_space, alert.dashboard, alert.alert], [true, true, false, true], 'only Alert ticked');
  const both = await walk(['Dashboard', 'Alert']);
  assert.deepEqual([both.app, both.genie_space, both.dashboard, both.alert], [true, true, true, true], 'both ticked');
});
