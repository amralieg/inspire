import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';

const TABLE = 'main.pricing.items';
const UNREAD = { [TABLE]: ['GRANT SELECT ON TABLE `main`.`pricing`.`items` TO `sp-1`'] };
const OWNERS = { [TABLE]: 'data-eng' };
const WAITING = {
  state: 'waiting_for_access',
  message: 'This App is waiting for access to its data. Your data owner needs to grant the App access; the exact grant is under Details.',
  tables: [TABLE], owners: ['data-eng'], detail: `[PERMISSION_DENIED] User does not have SELECT on Table '${TABLE}'.`,
};
const NO_ACCESS_CARD = 'Ask data-eng to grant it';
const FOUND = { tables: [], can_grant: false, you_can_grant: false, sql: '', seen: 'c'.repeat(64) };

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

const compact = (page) => page.locator('[data-waiting-compact]');

async function assertCompact(page) {
  await compact(page).first().waitFor({ timeout: 15000 });
  const text = await compact(page).first().innerText();
  assert.match(text, /^The App cannot read the tables this page uses yet, so its numbers and records stay empty until access is granted\./);
  assert.match(text, new RegExp(NO_ACCESS_CARD));
  assert.doesNotMatch(text, /@/, 'no internal email');
  assert.doesNotMatch(text, /No access to /, 'the refused section never shows the old per-section text');
}

const ALERTS = { options: { modify: false, replace_edits: false, decisions: true, alerts: true }, alert_folder: '/Workspace/Users/owner/alerts' };

const common = () => ({
  access: ({ json }) => json(200, FOUND),
});

test('Runs shows the one waiting text, with the owner and the access actions, when its read is refused (REQ-040)', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo({ unread: UNREAD, unread_owners: OWNERS }), {
    hash: '#/n01_u05/runs', routes: { ...common(), runs: ({ json }) => json(200, WAITING) },
  });
  try {
    await assertCompact(page);
    assert.equal(await compact(page).first().getByRole('button', { name: 'Check again' }).count(), 1);
  } finally {
    await context.close();
  }
});

test('Records shows the one waiting text when its list read is refused (REQ-040)', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo({ unread: UNREAD, unread_owners: OWNERS }), {
    hash: '#/n01_u05/work', routes: { ...common(), records: ({ json }) => json(200, WAITING) },
  });
  try {
    await assertCompact(page);
  } finally {
    await context.close();
  }
});

test('Alerts shows the one waiting text when its alerts read is refused (REQ-040)', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo({ ...ALERTS, unread: UNREAD, unread_owners: OWNERS }), {
    hash: '#/n01_u05?v=alerts', routes: { ...common(), alerts: ({ json }) => json(200, WAITING) },
  });
  try {
    await assertCompact(page);
  } finally {
    await context.close();
  }
});

test('Genie shows the one waiting text in its answer when the App cannot read the data (REQ-040)', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo({ unread: UNREAD, unread_owners: OWNERS }), {
    routes: {
      ...common(),
      'agent/status': ({ json }) => json(200, { mode: 'agent', note: '', page: 'n01_u05', genie: true, model: 'system.ai.claude-sonnet-4-6' }),
      'agent/ask': ({ json }) => json(200, WAITING),
      'genie/ask': ({ json }) => json(200, WAITING),
    },
  });
  try {
    await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
    await page.getByRole('textbox', { name: 'Your question' }).fill('Why is there no data?');
    await page.getByRole('button', { name: 'Send' }).click();
    await assertCompact(page);
  } finally {
    await context.close();
  }
});
