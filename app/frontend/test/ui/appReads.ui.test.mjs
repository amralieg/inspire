import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_READS_LABEL } from '../../src/lib/implementWizard.js';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { BUILD_IT, closeBrowser, expandBuild, openUi, toSummary } from './uiSupport.mjs';

test.after(closeBrowser);

const PERSON = 'person-tok';
const SP = 'app-sp-2';
const CATALOG = 'GRANT USE CATALOG ON CATALOG `main` TO `app-sp-2`';
const SCHEMA = 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-2`';
const SELECT = 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-2`';
const DENIED = "[PERMISSION_DENIED] User does not have MANAGE on Catalog 'main'.";

const unreadBuild = () => {
  const row = built({ status: 'ready_with_warnings' });
  const assets = JSON.parse(row.asset_status);
  assets.app.unread = { app: SP, tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: [CATALOG, SCHEMA, SELECT] }] };
  return { ...row, asset_status: JSON.stringify(assets) };
};

function grantsWorkspace(catalogMine) {
  const held = new Set();
  const grants = [];
  const rows = () => [
    { level: 'catalog', privilege: 'OWNER', principal: catalogMine ? 'owner@example.com' : 'admins', mine: String(catalogMine), me: 'owner@example.com' },
    { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'owner@example.com' },
    { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'owner@example.com' },
    { level: 'schema', privilege: 'MANAGE', principal: 'owner@example.com', mine: 'true', me: 'owner@example.com' },
    ...[...held].map((sql) => {
      const [, privilege, level] = /^GRANT (USE CATALOG|USE SCHEMA|SELECT) ON (\w+)/.exec(sql);
      return { level: level.toLowerCase(), privilege, principal: SP, mine: 'false', me: 'owner@example.com' };
    }),
  ];
  return {
    grants,
    state: {
      ...STUDIO_STATE,
      history: [unreadBuild()],
      forwardedToken: PERSON,
      statements: {
        'system.information_schema.catalogs': () => ({ rows: rows() }),
        'GRANT ': (sql, _p, token) => {
          grants.push([sql, token]);
          if (sql.includes(' ON CATALOG ') && !catalogMine) throw new Error(DENIED);
          held.add(sql);
          return { rows: [] };
        },
      },
    },
  };
}

const allowClipboard = async (page, origin) => { await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin }); };

test('a build whose App cannot read its data ends as action needed and the Build page offers grant, copy and check again', async () => {
  const w = grantsWorkspace(false);
  const ui = await openUi('implement', w.state, '', { init: allowClipboard });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const card = page.getByRole('region', { name: 'The App cannot read part of its data' });
    await card.waitFor();
    assert.match(await card.innerText(), /cannot read main\.s\.orders \(owner data-eng\), so its pages show no data from them yet/);
    assert.deepEqual(await card.getByRole('list', { name: 'Grants the App needs' }).getByRole('listitem').allInnerTexts(), [CATALOG, SCHEMA, SELECT]);
    assert.deepEqual(await card.locator('[data-app-reads-choice]').evaluateAll((els) => els.map((e) => e.dataset.appReadsChoice)), ['grant', 'copy', 'check']);
    await card.getByRole('button', { name: 'Copy the grant SQL to send to data-eng' }).waitFor();
    assert.equal(await page.getByText(APP_READS_LABEL, { exact: true }).count() > 0, true, 'the build reads as action needed, not plain Done');
    assert.equal(await page.locator('[data-app-reads]').getByText(/^Done$/).count(), 0);

    await card.getByRole('button', { name: 'Copy the grant SQL to send to data-eng' }).click();
    await card.getByText('The grant SQL is copied. Send it to data-eng.').waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${CATALOG};\n${SCHEMA};\n${SELECT};`);

    await card.getByRole('button', { name: 'Grant access with my permissions' }).click();
    const result = card.locator('[data-app-reads-result="refused"]');
    await result.waitFor();
    assert.match(await result.innerText(), /Your grant was refused/);
    assert.deepEqual(w.grants, [[CATALOG, PERSON], [SCHEMA, PERSON], [SELECT, PERSON]], 'exactly the listed grants run, as the person');
    assert.deepEqual(await card.getByRole('list', { name: 'Grants the App needs' }).getByRole('listitem').allInnerTexts(), [CATALOG], 'what is left stays listed');
    assert.deepEqual(await card.locator('[data-app-reads-choice]').evaluateAll((els) => els.map((e) => e.dataset.appReadsChoice)), ['grant', 'copy', 'check'],
      'a refused grant keeps every choice');

    w.grants.length = 0;
    await card.getByRole('button', { name: 'Check again' }).click();
    await card.locator('[data-app-reads-result="check"]').waitFor();
    assert.deepEqual(w.grants, [], 'Check again grants nothing');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('when the person can grant everything the card says the App reads its data and drops the choices', async () => {
  const w = grantsWorkspace(true);
  const ui = await openUi('implement', w.state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const card = page.locator('[data-app-reads]');
    await card.getByRole('button', { name: 'Grant access with my permissions' }).click();
    await card.getByText('The App can read all its data now', { exact: true }).first().waitFor();
    assert.equal(await card.locator('[data-app-reads-choice]').count(), 0);
    assert.deepEqual(w.grants.map(([sql]) => sql), [CATALOG, SCHEMA, SELECT]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a build whose App reads everything shows no access card (must-exclude)', async () => {
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [built({ status: 'ready_with_warnings' })] });
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(ui.page);
    await ui.page.locator('[data-mvp-progress]').waitFor();
    assert.equal(await ui.page.locator('[data-app-reads]').count(), 0);
    assert.equal(await ui.page.getByText(APP_READS_LABEL, { exact: true }).count(), 0);
  } finally {
    await ui.close();
  }
});

test('the wizard warns on Summary when Inspire cannot share a picked table with the App it will make, naming the table and owner', async () => {
  const readsOnly = [
    { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'inspire-sp' },
    { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
    { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
    { level: 'table', privilege: 'SELECT', principal: 'inspire-sp', mine: 'true', me: 'inspire-sp' },
  ];
  for (const [rows, warned] of [[readsOnly, true], [[{ ...readsOnly[0], principal: 'inspire-sp', mine: 'true' }, ...readsOnly.slice(1, 3)], false]]) {
    const ui = await openUi('wizard', { accessBySchema: { s: rows } });
    try {
      await toSummary(ui.page);
      await ui.page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled), BUILD_IT, { timeout: 30000 });
      const note = ui.page.getByRole('note', { name: 'Data the new App cannot read' });
      if (warned) {
        await note.waitFor();
        const said = await note.textContent();
        assert.match(said, /^Inspire cannot share main\.s\.orders \(owner admins and data-eng\)/);
        assert.match(said, /the Build page offers Grant access with my permissions/);
      } else {
        await ui.page.waitForTimeout(1500);
        assert.equal(await note.count(), 0, 'no warning when Inspire manages the data (must-exclude)');
      }
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});
