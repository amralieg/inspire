import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist, until } from './harness.mjs';

const TABLE = 'main.pricing.items';
const UNREAD = { [TABLE]: ['GRANT SELECT ON TABLE `main`.`pricing`.`items` TO `sp-1`'] };
const OWNERS = { [TABLE]: 'data-eng' };
const GRANTS = ['GRANT USE SCHEMA ON SCHEMA `main`.`pricing` TO `sp-1`', 'GRANT SELECT ON TABLE `main`.`pricing`.`items` TO `sp-1`'];
const FOUND = { tables: [{ table: TABLE, owner: 'data-eng', grants: GRANTS }], can_grant: true, sql: GRANTS.map((g) => `${g};`).join('\n'), seen: 'a'.repeat(64) };
const CLEAR = { tables: [], can_grant: false, sql: '', seen: 'b'.repeat(64) };
const EVIL = 'GRANT ALL PRIVILEGES ON CATALOG `main` TO `attacker`';

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

function accessRoutes({ refuse = false } = {}) {
  const state = { bodies: [], granted: false };
  const routes = {
    access: ({ route, json }) => {
      const body = route.request().postDataJSON();
      state.bodies.push(body);
      if (body.step === 'grant') {
        if (refuse) return json(403, { error: 'Unity Catalog did not let you grant USE SCHEMA on main.pricing. Ask data-eng to grant it; Copy the grant SQL to send it.', access: FOUND, granted: [] });
        state.granted = true;
        return json(200, { ...CLEAR, granted: GRANTS });
      }
      return json(200, state.granted ? CLEAR : FOUND);
    },
  };
  return { state, routes };
}

const grants = (state) => state.bodies.filter((b) => b.step === 'grant');

test('the banner grants with the person\'s permissions only after Confirm, sends no statement, and reloads the page clear', async () => {
  const errors = { 'chart:pareto': `No access to ${TABLE}` };
  const { state, routes } = accessRoutes();
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ unread: UNREAD, unread_owners: OWNERS }), { errors, routes });
  try {
    const banner = page.locator('[data-no-access-banner]');
    await banner.getByRole('button', { name: 'Grant access with my permissions' }).waitFor();
    assert.equal(await banner.getByRole('button', { name: 'Copy the grant SQL' }).count(), 1);
    assert.equal(await banner.getByRole('button', { name: 'Check again' }).count(), 1);
    assert.deepEqual(state.bodies.map((b) => b.step), ['diagnose']);
    await banner.getByRole('button', { name: 'Grant access with my permissions' }).click();
    await banner.getByText(`Run 2 grants in Unity Catalog as you, so this App can read ${TABLE}?`).waitFor();
    assert.equal(grants(state).length, 0, 'pressing Grant only asks; nothing runs before Confirm');
    await banner.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(grants(state).length, 0, 'Cancel runs nothing (must-exclude)');
    await banner.getByRole('button', { name: 'Grant access with my permissions' }).click();
    const asked = seen.pages.length;
    for (const key of Object.keys(errors)) delete errors[key];
    await banner.getByRole('button', { name: 'Confirm grant' }).click();
    await until(() => grants(state).length === 1);
    assert.deepEqual(grants(state)[0], { step: 'grant', confirmed: true, seen: FOUND.seen }, 'the browser sends no SQL, only what it saw');
    await until(() => seen.pages.length > asked, 10000);
    await page.locator('[data-no-access-banner]').waitFor({ state: 'detached' });
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('a refused grant names the owner, keeps the buttons, and Copy shows the server SQL', async () => {
  const errors = { 'chart:pareto': `No access to ${TABLE}` };
  const { state, routes } = accessRoutes({ refuse: true });
  const { page, context } = await openApp(browser, served.base, appInfo({ unread: UNREAD, unread_owners: OWNERS }), { errors, routes });
  try {
    const banner = page.locator('[data-no-access-banner]');
    await banner.getByRole('button', { name: 'Grant access with my permissions' }).click();
    await banner.getByRole('button', { name: 'Confirm grant' }).click();
    const refused = banner.locator('[data-access-error]');
    await refused.waitFor();
    assert.match(await refused.innerText(), /did not let you grant USE SCHEMA on main\.pricing\. Ask data-eng/);
    assert.equal(await page.locator('[data-no-access-banner]').count(), 1, 'the banner stays after a refusal');
    await banner.getByRole('button', { name: 'Copy the grant SQL' }).click();
    await banner.locator('[data-access-sql]').waitFor();
    assert.equal(await banner.locator('[data-access-sql]').innerText(), FOUND.sql);
    assert.deepEqual(state.bodies.map((b) => b.step), ['diagnose', 'grant', 'copy']);
  } finally {
    await context.close();
  }
});

test('Genie answers why there is no data with the banner\'s own buttons, and its card never grants before Confirm', async () => {
  const errors = { 'chart:pareto': `No access to ${TABLE}` };
  const { state, routes } = accessRoutes();
  const turn = {
    turn_id: 't1', state: 'done', answer: `This App cannot read ${TABLE} yet; data-eng owns it. ${EVIL}`,
    steps: [{ tool: 'app_access', text: `Checked what this App cannot read: ${TABLE}` }], actions: [],
    confirm: { kind: 'access', access: FOUND, rows: [], label: 'Give this App read access' },
    genie: null, model: 'system.ai.claude-sonnet-4-6', refused: false, conversation_id: '', error: '',
  };
  Object.assign(routes, {
    'agent/status': ({ json }) => json(200, { mode: 'agent', note: '', page: 'n01_u05', genie: true, model: 'system.ai.claude-sonnet-4-6' }),
    'agent/ask': ({ json }) => json(200, { ...turn, state: 'running', answer: '', confirm: null }),
    'agent/turn': ({ json }) => json(200, turn),
  });
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ unread: UNREAD, unread_owners: OWNERS }), { errors, routes });
  try {
    await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
    await page.getByRole('textbox', { name: 'Your question' }).fill('Why is this chart red and why is there no data?');
    await page.getByRole('button', { name: 'Send' }).click();
    const card = page.locator('[data-confirm="access"] [data-access-actions]');
    await card.waitFor();
    const banner = page.locator('[data-no-access-banner] [data-access-actions]');
    const labels = (el) => el.getByRole('button').evaluateAll((bs) => bs.map((b) => b.textContent.trim()));
    assert.deepEqual(await labels(card), await labels(banner), 'Genie shows the banner\'s own buttons');
    assert.equal(grants(state).length, 0);
    await card.getByRole('button', { name: 'Grant access with my permissions' }).click();
    assert.equal(grants(state).length, 0, 'the Genie card asks first, like the banner');
    const asked = seen.pages.length;
    for (const key of Object.keys(errors)) delete errors[key];
    await card.getByRole('button', { name: 'Confirm grant' }).click();
    await until(() => grants(state).length === 1);
    assert.deepEqual(grants(state)[0], { step: 'grant', confirmed: true, seen: FOUND.seen });
    await card.getByText('You granted 2 read permissions to this App.').waitFor();
    await until(() => seen.pages.length > asked, 10000);
    await page.locator('[data-no-access-banner]').waitFor({ state: 'detached' });
  } finally {
    await context.close();
  }
});
