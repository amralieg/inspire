import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_IT, closeBrowser, goToStep, openUi, stubMoney, toSummary } from './uiSupport.mjs';

// REQ-001: one decision per wizard screen. A later Measure decision is not on screen until Next reaches it.
test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const stubPreview = (page) => stubMoney('value-preview', () => ({ rows: [{ stake: 1, currency: 'USD' }] }), [])(page);
const body = (page) => page.locator('[data-wizard-body]');
const stepName = (page) => page.locator('[aria-current="step"]').innerText();
const topDecisions = (page) => page.locator('[data-wizard-body] [data-choice]').evaluateAll((els) => els
  .filter((e) => e.getClientRects().length > 0 && !e.parentElement.closest('[data-choice]'))
  .map((e) => e.getAttribute('data-choice')));

// The notebook-only path: the context reports Databricks AI off, so the wizard offers the notebook steps.
const notebookOnly = (page) => page.route('**/api/inspire/implement/context?*', async (route) => {
  const res = await route.fetch();
  const data = await res.json();
  await route.fulfill({ response: res, json: { ...data, features: { ...(data.features || {}), genie_code: { available: false, reason: 'Databricks AI is off', fix: '' } } } });
});

// Walks every screen from the first step. At each screen at most one top-level decision is on screen. A Measure screen shows one
// money decision. Before Next, `beforeNext(name)` runs so a path can make its own choice. Returns the screens seen.
async function walkEveryScreen(page, beforeNext = async () => {}) {
  const seen = [];
  for (let i = 0; i < 40; i += 1) {
    const name = (await stepName(page)).trim();
    const decisions = await topDecisions(page);
    seen.push(`${name}:${decisions.join('+') || '-'}`);
    assert.ok(decisions.length <= 1, `${name} shows ${decisions.length} decisions at once: ${decisions.join(', ')} (must-exclude)`);
    if (name.includes('Review & build') || name.includes('Notebook')) break;
    await beforeNext(name);
    const money = page.locator('[data-money-next]');
    if (await money.count() && await money.isVisible()) {
      assert.equal(await page.locator('[data-money-current]').count(), 1, `${name}: one Measure decision is current`);
      await money.click();
    } else {
      const next = page.getByRole('button', { name: 'Next', exact: true });
      await next.click({ timeout: 8000 }).catch((e) => { throw new Error(`no Next on ${name}; screens so far: ${seen.join(' | ')}: ${e.message.split('\n')[0]}`); });
    }
  }
  return seen;
}

const PLACEMENTS = {
  domain: /^One App per business domain/,
  use_case: /^One App per use case/,
  business: /^One App for all use cases/,
  inside: /^Inside Inspire/,
};
// Ticks the App tile on What to deliver, then picks the placement on Where it lives when the walk reaches it.
const appPath = (placement) => {
  let picked = false;
  return {
    // REQ-514: the App is always built, so there is no App tile to tick.
    setup: async (page) => { assert.equal(await page.getByRole('checkbox', { name: /^App/ }).count(), 0, 'the App is not an option'); },
    beforeNext: async (page, name) => {
      if (!name.includes('Where it lives') || picked) return;
      picked = true;
      const radio = page.getByRole('region', { name: 'App placement' }).getByRole('radio', { name: PLACEMENTS[placement] });
      // In this fixture no App exists yet, so the domain radio is disabled and the default placement stands; the other placements are picked.
      if (placement !== 'domain') await radio.check();
    },
  };
};

test('every screen of the default path shows at most one decision, and Next alone reaches Review & build', async () => {
  const ui = await openUi('wizard', ME, '', { init: stubPreview });
  const { page } = ui;
  try {
    const seen = await walkEveryScreen(page);
    await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled), BUILD_IT, { timeout: 15000 });
    assert.ok(seen.length >= 5, `the default path has its screens: ${seen.join(' | ')}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('every screen of the notebook-only path shows at most one decision, and Next reaches the Notebook step', async () => {
  const ui = await openUi('wizard', ME, '', { init: async (page) => { await stubPreview(page); await notebookOnly(page); } });
  const { page } = ui;
  try {
    const seen = await walkEveryScreen(page);
    assert.ok(seen.some((s) => s.startsWith('2. Notebook') || s.includes('Notebook')), `the notebook path has a Notebook step: ${seen.join(' | ')}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

for (const placement of Object.keys(PLACEMENTS)) {
  test(`every screen of the App path with placement "${placement}" shows at most one decision, and Next alone reaches Review & build`, async () => {
    const ui = await openUi('wizard', ME, '', { init: stubPreview });
    const { page } = ui;
    try {
      const app = appPath(placement);
      await app.setup(page);
      const seen = await walkEveryScreen(page, (name) => app.beforeNext(page, name));
      assert.ok(seen.some((s) => s.includes('Where it lives')), `the App path shows Where it lives: ${seen.join(' | ')}`);
      await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled), BUILD_IT, { timeout: 15000 });
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

test('First run: Keep it fresh never renders beside the records choice; each opens on its own', async () => {
  const ui = await openUi('wizard', ME, '', { init: stubPreview });
  const { page } = ui;
  try {
    await goToStep(page, 'First run');
    const records = page.locator('[data-choice="first-run"]');
    const fresh = page.locator('[data-choice="freshness"]');
    const shownCount = async (loc) => loc.evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).length);
    assert.equal(await shownCount(records), 1, 'the records choice is open on arrival');
    assert.equal(await shownCount(fresh), 0, 'Keep it fresh is not rendered beside the records choice (must-exclude)');
    await page.getByRole('button', { name: 'Change Keep it fresh', exact: true }).click();
    await fresh.first().waitFor();
    assert.equal(await shownCount(records), 0, 'opening Keep it fresh closes the records choice (must-exclude)');
    assert.equal(await shownCount(fresh), 1, 'Keep it fresh is the one open decision');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
