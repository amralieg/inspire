// REQ-457 (W16 D29-D34): the Build wizard steps. Each test is walked on the Advanced path; the build start (D34) is also walked on Standard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_PROFILE as PROFILE, OWNER } from './implementFixtures.js';
import { closeBrowser, nextUntil, onStep, openUi, startMvp, until } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const next = (page) => page.getByRole('button', { name: 'Next', exact: true });
const bodyText = (page) => page.locator('[data-wizard-body]').innerText();
const foldLines = (page) => page.locator('[data-fold-line]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
const where = (page) => page.evaluate(() => `${document.querySelector('[aria-current="step"]')?.innerText}|${document.querySelector('[data-step-part]')?.textContent || ''}|${[...document.querySelectorAll('[data-fold-line]')].map((e) => e.dataset.foldLine).join(',')}`);
const mountProfile = (answerOf, calls = []) => async (page) => {
  await page.route('**/api/grouping/profile', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answerOf(body)) });
  });
};

test('D29: Data & results says the source once, hides the result table with Hide, and the stepper says which part of the step it is on', async () => {
  const ui = await openUi('wizard', ME, '');
  const { page, pageErrors } = ui;
  try {
    await nextUntil(page, 'Data & results');
    const before = await where(page);
    await next(page).click();
    await page.getByRole('heading', { name: 'Where should the result table live?' }).or(page.getByText('Where should the result table live?')).first().waitFor();
    const lines = await foldLines(page);
    assert.equal(lines.filter((l) => /^Source tables?:/.test(l)).length, 1, `the source is said once: ${lines.join(' | ')}`);
    const toggle = page.locator('button[aria-expanded="true"][aria-label$="result table"]');
    assert.equal((await toggle.innerText()).trim(), 'Hide', 'the open result table row hides with Hide, not Close');
    assert.notEqual(await where(page), before, 'Next shows where the person is now');
    assert.match(await page.locator('[data-step-part]').innerText(), /^Step 3 of 6 · part 2 of 2$/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

const DEEP = { ...PROFILE, recommended: ['franchiseID'], deep_suggestion: { columns: ['franchiseID'], record_level: 'order_id' } };
const READ = { ...DEEP, groups_for: 'franchiseID', group_count: 7,
  columns: [...PROFILE.columns, { name: 'franchiseID', type: 'string', distinct: 7, smallest: 10, largest: 900, nulls: 0, parent: null }],
  group_list: Array.from({ length: 7 }, (_, i) => ({ value: `F${i + 1}`, records: 900 - i * 100, parts: [{ column: 'franchiseID', value: `F${i + 1}` }] })) };

test('D30: the picked Data group shows its count on its card, in the sentence, and on First run, never "counted once picked"', async () => {
  const ui = await openUi('wizard', ME, '', { init: mountProfile((body) => (body.group_by === 'franchiseID' ? READ : DEEP)) });
  const { page, pageErrors } = ui;
  try {
    await nextUntil(page, 'First run');
    const card = page.locator('[data-grouping-choice="franchiseID"]');
    await card.waitFor({ timeout: 15000 });
    await until(async () => /7 groups/.test(await card.locator('[data-grouping-count]').innerText()), 'the picked card shows its 7 groups');
    assert.match(await page.locator('[data-grouping-lead]').innerText(), /^franchiseID splits the data into 7 groups\./);
    assert.match(await page.locator('[data-grouping-chosen]').innerText(), /Data groups: franchiseID · 7 groups\./);
    assert.doesNotMatch(await bodyText(page), /counted once picked/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('D30: when no count can be read the sentence stays readable and says so, on the card, the sentence and First run', async () => {
  const ui = await openUi('wizard', ME, '', { init: mountProfile(() => DEEP) });
  const { page } = ui;
  try {
    await nextUntil(page, 'First run');
    await page.locator('[data-grouping-lead]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-grouping-lead]').innerText(),
      'franchiseID splits the data into groups. Inspire counts them when it reads the data, and models each group on its own.');
    assert.doesNotMatch(await bodyText(page), /counted once picked|into groups not counted/);
  } finally {
    await ui.close();
  }
});

test('D31 and D32: Keep it fresh and Schedule do not say the same thing twice, and a kept ~records First run is still said after Next', async () => {
  const ui = await openUi('wizard', ME, '', { init: mountProfile(() => PROFILE) });
  const { page } = ui;
  try {
    await nextUntil(page, 'First run');
    await page.locator('[data-scope-step]').waitFor({ timeout: 15000 });
    await next(page).click();
    await page.locator('[data-fold-line="First run"]').waitFor();
    const first = (await page.locator('[data-fold-line="First run"]').innerText()).trim();
    assert.doesNotMatch(first, /All rows of the source table/, `the First run line follows the kept choice: ${first}`);
    assert.match(first, /record/i);
    assert.equal((await bodyText(page)).match(/06:00/g)?.length, 1, 'the schedule time is said once on the Keep it fresh part');
    await next(page).click();
    await page.locator('[data-setting="Schedule (Quartz cron)"]').waitFor();
    assert.equal((await bodyText(page)).match(/06:00/g)?.length, 1, 'and once on the Schedule part');
    assert.match(await page.locator('[data-step-part]').innerText(), /part 3 of 3$/);
  } finally {
    await ui.close();
  }
});

test('D33: every Next either shows a new place or a reason, and the wizard has one Next on each screen', async () => {
  const ui = await openUi('wizard', ME, '', { init: mountProfile(() => PROFILE) });
  const { page } = ui;
  try {
    await onStep(page, 'What to deliver');
    for (let i = 0; i < 20; i += 1) {
      assert.equal(await next(page).count(), 1, `one Next on screen ${i}`);
      assert.equal(await page.getByRole('button', { name: 'Previous decision' }).count(), 0, 'no second Previous decision / Next pair beside the footer');
      const was = await where(page);
      await page.getByRole('button', { name: /Checking/ }).waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
      await next(page).click();
      const moved = await page.waitForFunction((w) => {
        const now = `${document.querySelector('[aria-current="step"]')?.innerText}|${document.querySelector('[data-step-part]')?.textContent || ''}|${[...document.querySelectorAll('[data-fold-line]')].map((e) => e.dataset.foldLine).join(',')}`;
        return now !== w || document.querySelector('[role="alert"]');
      }, was, { timeout: 15000 }).then(() => true, () => false);
      assert.ok(moved, `Next on screen ${i} (${was}) changed nothing and said nothing`);
      if (/Review & build/.test(await page.locator('[aria-current="step"]').innerText())) break;
    }
  } finally {
    await ui.close();
  }
});

const submitMount = (hold, answer) => (app) => {
  app.post('/api/inspire/implement/submit', async (req, res) => {
    await hold.promise;
    if (answer.fail) { res.status(500).json({ error: 'The build could not start.' }); return; }
    res.json({ session_id: '42', use_case_id: req.body.spec.use_case_id, spec_version: 1, summary: {}, warnings: [] });
  });
};
const held = () => { const h = { release: () => {} }; h.promise = new Promise((r) => { h.release = r; }); return h; };

test('D34 Advanced: Build with these choices closes the wizard while the build starts, and a failed start brings it back with the reason', async () => {
  for (const fail of [false, true]) {
    const hold = held();
    const answer = { fail };
    const ui = await openUi('wizard', ME, '', { mount: submitMount(hold, answer) });
    const { page } = ui;
    try {
      await nextUntil(page, 'Data & results');
      const now = page.locator('[data-build-now]');
      await page.waitForFunction(() => { const b = document.querySelector('[data-build-now]'); return b && !b.disabled; }, null, { timeout: 30000 });
      await now.click();
      await page.locator('[data-implement-overlay]').waitFor({ state: 'detached', timeout: 5000 });
      hold.release();
      if (fail) {
        await page.getByRole('alert').filter({ hasText: 'The build could not start.' }).waitFor({ timeout: 15000 });
        assert.equal(await page.locator('[data-build-now]').count(), 1, 'the wizard is back on its step with the choices');
      } else {
        await page.getByRole('heading', { name: 'Build', exact: true }).waitFor({ timeout: 20000 });
      }
    } finally {
      hold.release();
      await ui.close();
    }
  }
});

test('D34 Standard: the final Build button closes the wizard while the build starts', async () => {
  const hold = held();
  const ui = await openUi('wizard', ME, '', { build: null, mount: submitMount(hold, {}) });
  const { page } = ui;
  try {
    await next(page).click();
    await startMvp(page);
    await page.locator('[data-implement-overlay]').waitFor({ state: 'detached', timeout: 5000 });
    hold.release();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor({ timeout: 20000 });
  } finally {
    hold.release();
    await ui.close();
  }
});
