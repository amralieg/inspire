// REQ-457 REQ-457a: the first step asks "How should I build the App?". Standard (What, Look, Build) is the default and recommended; Advanced keeps
// every step; Measure is no longer a step: its settings are asked in the value dialog, from the value line on Build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToMeasureImpact, goToStep, onStep, openUi, startMvp, stepsAre, toSummary, wizardInScreen } from './uiSupport.mjs';
import { built } from './implementFixtures.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const STANDARD = ['1. How to build', '2. What', '3. Look', '4. Build'];
const submittedSpec = (made) => {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1, 'one version was written');
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
};
const nextButton = (page) => page.getByRole('button', { name: 'Next', exact: true });
const stepNow = async (page) => (await page.locator('[data-wizard-header] [aria-current="step"]').innerText()).trim();
const savedPuts = [];
const mountPuts = (app) => {
  app.put('/api/inspire/value/answers', (req, res) => { savedPuts.push(req.body); res.json({ ok: true }); });
};

test('1: the first step asks how to build, with Standard pre-selected and recommended and Next as the red primary', async () => {
  const ui = await openUi('wizard', ME, '', { build: null });
  const { page, pageErrors } = ui;
  try {
    await page.getByRole('heading', { name: 'How should I build the App?', exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('radiogroup', { name: 'How should I build the App?' }).waitFor();
    assert.equal(await page.locator('[data-build-choice="standard"] input').isChecked(), true, 'Standard is checked');
    assert.equal(await page.locator('[data-build-choice="advanced"] input').isChecked(), false, 'Advanced is not');
    assert.equal(await page.locator('[data-recommended]').count(), 1, 'exactly one Recommended badge');
    assert.equal(await page.locator('[data-build-choice="standard"] [data-recommended]').count(), 1, 'the badge sits on Standard');
    assert.match(await page.locator('[data-build-choice="standard"]').innerText(), /Standard MVP build settings/);
    assert.match(await page.locator('[data-build-choice="advanced"]').innerText(), /Advanced MVP build settings/);
    assert.match(await nextButton(page).getAttribute('class'), /bg-db-red-solid/, 'Next is the red primary button');
    await stepsAre(page, STANDARD);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('2: the Standard path is three Nexts to Build; no Build-now shows; the value line asks to calculate; the build carries the default money rule', async () => {
  const ui = await openUi('wizard', ME, '', { build: null, mount: mountPuts });
  const { page, made, pageErrors } = ui;
  try {
    await onStep(page, 'How to build');
    for (const label of ['What', 'Look', 'Build']) {
      await nextButton(page).click();
      await onStep(page, label);
      assert.equal(await page.locator('[data-build-now]').count(), 0, `no Build-now on ${label}`);
    }
    await page.locator('[data-value-calculate]').first().waitFor({ timeout: 15000 });
    await startMvp(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.ok(submittedSpec(made).money, 'the submitted spec has the money rule defaultMoneyRule seeded');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

// Fields that hold a timestamp or a request id would differ between two walks; the harness spec has none today, so the list is empty.
const IGNORED = [];
const withoutVolatile = (spec) => { const copy = JSON.parse(JSON.stringify(spec)); for (const key of IGNORED) delete copy[key]; return copy; };

test('3: a Standard walk and an Advanced walk with only Next clicks submit the same spec', async () => {
  const walk = async (build) => {
    const ui = await openUi('wizard', ME, '', { build, mount: mountPuts });
    try {
      if (build === null) await nextButton(ui.page).click();
      await startMvp(ui.page);
      await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
      return withoutVolatile(submittedSpec(ui.made));
    } finally {
      await ui.close();
    }
  };
  const standard = await walk(null);
  const advanced = await walk('advanced');
  assert.deepEqual(standard, advanced);
});

test('4: the Advanced choice has no Measure step, How to build first, and opens on What to deliver', async () => {
  const ui = await openUi('wizard', ME, '', { build: 'advanced' });
  const { page } = ui;
  try {
    await onStep(page, 'What to deliver');
    const labels = await page.locator('[data-wizard-header] ol li').allTextContents();
    assert.match(labels[0], /How to build/);
    assert.ok(!labels.some((l) => /Measure/.test(l)), labels.join(' | '));
    assert.match(labels.at(-1), /Review & build/);
  } finally {
    await ui.close();
  }
});

test('5: the choice is remembered, and a Standard rebuild of a built use case opens on Build', async () => {
  const first = await openUi('wizard', ME, '', { build: null });
  try {
    await first.page.locator('[data-build-choice="advanced"] input').check();
    await nextButton(first.page).click();
    await onStep(first.page, 'What to deliver');
    await first.page.reload();
    await onStep(first.page, 'What to deliver');
    assert.match((await first.page.locator('[data-wizard-header] ol li').allTextContents())[0], /How to build/);
    await first.page.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await first.page.locator('[data-build-choice="advanced"] input').isChecked(), true, 'Advanced is remembered');
  } finally {
    await first.close();
  }
  const editing = await openUi('wizard', { ...ME, history: [built()] }, '', { build: 'standard' });
  try {
    await onStep(editing.page, 'Build');
  } finally {
    await editing.close();
  }
});

test('6: a Build row of a hidden step says Change in Advanced, which switches to Advanced and keeps the earlier choices', async () => {
  const ui = await openUi('wizard', ME, '', { build: 'standard' });
  const { page, pageErrors } = ui;
  try {
    await toSummary(page);
    const change = page.locator('[data-picked-advanced="data"]').first();
    await change.waitFor({ timeout: 15000 });
    await change.click();
    await onStep(page, 'Data & results');
    const labels = await page.locator('[data-wizard-header] ol li').allTextContents();
    assert.ok(labels.some((l) => /What to deliver/.test(l)), 'the stepper is Advanced');
    await goToStep(page, 'What to deliver');
    assert.equal(await page.locator('[data-output="app"] input[type="checkbox"]').isChecked(), true, 'the What choices are kept');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('7: old Measure links land on Build with the value dialog in Edit; an Advanced-only link opens Advanced; none throws', async () => {
  for (const step of ['measure', 'holdout']) {
    const ui = await openUi('wizard', ME, `&step=${step}`, { build: 'standard' });
    try {
      await ui.page.locator('[data-measure-editor]').waitFor({ timeout: 20000 });
      assert.ok(['Build', 'Review & build'].includes(await stepNow(ui.page).then((t) => t.replace(/^\d+\.\s*/, ''))));
      if (step === 'holdout') assert.equal(await ui.page.locator('li[data-money-current] [data-money-part]').getAttribute('data-money-part'), 'holdout');
      assert.deepEqual(ui.pageErrors, [], step);
    } finally {
      await ui.close();
    }
  }
  const ui = await openUi('wizard', ME, '&step=data', { build: 'standard' });
  try {
    await onStep(ui.page, 'Data & results');
    assert.match((await ui.page.locator('[data-wizard-header] ol li').allTextContents()).join('|'), /What to deliver/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('8: in Standard, the measure settings are asked in the value dialog and carry to the answers and the spec', async () => {
  savedPuts.length = 0;
  const ui = await openUi('wizard', ME, '', { build: 'standard', mount: mountPuts });
  const { page, made } = ui;
  try {
    await goToMeasureImpact(page, 'holdout');
    const toggle = page.getByRole('checkbox', { name: /hold back/i }).first();
    assert.equal(await toggle.isChecked(), true, 'Hold back is on by default');
    await toggle.uncheck();
    await page.keyboard.press('Escape');
    await page.locator('[data-measure-settings]').waitFor({ state: 'detached', timeout: 15000 });
    await startMvp(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(submittedSpec(made).holdout.enabled, false);
  } finally {
    await ui.close();
  }
});

test('9: the first step fits a 1280x800 screen with no sideways scroll', async () => {
  const ui = await openUi('wizard', ME, '', { build: null });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await onStep(page, 'How to build');
    await wizardInScreen(page, 'build-choice', 800);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
  } finally {
    await ui.close();
  }
});
