// RC6-C-01 (REQ-528) and RC6-C-03 (REQ-514): the Build wizard never says "Page storage", shows the picked warehouse the same way everywhere,
// keeps the read-only "App storage" row on Review, and calls the App "App" when nothing agentic is picked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, onStep, openUi, toSummary } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { me: { userName: ['owner', 'example.com'].join('@'), displayName: 'Owner' }, responses: { 'GET /api/2.0/postgres/projects': [{ projects: [] }, 200] } };
const nextButton = (page) => page.getByRole('button', { name: 'Next', exact: true });
const bodyText = (page) => page.locator('body').innerText();

async function toLook(page) {
  await onStep(page, 'How to build');
  for (const label of ['What', 'Look']) {
    await nextButton(page).click();
    await onStep(page, label);
  }
}

test('RC6B-1: Standard Look and Review never say Page storage, and a shown warehouse is never "not picked"', async () => {
  const ui = await openUi('wizard', ME, '', { build: null });
  const { page, pageErrors } = ui;
  try {
    await toLook(page);
    const look = await bodyText(page);
    assert.doesNotMatch(look, /Page storage/i, 'Look: no Page storage wording');
    const change = page.getByRole('button', { name: /^Change\b.*(storage|warehouse)/i });
    for (let i = 0; i < await change.count(); i += 1) await change.nth(i).click().catch(() => {});
    const opened = await bodyText(page);
    assert.doesNotMatch(opened, /Page storage/i, 'Look opened: no Page storage wording');
    assert.doesNotMatch(opened, /SQL warehouse: not picked/i, 'Look opened: no "SQL warehouse: not picked"');
    await toSummary(page);
    const review = await bodyText(page);
    assert.doesNotMatch(review, /Page storage/i, 'Review: no Page storage wording');
    assert.doesNotMatch(review, /SQL warehouse: not picked/i);
    assert.deepEqual(pageErrors, []);
  } finally { await ui.close(); }
});

test('RC6B-2: Review keeps the read-only App storage row', async () => {
  const ui = await openUi('wizard', ME, '', { build: null });
  const { page, pageErrors } = ui;
  try {
    await toLook(page);
    await toSummary(page);
    const row = page.locator('[data-picked-row="app_storage"]');
    await row.waitFor();
    assert.match((await row.innerText()).replace(/\s+/g, ' '), /App storage\s*:?\s*Fast pages \(Lakebase\)/);
    assert.equal(await row.locator('[data-picked-change]').count(), 0, 'read only');
    assert.deepEqual(pageErrors, []);
  } finally { await ui.close(); }
});

test('RC6B-3: Review calls the App "App", never "Agentic App", and What it builds lists App', async () => {
  const ui = await openUi('wizard', ME, '', { build: null });
  const { page, pageErrors } = ui;
  try {
    await toLook(page);
    await toSummary(page);
    const built = page.locator('[data-picked-row="outputs"] [data-picked-value]');
    await built.waitFor();
    const review = (await bodyText(page)).replace(/\s+/g, ' ');
    assert.doesNotMatch(review, /Agentic App/);
    assert.match(await built.innerText(), /^The MVP: [^.]*\bApp\b/);
    assert.deepEqual(pageErrors, []);
  } finally { await ui.close(); }
});
