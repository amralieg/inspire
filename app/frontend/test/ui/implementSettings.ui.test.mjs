import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, dataToResults, openAdvanced, openUi, onStep, startMvp, toAppAccess, goToStep } from './uiSupport.mjs';

const OWNER = ['owner', 'example.com'].join('@');
const PAT = ['pat', 'example.com'].join('@');
const LEE = ['lee', 'example.com'].join('@');
const OPS = ['ops', 'example.com'].join('@');
const SHARE_PROBLEM = 'the share of records to hold back must be 1% to 50%';
const NO_LAKEBASE = { 'GET /api/2.0/postgres/projects': [{ projects: [] }, 200] };

test.after(closeBrowser);

const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const footerErrors = (page) => page.locator('[role="alert"] p').allTextContents();
const advanced = (page, what = 'delivery settings') => page.getByRole('button', { name: new RegExp(`^(Change|Close) ${what}$`) });

async function toResults(page) {
  await goToStep(page, 'Data');
  await dataToResults(page);
}

async function startWhenReady(page) {
  await startMvp(page);
  await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
}

function submittedSpec(made) {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1);
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
}

async function throughApp(page) {
  await toAppAccess(page);
  await page.getByRole('region', { name: 'App access' }).getByRole('radio', { name: /^Internal data/ }).check();
  await goToStep(page, 'App look');
}

test('a build left alone holds back 10% to measure impact and sends no App owners', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  try {
    await toResults(page);
    await goToStep(page, 'What to build');
    await startWhenReady(page);
    const spec = submittedSpec(made);
    assert.deepEqual(spec.holdout, { enabled: true, share: 0.1 }, 'the holdout starts on, where its Recommended badge sits');
    assert.deepEqual(spec.outputs.app_owners, []);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Measure impact, its own step, starts ticked with its badge, takes a share from 1% to 50% at 10% by default, and sends what the person typed', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  try {
    await toResults(page);
    await goToStep(page, 'Measure impact');
    const impact = page.getByRole('group', { name: 'Measure impact' });
    const box = impact.getByRole('checkbox', { name: /^Hold back a share of records to measure impact\./ });
    assert.equal(await box.isChecked(), true, 'it starts on, where its Recommended badge sits');
    assert.equal(await impact.locator('[data-choice="holdout"] [data-recommended]').count(), 1, 'Measure impact keeps its own Recommended, one per question');
    await page.locator('[data-choice="freshness"] [data-recommended="daily"]').waitFor();
    await impact.getByText('Inspire leaves the held-back records alone, so it can compare their results with the records people acted on.', { exact: false }).waitFor();
    await box.uncheck();
    assert.equal(await impact.getByRole('spinbutton').count(), 0, 'no share to type while it is off');
    await box.check();
    await page.getByRole('button', { name: 'Change hold back share', exact: true }).click();
    const share = page.getByRole('spinbutton', { name: 'Share of records held back, in percent' });
    assert.equal(await share.inputValue(), '10');
    await page.getByText('picked at random and kept the same on every run', { exact: false }).waitFor();
    assert.doesNotMatch(await impact.textContent(), /\u2014|\u2013/);
    await share.fill('60');
    await impact.getByText(SHARE_PROBLEM, { exact: true }).waitFor();
    await next(page);
    await page.locator('[role="alert"] p', { hasText: SHARE_PROBLEM }).waitFor();
    assert.equal(await page.locator('[aria-current="step"]').textContent(), '9. Run it', 'a share above half the records keeps the person on Measure impact');
    await share.fill('');
    await page.locator('[role="alert"] p', { hasText: SHARE_PROBLEM }).waitFor();
    await box.uncheck();
    assert.deepEqual(await footerErrors(page), [], 'turning it off clears the share problem with it');
    await box.check();
    assert.equal(await share.inputValue(), '10', 'turning it back on starts again from the default');
    await share.fill('25');
    assert.equal(await impact.getByText(SHARE_PROBLEM).count(), 0);
    await goToStep(page, 'What to build');
    await startWhenReady(page);
    assert.deepEqual(submittedSpec(made).holdout, { enabled: true, share: 0.25 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('every list field keeps the comma or new line a person types, and sends each item', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, responses: NO_LAKEBASE });
  const { page, made } = ui;
  try {
    const keeps = async (typed) => {
      for (const [field, text] of typed) {
        await field.fill('');
        await field.pressSequentially(text);
        assert.equal(await field.inputValue(), text, `the field keeps "${JSON.stringify(text)}" as typed`);
      }
    };
    await toResults(page);
    await goToStep(page, 'Review & build');
    await page.getByRole('button', { name: 'Change failure emails', exact: true }).click();
    await keeps([[page.getByLabel('Failure emails (comma separated; default: the decision owner)'), `${OWNER}, ${OPS}`]]);
    await goToStep(page, 'What to build');
    for (const name of [/^Dashboard/, /^App /, /^Alert/]) await page.getByRole('checkbox', { name }).check();
    await advanced(page).click();
    await keeps([
      [page.getByPlaceholder('Filter widgets, comma separated'), 'top_k, region'],
      [page.getByPlaceholder('Up to 5 questions, one per line'), 'Who left?\nWho stays?'],
      [page.getByLabel('Email recipients (comma separated)'), `${OPS}, ${OWNER}`],
    ]);
    await throughApp(page);
    await startWhenReady(page);
    const spec = submittedSpec(made);
    assert.deepEqual(spec.outputs.dashboard_filters, ['top_k', 'region']);
    assert.deepEqual(spec.outputs.genie_questions, ['Who left?', 'Who stays?']);
    assert.deepEqual(spec.outputs.alert_recipients, [OPS, OWNER]);
    assert.deepEqual(spec.schedule.failure_emails, [OWNER, OPS]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the alert row keeps its threshold short and its lists as wide as their choices, not the width of the dialog', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    await toResults(page);
    await goToStep(page, 'What to build');
    await page.getByRole('checkbox', { name: /^Alert/ }).check();
    await advanced(page).click();
    const width = async (locator) => Math.round((await locator.boundingBox()).width);
    const threshold = page.getByRole('spinbutton');
    assert.equal(await threshold.count(), 1);
    assert.ok(await width(threshold) <= 100, `the threshold is a short number field (${await width(threshold)} px)`);
    for (const value of ['act_now', '>=', 'fixed']) {
      const list = page.locator('select', { has: page.locator(`option[value="${value}"]`) });
      assert.ok(await width(list) < 300, `the list holding ${value} is as wide as its choices (${await width(list)} px)`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('App owners are typed under Advanced settings like alert recipients, checked as emails, and sent once each, only with an App', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, responses: NO_LAKEBASE });
  const { page, made } = ui;
  try {
    await toResults(page);
    await goToStep(page, 'What to build');
    await advanced(page).click();
    const owners = page.getByLabel('App owners (comma separated)');
    await owners.waitFor();
    await page.getByRole('checkbox', { name: /^App / }).uncheck();
    assert.equal(await owners.count(), 0, 'no App, no owners to name');
    await page.getByRole('checkbox', { name: /^App / }).check();
    await page.getByText('You can always change this use case\u2019s settings and assumptions in the App and run it now. Add the work emails of other people who may do the same.').waitFor();
    assert.equal(await owners.inputValue(), '', 'nobody else unless named');
    await owners.pressSequentially(`${PAT}, nope`);
    assert.equal(await owners.inputValue(), `${PAT}, nope`);
    await next(page);
    await page.locator('[role="alert"] p', { hasText: 'App owners must be email addresses: nope' }).waitFor();
    assert.equal(await page.locator('[aria-current="step"]').textContent(), '4. What to deliver');
    await owners.fill(`${PAT}, ${PAT.toUpperCase()}, ${LEE}`);
    await throughApp(page);
    await startWhenReady(page);
    assert.deepEqual(submittedSpec(made).outputs.app_owners, [PAT, LEE], 'each person once, in the order typed');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
