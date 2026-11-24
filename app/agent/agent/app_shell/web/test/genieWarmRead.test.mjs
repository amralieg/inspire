// REQ-506: a grant on the full-height Genie screen re-reads the page in the shell; going back to the dashboard shows that fresh read
// at once, with no stale no-access banner and no second read of the same page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist, until } from './harness.mjs';

const TABLE = 'main.pricing.items';
const UNREAD = { [TABLE]: ['GRANT SELECT ON TABLE `main`.`pricing`.`items` TO `sp-1`'] };
const OWNERS = { [TABLE]: 'data-eng' };
const GRANTS = ['GRANT USE SCHEMA ON SCHEMA `main`.`pricing` TO `sp-1`', 'GRANT SELECT ON TABLE `main`.`pricing`.`items` TO `sp-1`'];
const FOUND = { tables: [{ table: TABLE, owner: 'data-eng', grants: GRANTS, you_can_grant: true }], can_grant: true, you_can_grant: true, sql: GRANTS.map((g) => `${g};`).join('\n'), seen: 'a'.repeat(64) };
const CLEAR = { tables: [], can_grant: false, sql: '', seen: 'b'.repeat(64) };

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

const tileErrors = (page) => page.locator('.tile-err').evaluateAll((els) => els.map((e) => e.innerText.trim()));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('after a grant on the Genie screen, the dashboard shows the fresh read with no banner and no second read', async () => {
  const errors = { 'chart:pareto': `No access to ${TABLE}` };
  const state = { granted: false, steps: [] };
  const turn = {
    turn_id: 't1', state: 'done', answer: `This App cannot read ${TABLE} yet; data-eng owns it.`,
    steps: [{ tool: 'app_access', text: `Checked what this App cannot read: ${TABLE}` }], actions: [],
    confirm: { kind: 'access', access: FOUND, rows: [], label: 'Give this App read access' },
    genie: null, model: 'system.ai.claude-sonnet-4-6', refused: false, conversation_id: '', error: '',
  };
  const routes = {
    'access-request/check': ({ json }) => json(200, { offered: false, destinations: [], reason: 'no one has set up where access requests for these go yet' }),
    access: ({ route, json }) => {
      const body = route.request().postDataJSON();
      state.steps.push(body.step);
      if (body.step === 'grant') { state.granted = true; return json(200, { ...CLEAR, granted: GRANTS }); }
      return json(200, state.granted ? CLEAR : FOUND);
    },
    'agent/status': ({ json }) => json(200, { mode: 'agent', note: '', page: 'n01_u05', genie: true, model: 'system.ai.claude-sonnet-4-6' }),
    'agent/ask': ({ json }) => json(200, { ...turn, state: 'running', answer: '', confirm: null }),
    'agent/turn': ({ json }) => json(200, turn),
  };
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ unread: UNREAD, unread_owners: OWNERS }), { errors, routes, hash: '#/n01_u05/dashboard' });
  try {
    await page.locator('[data-permission-dialog]').waitFor();
    assert.deepEqual(await tileErrors(page), [`No access to ${TABLE}`], 'the dashboard starts without access (must-fail precondition)');
    await page.locator('[data-mode-switch] [data-mode="genie"]').click();
    await page.locator('[data-genie-full]').waitFor();
    await page.getByRole('textbox', { name: 'Your question' }).fill('Why is there no data?');
    await page.getByRole('button', { name: 'Send' }).click();
    const card = page.locator('[data-confirm="access"] [data-access-actions]');
    await card.getByRole('button', { name: 'Grant access with my permissions' }).click();
    const asked = seen.pages.length;
    for (const key of Object.keys(errors)) delete errors[key];
    await card.getByRole('button', { name: 'Confirm grant' }).click();
    await card.getByText('You granted 2 read permissions to this App.').waitFor();
    await until(() => seen.pages.length > asked, 10000);
    await pause(500);
    const reread = seen.pages.length;

    await page.evaluate(() => { window.location.hash = '#/n01_u05/dashboard'; });
    await page.locator('[data-card="pareto"] canvas').waitFor();
    assert.equal(await page.locator('[data-permission-dialog]').count(), 0, 'no stale no-access banner on the dashboard');
    assert.deepEqual(await tileErrors(page), [], 'the dashboard shows the fresh rows the shell read after the grant');
    await pause(1000);
    assert.equal(seen.pages.length, reread, 'the dashboard uses the shell\'s fresh read; the page is not read a second time');
    assert.ok(state.steps.includes('grant'));
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});
