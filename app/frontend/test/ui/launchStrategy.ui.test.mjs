import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const STATE = { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } };

async function pickData(page) {
  await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
}

async function openStrategy(page) {
  const section = page.getByTestId('launch-strategy');
  await section.waitFor({ timeout: 20000 });
  const toggle = section.getByRole('button', { name: /Strategy \(optional\)/ });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'the section starts closed, so the default page is unchanged');
  assert.match(await toggle.innerText(), /For example: Customer › Win loyalty, measured by Repeat purchase rate/);
  await toggle.click();
  return section;
}

test('the Strategy (optional) section renames a level, imports a pasted list through a preview, and sends the user level names with the launch', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors, made } = ui;
  try {
    const section = await openStrategy(page);
    const levels = section.getByTestId('strategy-levels');
    assert.deepEqual(await levels.locator('input').evaluateAll((inputs) => inputs.map((i) => i.value)), ['Pillar', 'Goal', 'Objective', 'Priority']);
    await section.getByLabel('Level 1 name').fill('Theme');
    await section.getByRole('button', { name: 'Paste a list or table' }).click();
    await section.getByLabel('Paste your strategy').fill([
      'Customer',
      '  Win loyalty',
      '    KPI: Repeat purchase rate (%, increase)',
      '    Sponsor: Chief Customer Officer | reports to Chief Executive Officer',
      'Operations',
      '  Run lean',
      'Sponsor: Chief Executive Officer',
    ].join('\n'));
    const preview = section.getByTestId('strategy-paste-preview');
    assert.match(await preview.innerText(), /Preview: 4 entries, 1 KPI, 0 key results, 2 sponsors/);
    assert.match(await preview.innerText(), /THEME\s*Customer/i, 'the preview names each row by the user level name');
    await section.getByRole('button', { name: 'Use this' }).click();
    assert.equal(await section.getByTestId('strategy-paste').count(), 0);
    await pickData(page);
    await page.getByRole('button', { name: 'Get Started' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    const sent = JSON.parse(made.launches[0].params['10_strategic_context']);
    assert.deepEqual(sent.levels, ['Theme', 'Goal', 'Objective', 'Priority']);
    assert.equal(sent.priority_level, 'Priority');
    assert.deepEqual(sent.strategy, [
      { name: 'Customer', children: [{ name: 'Win loyalty', kpis: [{ name: 'Repeat purchase rate', unit: '%', direction: 'increase' }] }] },
      { name: 'Operations', children: [{ name: 'Run lean' }] },
    ]);
    assert.deepEqual(sent.sponsors, [
      { role: 'Chief Customer Officer', reports_to: 'Chief Executive Officer', owns: ['Win loyalty'] },
      { role: 'Chief Executive Officer' },
    ]);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('with the strategy left alone the launch sends no strategy, and a level name used twice blocks the launch', async () => {
  const quiet = await openUi('launch', STATE);
  try {
    await quiet.page.getByTestId('launch-strategy').waitFor({ timeout: 20000 });
    await pickData(quiet.page);
    await quiet.page.getByRole('button', { name: 'Get Started' }).click();
    await until(() => quiet.made.launches.length === 1, 'the launch was sent once');
    assert.equal(quiet.made.launches[0].params['10_strategic_context'], '', 'no strategy is invented (must-exclude)');
  } finally {
    await quiet.close();
  }
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    const section = await openStrategy(page);
    await section.getByRole('button', { name: 'Paste a list or table' }).click();
    await section.getByLabel('Paste your strategy').fill('Customer\n  Win loyalty');
    await section.getByRole('button', { name: 'Use this' }).click();
    await pickData(page);
    const start = page.getByRole('button', { name: 'Get Started' });
    await until(async () => !(await start.isDisabled()), 'Get Started opens with a clean strategy');
    await section.getByLabel('Level 2 name').fill('pillar');
    assert.match(await section.innerText(), /The level name "pillar" is used twice/);
    await until(() => start.isDisabled(), 'nothing can be launched with a broken strategy');
    assert.match(await section.getByRole('button', { name: /Strategy \(optional\)/ }).innerText(), /1 problem/);
    await page.waitForTimeout(1500);
    assert.equal(await start.isDisabled(), true, 'it stays closed while the problem is there');
    await section.getByLabel('Level 2 name').fill('Goal');
    await until(async () => !(await start.isDisabled()), 'Get Started opens again once the level is renamed');
    assert.equal(made.launches.length, 0);
  } finally {
    await ui.close();
  }
});
