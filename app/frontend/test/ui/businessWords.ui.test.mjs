import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { closeBrowser, expandBuild, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const JARGON = /\bpipeline\b|\bcluster\b|provision|\bSpark\b|notebook executes|Real-time tracking|AI-generated data strategy/i;

async function shownText(page) {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('[data-technical-details]').forEach((el) => el.remove());
    clone.querySelectorAll('script,style').forEach((el) => el.remove());
    return clone.innerText || clone.textContent || '';
  });
}

test('Monitor with no saved progress says so in plain words and never claims a queued job or a cluster', async () => {
  const ui = await openUi('monitor', {}, '&run=none');
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Monitor', exact: true, level: 1 }).waitFor({ timeout: 15000 });
    await page.getByText('Inspire has saved no progress for this run yet. Each step shows here as soon as it is saved.').waitFor();
    const text = await shownText(page);
    assert.doesNotMatch(text, JARGON);
    assert.doesNotMatch(text, /Job is queued|waiting to start/, 'no queued-job claim without a run (must-exclude)');
  } finally {
    await ui.close();
  }
});

test('Results of a finished run with no use case say the run finished, not that it may still be starting, and in neutral words', async () => {
  const ui = await openUi('results', { results: null, sessions: [{ session_id: '42', completed_percent: 100, completed_on: '2026-11-08 10:00:00', business_name: 'Acme' }] });
  const { page } = ui;
  try {
    const box = page.locator('[data-results-error]');
    await box.waitFor({ timeout: 15000 });
    assert.match(await box.innerText(), /^This run finished without saving a use case/);
    assert.equal(await box.getAttribute('data-tone'), 'error');
    assert.doesNotMatch(await shownText(page), JARGON);
  } finally {
    await ui.close();
  }
});

test('Results of a run still writing show a calm note, not a red error', async () => {
  const ui = await openUi('results', { results: null, sessions: [{ session_id: '42', completed_percent: 40, business_name: 'Acme' }] });
  const { page } = ui;
  try {
    const box = page.locator('[data-results-error]');
    await box.waitFor({ timeout: 15000 });
    assert.match(await box.innerText(), /^Inspire is still writing the use cases of this run/);
    assert.equal(await box.getAttribute('data-tone'), 'info');
    assert.doesNotMatch(await box.getAttribute('class'), /bg-error-bg/);
  } finally {
    await ui.close();
  }
});

test('a build that needs access shows a plain sentence and keeps the GRANT statements under Details only', async () => {
  const grant = 'GRANT SELECT ON TABLE main.sales.orders TO `inspire-app`';
  const failed = built({ spec_version: 2, status: 'failed', status_message: `The App cannot read 1 table. Ask the owner to run: ${grant}`, updated_at: new Date().toISOString() });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [failed, built()] });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const reason = page.locator('[data-mvp-progress] [data-build-reason]');
    await reason.waitFor({ timeout: 15000 });
    assert.equal(await reason.innerText(), 'The App cannot read 1 table. Ask the owner to give you the access listed under Details');
    const details = page.locator('[data-mvp-progress] [data-technical-details]').first();
    assert.equal(await details.locator('summary').innerText(), 'Details');
    assert.equal(await details.getAttribute('open'), null, 'Details starts closed');
    assert.match(await details.textContent(), /GRANT SELECT ON TABLE main\.sales\.orders/);
    assert.doesNotMatch(await shownText(page), /\bGRANT\s+[A-Z]/, 'no GRANT outside Details (must-exclude)');
  } finally {
    await ui.close();
  }
});

test('Generate data explains in plain words and keeps table locations under Details', async () => {
  const ui = await openUi('generate');
  const { page } = ui;
  try {
    await page.getByText(/from your description and adds/).first().waitFor({ timeout: 15000 });
    const text = await shownText(page);
    assert.doesNotMatch(text, JARGON);
    assert.doesNotMatch(text, /inspire_demo_\*|\(recommended\)/, 'locations and the old badge stay out of the page text (must-exclude)');
    assert.equal(await page.locator('[data-discovery-badge]').innerText(), 'Recommended');
    assert.match(await page.locator('[data-technical-details]').first().textContent(), /Tables: .*inspire_demo_\*/);
  } finally {
    await ui.close();
  }
});

test('the Build pane names the next step without the left/right wording or the notebook-only aside', async () => {
  const ui = await openUi('implement');
  const { page } = ui;
  try {
    await page.getByText('No MVP started yet').waitFor({ timeout: 15000 });
    await page.getByText(/^Not built yet\./).first().waitFor();
    const text = await shownText(page);
    assert.match(text, /Pick any use case in the list to start its MVP\./);
    assert.doesNotMatch(text, /Pick a use case on the left|writes only the Genie Code notebook/);
  } finally {
    await ui.close();
  }
});
