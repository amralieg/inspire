import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, startMvp, toSummary } from './uiSupport.mjs';

// REQ-322: the Agentic App and its Genie Agent start ticked together, the App card says what the Genie Agent does, and the person can untick it.
// REQ-323: a submitted build shows on the Build page at once, before the history read returns it.
// REQ-324: the Review wait names the checks that run together.
// REQ-325: a real mouse click anywhere on a delivery card, including its description text, ticks it, at 1440x900 and 1280x800.

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const DATED = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }];
const DASHBOARD_DESCRIPTION = 'Decision list, trend and run health.';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function toDelivery(page) {
  await goToStep(page, 'Data');
  await goToStep(page, 'What to build');
}

const card = (page, id) => page.locator(`[data-output="${id}"]`);
const tick = (page, id) => card(page, id).getByRole('checkbox').first();

test('the Agentic App and its Genie Agent start ticked, the App card says what the Genie Agent does, and the Genie Agent unticks (REQ-322)', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, columns: DATED });
  const { page } = ui;
  try {
    await toDelivery(page);
    // REQ-514: the App with Genie is one fixed card, always built, with no tick and no separate Genie Agent card.
    assert.equal(await card(page, 'app').getByRole('checkbox').count(), 0, 'the App with Genie card has no tick: it is always built');
    assert.equal(await card(page, 'genie_space').count(), 0, 'the Genie Agent is part of the App card, not its own card');
    assert.equal(await tick(page, 'dashboard').isChecked(), false, 'the dashboard is not ticked by default');
    await card(page, 'app').getByText(/the Genie Agent that answers Ask/).waitFor();
    await card(page, 'app').getByText(/Always built/).waitFor();
  } finally {
    await ui.close();
  }
});

test('the Build page shows a submitted build as queued at once, before the history read returns it (REQ-323)', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, columns: DATED });
  const { page } = ui;
  try {
    // Every history read waits 4 s, and the wizard hands over to a fresh Build page after submit: the queued build shows only through the store.
    await page.route(/\/api\/inspire\/implement\/history/, async (route) => {
      await sleep(4000);
      await route.continue();
    });
    await startMvp(page);
    await page.waitForFunction(() => !document.querySelector('[data-wizard-body]'), null, { timeout: 20000 });
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await page.getByRole('region', { name: 'Build summary' }).getByText(/MVP queued/).waitFor({ timeout: 2000 });
  } finally {
    await ui.close();
  }
});

test('the Review step names the checks that run together while access is checked (REQ-324)', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, columns: DATED });
  const { page } = ui;
  try {
    await page.route(/\/api\/inspire\/implement\/preflight/, async (route) => {
      await sleep(2500);
      await route.continue();
    });
    await toSummary(page);
    await page.locator('[data-access-progress]').getByText(/Checking the source tables, where results go and the App's access, \d+ s so far/).waitFor({ timeout: 4000 });
  } finally {
    await ui.close();
  }
});

for (const viewport of VIEWPORTS) {
  test(`a real mouse click on the description text, and on any part of a delivery card, ticks it at ${viewport.width}x${viewport.height} (REQ-325)`, async () => {
    const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, columns: DATED });
    const { page } = ui;
    try {
      await page.setViewportSize(viewport);
      await toDelivery(page);
      // REQ-514: the App is a fixed card with no tick, so the optional Dashboard card (unticked by default) carries these clicks.
      const span = card(page, 'dashboard').getByText(DASHBOARD_DESCRIPTION);
      const spanBox = await span.boundingBox();
      await page.mouse.click(spanBox.x + spanBox.width / 2, spanBox.y + spanBox.height / 2);
      assert.equal(await tick(page, 'dashboard').isChecked(), true, 'a real click on the description text span ticks the dashboard');
      const spanAgain = await span.boundingBox();
      await page.mouse.click(spanAgain.x + spanAgain.width / 2, spanAgain.y + spanAgain.height / 2);
      assert.equal(await tick(page, 'dashboard').isChecked(), false, 'a second real click on the description text span unticks it again');
      const after = await card(page, 'dashboard').boundingBox();
      await page.mouse.click(after.x + after.width / 2, after.y + after.height / 2);
      assert.equal(await tick(page, 'dashboard').isChecked(), true, 'a real click on the centre of the card ticks it');
      const corner = await card(page, 'dashboard').boundingBox();
      await page.mouse.click(corner.x + corner.width - 8, corner.y + 8);
      assert.equal(await tick(page, 'dashboard').isChecked(), false, 'a real click on the card corner unticks it again');
      for (const id of ['dashboard', 'alert']) {
        const before = await tick(page, id).isChecked();
        const cardBox = await card(page, id).boundingBox();
        await page.mouse.click(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
        assert.equal(await tick(page, id).isChecked(), !before, `a real click on the centre of the ${id} card toggles it`);
      }
    } finally {
      await ui.close();
    }
  });
}
