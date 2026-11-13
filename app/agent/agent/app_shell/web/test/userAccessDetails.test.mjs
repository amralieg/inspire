import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';

// A user-authorization App: the viewer reads the scope view with their own access. The waiting card's Details must show
// the exact GRANT the viewer needs, naming them, so the owner can run it.
const VIEW = 'main.s.orders_scope';
const VIEWER = 'ana@example.com';
const GRANTS = [
  `GRANT USE CATALOG ON CATALOG \`main\` TO \`${VIEWER}\``,
  `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${VIEWER}\``,
  `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${VIEWER}\``,
];
const WAITING = {
  state: 'waiting_for_access',
  message: 'This App is waiting for access to its data. Your data owner needs to grant the App access; the exact grant is under Details.',
  tables: [VIEW],
  detail: `No access to ${VIEW}`,
};

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

test('the waiting card of a user-authorization App shows the viewer the exact grant, naming them', async () => {
  const routes = {
    page: ({ json }) => json(200, WAITING),
    access: ({ json }) => json(200, { tables: [{ table: VIEW, owner: 'data-eng', grants: GRANTS, you_can_grant: false }],
      can_grant: false, sql: GRANTS.map((g) => `${g};`).join('\n'), seen: 'seen-1' }),
  };
  const { page, context } = await openApp(browser, served.base, appInfo({ auth: 'user' }, 1, {}), { width: 1440, height: 900, ready: '[data-waiting-for-access]', routes });
  try {
    const card = page.locator('[data-waiting-for-access]');
    await card.waitFor({ timeout: 20000 });
    await page.locator('[data-waiting-details]').evaluate((d) => { d.open = true; });
    const text = await card.innerText();
    for (const grant of GRANTS) assert.ok(text.includes(grant), `the card shows: ${grant}\n${text}`);
    assert.ok(text.includes(VIEWER), 'the grant names the viewer');
  } finally {
    await context.close();
  }
});
