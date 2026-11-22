import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { closeBrowser, openGrantFromCard, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-206: Permission Required is a modal. Escape closes it, its Close control and header stay in the viewport at the sizes a
// walker uses, the body scrolls inside it, and Tab stays inside it while it is open.
const SP = 'app-sp-2';
const CATALOG = 'GRANT USE CATALOG ON CATALOG `main` TO `app-sp-2`';
const SCHEMA = 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-2`';
const TABLES = Array.from({ length: 30 }, (_, i) => `orders_lakebase_${i}`);
const SIZES = [[1280, 800], [1440, 900], [1024, 700]];

function unreadBuild() {
  const row = built({ status: 'ready_with_warnings' });
  const assets = JSON.parse(row.asset_status);
  assets.app.unread = {
    app: SP,
    tables: TABLES.map((t) => ({
      table: `main.s.${t}`, owner: 'data-eng',
      grants: [CATALOG, SCHEMA, `GRANT SELECT ON TABLE \`main\`.\`s\`.\`${t}\` TO \`app-sp-2\``, `GRANT READ METADATA ON TABLE \`main\`.\`s\`.\`${t}\` TO \`app-sp-2\``],
    })),
  };
  return { ...row, asset_status: JSON.stringify(assets) };
}

function workspace() {
  const held = new Set();
  const rows = () => [
    { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'owner@example.com' },
    { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'owner@example.com' },
    { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'owner@example.com' },
    { level: 'schema', privilege: 'MANAGE', principal: 'owner@example.com', mine: 'true', me: 'owner@example.com' },
    ...[...held].map((sql) => {
      const [, privilege, level] = /^GRANT (USE CATALOG|USE SCHEMA|SELECT|READ METADATA) ON (\w+)/.exec(sql);
      return { level: level.toLowerCase(), privilege, principal: SP, mine: 'false', me: 'owner@example.com' };
    }),
  ];
  return {
    ...STUDIO_STATE,
    history: [unreadBuild()],
    forwardedToken: 'person-tok',
    tokenKind: 'app',
    abacUnreadable: (token) => token === 'tok' && held.size === 0,
    workspace: ({ token, path }) => (path.includes('/scim/v2/Me')
      ? [token === 'tok' ? { displayName: 'inspire-manual', applicationId: SP } : { userName: 'owner@example.com', displayName: 'Owner' }]
      : undefined),
    statements: {
      'system.information_schema.catalogs': () => ({ rows: rows() }),
      'GRANT ': (sql) => {
        if (sql.includes(' ON CATALOG ')) throw new Error("[PERMISSION_DENIED] User does not have MANAGE on Catalog 'main'.");
        held.add(sql);
        return { rows: [] };
      },
    },
  };
}

for (const [width, height] of SIZES) {
  test(`Permission Required at ${width}x${height}: Escape closes it, and its header with Close stays in the viewport while the body scrolls`, async () => {
    const ui = await openUi('implement', workspace());
    const { page } = ui;
    try {
      await page.setViewportSize({ width, height });
      const dialog = page.locator('[data-permission-dialog=""]');
      await openGrantFromCard(page);
      await dialog.waitFor({ timeout: 15000 });
      // A long permission list (the walker's Lakebase CREATE grant) is simulated with a tall block after the statements.
      await page.evaluate(() => {
        const filler = document.createElement('div');
        filler.style.height = '2000px';
        document.querySelector('[data-permission-statements]').after(filler);
      });
      const panel = dialog.locator('[role="dialog"]');
      const close = panel.getByRole('button', { name: 'Close', exact: true });
      const box = await close.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= height, `the Close control is inside the ${width}x${height} viewport: ${JSON.stringify(box)}`);
      const heading = await panel.locator('#permission-required-title').boundingBox();
      assert.ok(heading && heading.y >= 0 && heading.y + heading.height <= height, 'the header stays in the viewport');
      const fits = await page.evaluate(() => {
        const p = document.querySelector('[data-permission-dialog] [role="dialog"]');
        return p ? p.getBoundingClientRect().height <= window.innerHeight : false;
      });
      assert.equal(fits, true, 'the modal fits the viewport');
      const scrolls = await page.evaluate(() => {
        const body = [...document.querySelectorAll('[data-permission-dialog] [role="dialog"] *')].find((el) => el.scrollHeight > el.clientHeight
          && getComputedStyle(el).overflowY === 'auto');
        return Boolean(body);
      });
      assert.equal(scrolls, true, 'the body of the modal scrolls when its statements do not fit');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => null);
      assert.equal(await dialog.count(), 0, 'Escape closes Permission Required');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

test('Tab stays inside Permission Required while it is open, and the modal keeps focus until it closes', async () => {
  const ui = await openUi('implement', workspace());
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dialog = page.locator('[data-permission-dialog=""]');
    await openGrantFromCard(page);
    await dialog.waitFor({ timeout: 15000 });
    const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest('[data-permission-dialog] [role="dialog"]')));
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      assert.equal(await inside(), true, `Tab ${i + 1} keeps focus inside the modal`);
    }
    assert.equal(await dialog.count(), 1, 'the modal is still open after the focus cycle');
  } finally {
    await ui.close();
  }
});
