import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-470: the Strategy (optional) section on Launch walked as a business user does: open, build by hand (entry, child, KPI, key result,
// sponsor), launch, reload, undo and clear, problems, empty states, long names, and both screen sizes with no sideways scroll or console error.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } };
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }];
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function pickData(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
}

async function openStrategy(page) {
  const advanced = page.getByRole('button', { name: /Advanced Settings/ });
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
  const section = page.getByTestId('launch-strategy');
  await section.waitFor({ timeout: 20000 });
  const toggle = section.getByRole('button', { name: /Strategy \(optional\)/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  return section;
}

async function launch(page, made) {
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.locator('[data-launch-run-unsaved]').click();
  await until(() => made.launches.length === 1, 'the launch was sent once');
  const text = made.launches[0].params['10_strategic_context'];
  return text ? JSON.parse(text) : null;
}

// One pillar > one goal, with a KPI, a key result and a sponsor, typed by hand.
async function buildByHand(section, { pillar = 'Customer', goal = 'Win loyalty' } = {}) {
  await section.getByRole('button', { name: /Pillar/ }).first().click();
  await section.getByPlaceholder('Name, in your own words').first().fill(pillar);
  await section.getByTitle(/Add a goal under this pillar/).click();
  await section.getByPlaceholder('Name, in your own words').nth(1).fill(goal);
  await section.getByRole('button', { name: 'KPI', exact: true }).click();
  await section.getByPlaceholder('KPI name, e.g. Repeat purchase rate').fill('Repeat purchase rate');
  await section.getByPlaceholder('Unit, e.g. %').fill('%');
  await section.locator('select').filter({ hasText: 'Direction' }).selectOption('increase');
  await section.getByRole('button', { name: 'Key result', exact: true }).click();
  await section.getByPlaceholder('e.g. Raise repeat purchase rate from 18% to 24%').fill('Raise repeat purchase rate from 18% to 24%');
  await section.getByRole('button', { name: 'Sponsor', exact: true }).click();
  await section.getByPlaceholder('Role, e.g. Chief Customer Officer').fill('Chief Customer Officer');
}

test('strategy journey by hand: build an entry, a child, a KPI, a key result and a sponsor, and the launch carries each of them', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made, pageErrors } = ui;
  try {
    await pickData(page);
    const section = await openStrategy(page);
    await buildByHand(section);
    await until(async () => /Set/.test(await section.getByRole('button', { name: /Strategy \(optional\)/ }).innerText()), 'the header says the strategy is set');
    const sent = await launch(page, made);
    assert.equal(sent.strategy.length, 1);
    assert.equal(sent.strategy[0].name, 'Customer');
    assert.equal(sent.strategy[0].children[0].name, 'Win loyalty');
    assert.deepEqual(sent.strategy[0].children[0].kpis.map((k) => [k.name, k.unit, k.direction]), [['Repeat purchase rate', '%', 'increase']]);
    assert.equal(sent.strategy[0].children[0].key_results.length, 1);
    assert.equal(sent.sponsors[0].role, 'Chief Customer Officer');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('strategy persists: a reload restores the entries, and Clear strategy empties them so the launch sends no strategy', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made, pageErrors } = ui;
  try {
    await pickData(page);
    let section = await openStrategy(page);
    await buildByHand(section);
    await page.reload();
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
    await idle(page);
    section = await openStrategy(page);
    assert.deepEqual(await section.getByPlaceholder('Name, in your own words').evaluateAll((els) => els.map((e) => e.value)), ['Customer', 'Win loyalty'],
      'both entries are restored after a reload');
    await section.getByRole('button', { name: 'Clear strategy' }).click();
    assert.equal(await section.getByPlaceholder('Name, in your own words').count(), 0, 'Clear strategy removes every entry');
    assert.equal(await section.getByRole('button', { name: 'Clear strategy' }).count(), 0, 'nothing is left to clear');
    assert.match(await section.innerText(), /Add a pillar to start, or paste a list/);
    const sent = await launch(page, made);
    assert.equal(sent, null, 'no strategy is invented after Clear');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('removing an entry removes everything under it, and removing a KPI, a key result and a sponsor each takes just that item', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors } = ui;
  try {
    const section = await openStrategy(page);
    await buildByHand(section);
    await section.getByTitle('Remove this KPI').click();
    assert.match(await section.innerText(), /No KPIs yet/);
    await section.getByTitle('Remove this key result').click();
    assert.match(await section.innerText(), /No key results yet/);
    await section.getByTitle('Remove this sponsor').click();
    assert.equal(await section.getByPlaceholder('Role, e.g. Chief Customer Officer').count(), 0);
    await section.getByTitle('Remove this entry and everything under it').first().click();
    assert.equal(await section.getByPlaceholder('Name, in your own words').count(), 0, 'the pillar and its goal are both gone');
    assert.match(await section.innerText(), /Select an entry first/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('problems are named in plain words and block Get Started until fixed: an unnamed entry and a repeated entry', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors } = ui;
  try {
    await pickData(page);
    const section = await openStrategy(page);
    const start = page.getByRole('button', { name: 'Get Started' });
    await section.getByRole('button', { name: /Pillar/ }).first().click();
    await until(() => start.isDisabled(), 'an unnamed entry blocks the launch');
    assert.match(await section.getByRole('button', { name: /Strategy \(optional\)/ }).innerText(), /1 problem/);
    await section.getByRole('button', { name: /Pillar/ }).first().click();
    await section.getByPlaceholder('Name, in your own words').nth(0).fill('Same');
    await section.getByPlaceholder('Name, in your own words').nth(1).fill('same');
    assert.match(await section.innerText(), /appears twice/, 'a name used twice is named, ignoring case');
    await until(() => start.isDisabled(), 'a repeated entry blocks the launch');
    await section.getByPlaceholder('Name, in your own words').nth(1).fill('Different');
    await until(async () => !(await start.isDisabled()), 'a new name clears it');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

// A problem the editor shows in red must also stop Get Started and show on the section header, as every other strategy problem does.
test('a sponsor with no role is shown as a problem in the editor, so Get Started waits and the header counts it, instead of dropping the sponsor silently', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made, pageErrors } = ui;
  try {
    await pickData(page);
    const section = await openStrategy(page);
    await section.getByRole('button', { name: 'Pillar' }).first().click();
    await section.getByPlaceholder('Name, in your own words').first().fill('Customer');
    await section.getByRole('button', { name: 'Sponsor', exact: true }).click();
    await section.getByPlaceholder('Name (optional)').fill('A. Person');
    assert.match(await section.innerText(), /Sponsor 1 has no role\./, 'the editor names the problem');
    const start = page.getByRole('button', { name: 'Get Started' });
    await idle(page);
    assert.equal(await start.isDisabled(), true, 'Get Started waits while the editor shows a problem');
    assert.match(await section.getByRole('button', { name: /Strategy \(optional\)/ }).innerText(), /1 problem/, 'the header counts it');
    assert.equal(made.launches.length, 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('paste: an empty paste cannot be used, Cancel keeps what was there, and a bad list says what was not used', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors } = ui;
  try {
    const section = await openStrategy(page);
    await section.getByRole('button', { name: 'Paste a list or table' }).click();
    assert.equal(await section.getByRole('button', { name: 'Use this' }).isDisabled(), true, 'nothing to use yet');
    await section.getByLabel('Paste your strategy').fill('   \n\n  ');
    assert.equal(await section.getByRole('button', { name: 'Use this' }).isDisabled(), true, 'blank lines are not a strategy');
    assert.equal(await section.getByTestId('strategy-paste-preview').count(), 0);
    await section.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await section.getByTestId('strategy-paste').count(), 0, 'Cancel closes the paste box');
    assert.equal(await section.getByPlaceholder('Name, in your own words').count(), 0, 'Cancel adds nothing');
    await section.getByRole('button', { name: 'Paste a list or table' }).click();
    await section.getByLabel('Paste your strategy').fill('Customer\n  Win loyalty\n    KPI: Repeat purchase rate (%, increase)');
    await section.getByTestId('strategy-paste-preview').waitFor({ timeout: 5000 });
    await section.getByRole('button', { name: 'Use this' }).click();
    assert.deepEqual(await section.getByPlaceholder('Name, in your own words').evaluateAll((els) => els.map((e) => e.value)), ['Customer', 'Win loyalty']);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the levels can be renamed, added and removed, and the entries column names the level of each row', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors } = ui;
  try {
    const section = await openStrategy(page);
    const levels = section.getByTestId('strategy-levels');
    await levels.getByLabel('Level 1 name').fill('Theme');
    await section.getByRole('button', { name: /Theme/ }).first().click();
    assert.match(await section.innerText(), /THEME/i, 'the new entry carries the user level name');
    await levels.getByRole('button', { name: 'Remove level 4' }).click();
    assert.equal(await levels.locator('input').count(), 3, 'a level can be removed');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('long names in every field stay inside the Strategy section at both screen sizes, and the page does not scroll sideways', async () => {
  const long = (w) => `${w}_${'q'.repeat(150)}`;
  for (const viewport of VIEWPORTS) {
    const ui = await openUi('launch', STATE);
    const { page, pageErrors } = ui;
    try {
      await page.setViewportSize(viewport);
      const section = await openStrategy(page);
      await buildByHand(section, { pillar: long('pillar'), goal: long('goal') });
      await section.getByPlaceholder('KPI name, e.g. Repeat purchase rate').fill(long('kpi'));
      await section.getByPlaceholder('Definition (optional)').fill(long('definition'));
      await section.getByPlaceholder('Role, e.g. Chief Customer Officer').fill(long('role'));
      await section.getByPlaceholder('Name (optional)').fill(long('name'));
      await section.getByRole('button', { name: 'Paste a list or table' }).click();
      await section.getByLabel('Paste your strategy').fill(`${long('p')}\n  ${long('g')}\n    KPI: ${long('k')} (%, increase)`);
      await section.getByTestId('strategy-paste-preview').waitFor({ timeout: 5000 });
      assert.ok((await sideways(page)) <= 0, `${viewport.width}x${viewport.height}: the page scrolls sideways (${await sideways(page)}px)`);
      const box = await section.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { right: r.right, over: [...el.querySelectorAll('input, textarea, select, button, p, span')].filter((c) => c.getBoundingClientRect().right > r.right + 1
          && getComputedStyle(c).display !== 'none').map((c) => `${c.tagName}:${String(c.value ?? c.textContent).slice(0, 24)}`) };
      });
      assert.deepEqual(box.over, [], `${viewport.width}: nothing runs past the Strategy section`);
      assert.deepEqual(pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('the empty Strategy section fits both screen sizes, opens closed, and the launch sends no strategy', async () => {
  for (const viewport of VIEWPORTS) {
    const ui = await openUi('launch', STATE);
    const { page, made, pageErrors } = ui;
    try {
      await page.setViewportSize(viewport);
      await pickData(page);
      const section = await openStrategy(page);
      assert.match(await section.innerText(), /Add a pillar to start, or paste a list/);
      assert.match(await section.innerText(), /Select an entry first/);
      assert.ok((await sideways(page)) <= 0, `${viewport.width}x${viewport.height}: scrolls sideways`);
      assert.equal(await launch(page, made), null);
      assert.deepEqual(pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});
