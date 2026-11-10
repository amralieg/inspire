import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { built } from './implementFixtures.js';
import { cardAssetLinks } from '../../src/lib/implementControl.js';
import { archiveKeyOf, inArchiveView, loadArchiveMap, toggledArchive } from '../../src/lib/useCaseArchive.js';

test.after(closeBrowser);

const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cards = (page) => list(page).locator('[aria-expanded]');
const cardOf = (page, no) => page.locator(`[data-use-case-no="${no}"]`);
const shownNos = (page) => page.locator('[data-use-case-no]').evaluateAll((els) => els.map((el) => el.getAttribute('data-use-case-no')));
const view = (page, id) => page.locator(`[data-archive-view="${id}"]`);

const memory = () => {
  const data = {};
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};

test('a built card links each delivered asset once, in a fixed order, and never an undelivered, unbuilt or non-https one (must-exclude)', () => {
  const latest = { ...built(), asset_status: JSON.parse(built().asset_status) };
  assert.deepEqual(cardAssetLinks(latest).map((l) => [l.label, l.url]), [
    ['Open App', 'https://churn-desk-1.aws.databricksapps.com'],
    ['Open Dashboard', 'https://workspace.example.com/dashboardsv3/d1/published'],
    ['Open Genie Agent', 'https://workspace.example.com/genie/rooms/g1'],
    ['Open alert', 'https://workspace.example.com/sql/alerts-v2/a1'],
  ]);
  assert.deepEqual(cardAssetLinks({ ...latest, app_url: 'javascript:alert(1)' }).map((l) => l.id), ['dashboard', 'genie_space', 'alert'], 'a non-https URL is never a link');
  assert.deepEqual(cardAssetLinks({ ...latest, dashboard_url: '', dashboard_id: '' }).map((l) => l.id), ['app', 'genie_space', 'alert'], 'no dashboard, no dashboard link');
  assert.deepEqual(cardAssetLinks(null), []);
  assert.deepEqual(cardAssetLinks({}), []);
});

test('archive keys carry the run, so archiving a use case in one run never hides the same id in another run (must-exclude)', () => {
  const store = memory();
  const uc = { No: 'N01-U01', Name: 'Churn' };
  assert.notEqual(archiveKeyOf('42', uc), archiveKeyOf('41', uc));
  assert.equal(archiveKeyOf('', uc), '', 'no run, no key');
  assert.equal(archiveKeyOf('42', {}), '', 'no id, no key');
  let map = toggledArchive({}, archiveKeyOf('42', uc), store);
  assert.deepEqual(loadArchiveMap(store), { '42|N01-U01': true }, 'the archive survives a reload');
  assert.equal(Boolean(map[archiveKeyOf('41', uc)]), false);
  map = toggledArchive(map, archiveKeyOf('42', uc), store);
  assert.deepEqual(loadArchiveMap(store), {}, 'unarchive removes the key');
  assert.equal(inArchiveView('active', false), true);
  assert.equal(inArchiveView('active', true), false);
  assert.equal(inArchiveView('archived', true), true);
  assert.equal(inArchiveView('archived', false), false);
  assert.deepEqual(loadArchiveMap({ getItem: () => '[1,2]' }), {}, 'a corrupt store reads as nothing archived');
});

test('Review: Archive moves a card from Active to Archived, the counts follow, Unarchive brings it back, and the built card shows Open MVP plus a link per built asset', async () => {
  const ui = await openUi('results', REVIEW_STATE);
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await cards(page).first().waitFor();
    await idle(page);
    const before = await shownNos(page);
    assert.ok(before.length >= 2, 'the fixture shows at least 2 use cases');
    assert.equal(await view(page, 'active').getAttribute('aria-pressed'), 'true', 'Active is the default view');
    assert.match(await view(page, 'active').innerText(), new RegExp(`${before.length}$`));
    assert.match(await view(page, 'archived').innerText(), /0$/);

    const builtCard = cardOf(page, 'N01-U01');
    await builtCard.getByRole('button', { name: 'Open MVP' }).waitFor();
    const links = await builtCard.locator('[data-card-asset]').evaluateAll((els) => els.map((el) => [el.textContent.trim(), el.getAttribute('href'), el.getAttribute('target')]));
    assert.deepEqual(links, [
      ['Open App', 'https://churn-desk-1.aws.databricksapps.com', '_blank'],
      ['Open Dashboard', 'https://workspace.example.com/dashboardsv3/d1/published', '_blank'],
      ['Open Genie Agent', 'https://workspace.example.com/genie/rooms/g1', '_blank'],
      ['Open alert', 'https://workspace.example.com/sql/alerts-v2/a1', '_blank'],
    ]);
    const other = before.find((no) => no !== 'N01-U01');
    assert.equal(await cardOf(page, other).locator('[data-card-asset]').count(), 0, 'a card with no MVP shows no asset link');

    await builtCard.getByRole('button', { name: 'Archive use case' }).click();
    await until(async () => !(await shownNos(page)).includes('N01-U01'));
    assert.deepEqual(await shownNos(page), before.filter((no) => no !== 'N01-U01'), 'only the archived card leaves the Active list');
    assert.match(await view(page, 'archived').innerText(), /1$/);

    await view(page, 'archived').click();
    await until(async () => (await shownNos(page)).join() === 'N01-U01');
    await cardOf(page, 'N01-U01').getByRole('button', { name: 'Unarchive use case' }).click();
    await list(page).locator('[data-archive-empty="archived"]').waitFor();
    await view(page, 'active').click();
    await until(async () => (await shownNos(page)).length === before.length);
    assert.deepEqual((await shownNos(page)).sort(), [...before].sort(), 'Unarchive brings the card back to Active');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

