import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertFitsScreen, assertOneBadgeOnDefault, choicesShown, closeBrowser, dataToResults, lowContrast, idle, onStep, openAdvanced, openUi, painted, setDark, settled, startMvp, toAppAccess, toSharedAccess, toSummary, toVibes, until, watchAsks, wizardFit, goToStep } from './uiSupport.mjs';
import { LAKEBASE_ABSENT, LAKEBASE_PER_USER_REASON } from '../../src/lib/implementWizard.js';
import { wheelScrolls } from './wheelScroll.mjs';

const { appShellCatalog } = createRequire(import.meta.url)('../../../backend/lib/appShell.js');
const SHELL = appShellCatalog();
const OWNER = ['owner', 'example.com'].join('@');
const SHOTS = process.env.WIZARD_SHOTS || '';
const DATED = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];

test.after(closeBrowser);

const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const footerErrors = (page) => page.locator('[role="alert"] p').allTextContents();

async function toDelivery(page) {
  await goToStep(page, 'Data');
  await dataToResults(page);
  await goToStep(page, 'What to build');
}

async function startWhenReady(page) {
  await startMvp(page);
  await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
}

function submittedSpec(made) {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1);
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
}

const rgb = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return `rgb(${parseInt(full.slice(0, 2), 16)}, ${parseInt(full.slice(2, 4), 16)}, ${parseInt(full.slice(4, 6), 16)})`;
};

test('the App starts on with its Genie Agent locked on and the alert off, App access starts with each person signing in, per-user keeps record decisions and hides alerts, and App look previews every style, layout and palette', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, columns: DATED });
  const { page, made } = ui;
  try {
    await toDelivery(page);
    const genie = page.getByRole('checkbox', { name: /^Genie Agent/ });
    const box = (name) => page.getByRole('checkbox', { name: new RegExp(`^${name}`) });
    assert.deepEqual([await box('Dashboard').isChecked(), await genie.isChecked(), await box('App ').isChecked(), await box('Alert').isChecked()],
      [false, true, true, false], 'the Genie Agent and App start on, the dashboard and the alert off');
    assert.equal(await genie.isDisabled(), true, 'the App locks the Genie Agent');
    await page.locator('[data-output="genie_space"]').getByText('Ask Genie in the App needs a Genie Agent.').waitFor();
    await toAppAccess(page);
    const access = page.getByRole('region', { name: 'App access' });
    const perUser = access.getByRole('radio', { name: /^Sensitive data: each person signs in as themselves \(per-user\)/ });
    const internal = access.getByRole('radio', { name: /^Internal data: everyone sees the same rows/ });
    assert.deepEqual([await perUser.isChecked(), await internal.isChecked()], [true, false], 'the App starts with each person signing in as themselves');
    await access.getByText('Each person sees only the rows their own access allows.', { exact: true }).waitFor();
    await access.getByText('The App reads with its own access, and Inspire lets it read the result table.', { exact: true }).waitFor();
    assert.doesNotMatch(await access.innerText(), /service principal|Lakebase/, 'App access names no service principal and no Lakebase (must-exclude)');
    assert.equal(await access.getByRole('checkbox').count(), 0, 'what people can do is on its own step');
    await goToStep(page, 'App features');
    assert.equal(await page.getByRole('region', { name: 'App features' }).getByRole('checkbox', { name: /^Send alerts/ }).count(), 0,
      'the default per-user App sends no alerts (must-exclude)');
    await goToStep(page, 'App access');
    await internal.check();
    await goToStep(page, 'App features');
    const features = page.getByRole('region', { name: 'App features' });
    assert.deepEqual(await features.getByRole('checkbox').evaluateAll((boxes) => boxes.map((b) => [b.closest('label').querySelector('span span').textContent, b.checked])),
      [['Let people edit data', false], ['Record decisions', true], ['Send alerts', false]], 'record decisions start on, the other options off, and none is a download');
    await features.locator('label', { hasText: 'Record decisions' })
      .getByText('They own, track and dismiss each flagged record (the action tracker).', { exact: false }).waitFor();
    assert.equal(await features.locator('label', { hasText: 'Let people edit data' }).getByText('action tracker', { exact: false }).count(), 0);
    const offers = features.getByRole('note', { name: 'What every App offers' });
    await offers.getByText('Refresh now: only the owners of this use case can run it now, the person who asks for this version and the App owners it names. '
      + 'One refresh runs at a time.', { exact: true }).waitFor();
    await offers.getByText('The App offers no data downloads.', { exact: true }).waitFor();
    await features.getByRole('checkbox', { name: /^Send alerts/ }).check();
    await goToStep(page, 'App access');
    await perUser.check();
    await goToStep(page, 'App features');
    assert.equal(await features.getByRole('checkbox', { name: /^Record decisions/ }).isChecked(), true, 'per-user keeps record decisions');
    assert.equal(await features.getByRole('checkbox', { name: /^Send alerts/ }).count(), 0, 'per-user hides alerts');
    const hidden = features.getByRole('note', { name: 'Why some options are hidden' });
    await hidden.getByText(/people record decisions only on the records they can read, and the App sends no alerts and offers no chart image export\.$/).waitFor();
    assert.doesNotMatch(await hidden.textContent(), /download/i);
    await offers.getByText('The App offers no data downloads.', { exact: true }).waitFor();
    const replace = features.getByRole('radiogroup', { name: 'Should a new run replace edited records?' });
    assert.equal(await replace.count(), 0, 'the replace question waits for edits');
    await features.getByRole('checkbox', { name: /^Let people edit data/ }).check();
    await replace.waitFor();
    assert.deepEqual([await replace.getByRole('radio', { name: /^No:/ }).isChecked(), await replace.getByRole('radio', { name: /^Yes/ }).isChecked()],
      [true, false], 'a new run keeps edited records by default');
    assert.equal(await features.locator('[data-recommended]').count(), 1, 'one Recommended in App features');
    assert.equal(await replace.locator('[data-recommended]').count(), 0, 'the replace question shows no second badge (must-exclude)');
    await goToStep(page, 'App look');
    const look = page.getByRole('region', { name: 'App look' });
    assert.deepEqual(await look.locator('[data-preview^="style-"]').evaluateAll((els) => els.map((e) => e.dataset.preview)), ['style-a', 'style-b', 'style-c']);
    assert.deepEqual(await look.locator('[data-preview^="layout-"]').evaluateAll((els) => els.map((e) => e.dataset.preview)),
      ['layout-sidebar', 'layout-tabs', 'layout-home']);
    await look.getByText('Only style A matches the Lakeview dashboard look.').waitFor();
    const lookTab = (name) => look.getByRole('tab', { name, exact: true }).click();
    assert.equal(await look.getByRole('radio', { name: /^Style A/ }).isChecked(), true, 'style A is the default');
    await lookTab('Layout');
    assert.equal(await look.getByRole('radio', { name: /^Sidebar/ }).isChecked(), true, 'the sidebar is the default');
    await lookTab('Palette');
    assert.deepEqual(await look.locator('[data-swatch]').evaluateAll((els) => els.map((e) => e.dataset.swatch)), SHELL.palettes, 'the 13 shell palettes, in order');
    assert.equal(await look.getByRole('radio', { name: 'Default', exact: true }).isChecked(), true);
    const mode = look.getByRole('group', { name: 'Light or dark' });
    assert.equal(await mode.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed'), 'true');
    const nordic = SHELL.palette_colors.find((p) => p.id === 'nordic');
    await lookTab('Style');
    await look.getByText('Style C', { exact: true }).click();
    await lookTab('Palette');
    await look.getByText('Nordic', { exact: true }).click();
    await mode.getByRole('button', { name: 'Dark' }).click();
    await lookTab('Layout');
    await look.getByText('Home cards', { exact: true }).click();
    assert.equal(await look.locator('[data-preview="layout-home"]').evaluate((el) => getComputedStyle(el).backgroundColor), rgb(nordic.dark.base.bg),
      'the previews draw with the palette and the mode picked');
    assert.equal(await look.locator('[data-preview="style-c"]').evaluate((el) => getComputedStyle(el).backgroundColor), rgb(nordic.dark.base.card));
    await lookTab('Charts');
    await look.locator('[data-chart-kind="split"] input').check();
    await look.locator('[data-app-sample][data-sample-charts="trend,bars,split,pareto"]').waitFor();
    await lookTab('Pages');
    const alertsTile = look.locator('[data-app-page="alerts"]');
    assert.deepEqual([await alertsTile.getByRole('switch').isChecked(), await alertsTile.getByRole('switch').isDisabled()], [false, true],
      'a per-user App has Alerts off and locked');
    await look.getByText(/^Alerts are off: /).waitFor();
    await look.locator('[data-app-page="runs"]').getByRole('switch').uncheck();
    await startWhenReady(page);
    const spec = submittedSpec(made);
    assert.deepEqual([spec.outputs.app, spec.outputs.genie_space, spec.outputs.app_access], [true, true, 'user']);
    assert.deepEqual(spec.outputs.app_look, { style: 'c', layout: 'home', palette: 'nordic', theme: 'dark' });
    assert.deepEqual(spec.outputs.app_options, { modify: true, replace_edits: false, decisions: true, alerts: false }, 'per-user sends decisions on and alerts off');
    assert.deepEqual(spec.outputs.app_charts, ['trend', 'bars', 'split', 'pareto'], 'the build gets the kinds of chart picked');
    assert.deepEqual(spec.outputs.app_pages, { runs: false, impact: true }, 'and the pages turned off');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('App look has Style, Palette, Layout, Charts and Pages tabs over a sample page that follows every pick, lists only the pages this App gets, and fits the step whole with every App option on', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, columns: DATED });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await toDelivery(page);
    await toSharedAccess(page);
    await goToStep(page, 'App look');
    const look = page.getByRole('region', { name: 'App look' });
    const tabs = look.getByRole('tablist', { name: 'App look sections' });
    const tab = (name) => tabs.getByRole('tab', { name, exact: true });
    const sample = look.locator('[data-app-sample]');
    const shown = (attrs) => look.locator(`[data-app-sample]${Object.entries(attrs).map(([k, v]) => `[data-${k}="${v}"]`).join('')}`).waitFor();
    await look.locator('[data-swatch="mono"]').waitFor({ state: 'attached' });
    assert.deepEqual(await tabs.getByRole('tab').allTextContents(), ['Style', 'Palette', 'Layout', 'Charts', 'Pages']);
    assert.equal(await tab('Style').getAttribute('aria-selected'), 'true');
    assert.equal(await look.getByRole('tabpanel').count(), 1, 'only the chosen tab panel shows');
    await shown({ 'app-sample': 'fix', 'sample-style': 'a', 'sample-layout': 'sidebar', 'sample-palette': 'default', 'sample-theme': 'light' });
    assert.equal(await sample.getAttribute('role'), 'img');
    assert.equal(await sample.getAttribute('aria-label'), 'Sample App page: Things to fix, in Style A, Sidebar, the Default palette and Light mode');
    for (const text of ['To fix', 'At stake', 'Fixed so far', 'Delivered so far', 'Why Inspire flagged it', 'Value fell 38% below its 8 week average', 'Ask Genie', 'Shared view']) {
      await sample.getByText(text, { exact: true }).first().waitFor();
    }
    await look.getByText(/^Sample data\. Your App shows the records of this use case in the look you pick\.$/).waitFor();

    const def = SHELL.palette_colors.find((p) => p.id === 'default');
    const topBar = () => sample.locator(':scope > div').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(await topBar(), rgb(def.light.base.card), 'style A draws a plain top bar');
    await look.getByText('Style B', { exact: true }).click();
    await shown({ 'sample-style': 'b' });
    assert.equal(await topBar(), rgb(def.light.base['brand-wash']), 'style B tints the top bar');
    await tab('Palette').click();
    await look.getByRole('group', { name: 'Light or dark' }).getByRole('button', { name: 'Dark' }).click();
    await shown({ 'sample-style': 'b', 'sample-theme': 'dark' });
    assert.equal(await sample.evaluate((el) => getComputedStyle(el).backgroundColor), rgb(def.dark.base.bg), 'the sample draws in the mode picked');

    await tab('Palette').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await tab('Layout').getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Layout', 'the arrow keys move focus with the tab');
    await page.keyboard.press('End');
    assert.equal(await tab('Pages').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('ArrowRight');
    assert.equal(await tab('Style').getAttribute('aria-selected'), 'true', 'the arrows wrap');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await tab('Pages').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    assert.equal(await tab('Style').getAttribute('aria-selected'), 'true');

    await tab('Layout').click();
    await look.getByText('Top tabs', { exact: true }).click();
    await shown({ 'sample-layout': 'tabs', 'app-sample': 'fix' });
    assert.equal(await sample.getByText('Use case', { exact: true }).count(), 0, 'top tabs drop the side menu');
    await look.getByText('Home cards', { exact: true }).click();
    await shown({ 'sample-layout': 'home' });
    await sample.getByText('128 to fix · 412K at stake', { exact: true }).waitFor();

    await tab('Charts').click();
    await shown({ 'app-sample': 'charts', 'sample-charts': 'trend,bars,pareto' });
    await look.getByText(/^Pick the kinds of chart the App draws, at least 3\. Genie draws one of each/).waitFor();
    const kinds = () => look.locator('[data-chart-kind]').evaluateAll((els) => els.map((e) => {
      const input = e.querySelector('input');
      return [e.dataset.chartKind, input.checked, input.disabled];
    }));
    assert.deepEqual(await kinds(), [['trend', true, true], ['bars', true, true], ['split', false, false], ['pareto', true, true], ['scatter', false, false]],
      'Inspire\'s pick starts ticked, and none of the 3 can be unticked');
    assert.deepEqual(await look.locator('[data-chart-kind] .font-semibold').allTextContents(),
      ['Trend over time', 'Bars by segment', 'Share of a whole', 'Biggest first', 'Two measures']);
    await look.getByText("Inspire's pick: trend over time, bars by segment and biggest first.", { exact: true }).waitFor();
    assert.equal(await look.getByRole('button', { name: "Use Inspire's pick" }).count(), 0);
    assert.equal(await sample.getByText('Explain', { exact: true }).count(), 3, 'every sample chart has its Explain button');
    await look.locator('[data-chart-kind="scatter"] input').check();
    await shown({ 'sample-charts': 'trend,bars,pareto,scatter' });
    await sample.getByText('At stake against records', { exact: true }).waitFor();
    assert.deepEqual((await kinds()).map(([, on, locked]) => [on, locked]), [[true, false], [true, false], [false, false], [true, false], [true, false]]);
    await look.getByText('Keep at least 3 kinds.', { exact: true }).waitFor();
    await look.locator('[data-chart-kind="trend"] input').uncheck();
    await shown({ 'sample-charts': 'bars,pareto,scatter' });
    assert.equal(await look.locator('[data-chart-kind="bars"] input').isDisabled(), true, 'back at 3, none can be unticked');
    await look.getByRole('button', { name: "Use Inspire's pick" }).click();
    await shown({ 'sample-charts': 'trend,bars,pareto' });
    for (const kind of ['split', 'scatter']) await look.locator(`[data-chart-kind="${kind}"] input`).check();
    await shown({ 'sample-charts': 'trend,bars,split,pareto,scatter' });
    assert.equal(await sample.getByText('Explain', { exact: true }).count(), 5);

    await tab('Pages').click();
    const pages = look.getByRole('group', { name: 'Pages of the App' });
    const pageNames = () => pages.getByRole('button').allTextContents();
    const blurb = look.locator('[data-page-blurb]');
    const pageState = () => look.locator('[data-app-page]').evaluateAll((els) => els.map((e) => {
      const toggle = e.querySelector('[role="switch"]');
      return [e.dataset.appPage, toggle ? (toggle.checked ? 'on' : 'off') : e.querySelector('p').textContent, e.querySelector('button').disabled];
    }));
    assert.deepEqual(await pageNames(), ['Things to fix', 'Runs', 'Alerts', 'Impact', 'Ask Genie']);
    assert.deepEqual(await pageState(), [['fix', 'Always on', false], ['runs', 'on', false], ['alerts', 'off', true], ['impact', 'on', false], ['genie', 'Always on', false]],
      'Things to fix and Ask Genie are always on, and Alerts waits for Send alerts');
    assert.equal(await pages.getByRole('button', { name: /^Things to fix/ }).getAttribute('aria-pressed'), 'true');
    assert.match(await blurb.textContent(), /^What needs action: the totals, the charts you pick, and every flagged record with the reason Inspire flagged it\. People own, track and dismiss each flagged record\.$/,
      'no edits while that App option is off, and the decisions that start on');
    await look.locator('[data-app-page="impact"]').getByRole('switch').uncheck();
    await shown({ 'app-sample': 'fix' });
    assert.equal(await sample.getByText('Impact', { exact: true }).count(), 0, 'the sample drops Impact when it is off');
    assert.equal(await pages.getByRole('button', { name: /^Impact/ }).isDisabled(), true);
    await look.locator('[data-app-page="impact"]').getByRole('switch').check();
    await sample.getByText('Impact', { exact: true }).first().waitFor();
    await look.locator('[data-app-page="alerts"]').getByRole('switch').check();
    assert.equal(await pages.getByRole('button', { name: /^Alerts/ }).isDisabled(), false, 'the Alerts switch turns on Send alerts');
    await look.locator('[data-app-page="alerts"]').getByRole('switch').uncheck();
    await pages.getByRole('button', { name: /^Runs/ }).click();
    await shown({ 'app-sample': 'runs' });
    assert.equal(await blurb.textContent(), 'Every run of the notebook: when it ran, the data it read and the records it flagged.');
    await sample.getByText('What it covered', { exact: true }).waitFor();
    await pages.getByRole('button', { name: /^Ask Genie/ }).click();
    await shown({ 'app-sample': 'genie' });
    await sample.getByText('Why is R-1042 flagged?', { exact: true }).waitFor();
    await tab('Style').click();
    await shown({ 'app-sample': 'fix' });
    await tab('Pages').click();
    await shown({ 'app-sample': 'genie' });

    const features = page.getByRole('region', { name: 'App features' });
    await features.getByRole('checkbox', { name: /^Record decisions/ }).check();
    await features.getByRole('checkbox', { name: /^Send alerts/ }).check();
    await tab('Pages').click();
    assert.deepEqual(await pageNames(), ['Things to fix', 'Runs', 'Alerts', 'Impact', 'Ask Genie']);
    assert.equal(await pages.getByRole('button', { name: /^Ask Genie/ }).getAttribute('aria-pressed'), 'true', 'the page picked stays picked while App features change');
    await pages.getByRole('button', { name: /^Things to fix/ }).click();
    await shown({ 'app-sample': 'fix' });
    assert.match(await blurb.textContent(), /People own, track and dismiss each flagged record\.$/);
    for (const name of ['Style', 'Palette', 'Layout', 'Charts', 'Pages']) {
      await tab(name).click();
      const box = await measure(page, `app-look-all-options-${name.toLowerCase()}`);
      const height = await look.evaluate((el) => Math.round(el.getBoundingClientRect().height));
      assert.ok(height <= box.client + 1, `${name} with every App option on: App look fits the step whole (${height} > ${box.client})`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const LOOK_LAYOUTS = ['Sidebar', 'Top tabs', 'Home cards'];
const LOOK_VIEWS = [['fix', 'Palette'], ['charts', 'Charts'], ['runs', 'Runs'], ['alerts', 'Alerts'], ['impact', 'Impact'], ['genie', 'Ask Genie']];

async function withEveryAppLookOption(check) {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, columns: DATED });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await toDelivery(page);
    await toSharedAccess(page);
    await goToStep(page, 'App features');
    const features = page.getByRole('region', { name: 'App features' });
    await features.getByRole('checkbox', { name: /^Record decisions/ }).check();
    await features.getByRole('checkbox', { name: /^Send alerts/ }).check();
    const look = page.getByRole('region', { name: 'App look' });
    const tabs = look.getByRole('tablist', { name: 'App look sections' });
    const tab = (name) => tabs.getByRole('tab', { name, exact: true });
    const sample = look.locator('[data-app-sample]');
    const shown = (attrs) => look.locator(`[data-app-sample]${Object.entries(attrs).map(([k, v]) => `[data-${k}="${v}"]`).join('')}`).waitFor();
    const pages = look.getByRole('group', { name: 'Pages of the App' });
    await look.locator('[data-swatch="mono"]').waitFor({ state: 'attached' });
    await tab('Palette').click();
    await look.getByRole('group', { name: 'Light or dark' }).getByRole('button', { name: 'Dark' }).click();
    await shown({ 'sample-theme': 'dark' });
    await tab('Charts').click();
    for (const kind of ['split', 'scatter']) await look.locator(`[data-chart-kind="${kind}"] input`).check();
    await shown({ 'sample-charts': 'trend,bars,split,pareto,scatter' });
    await tab('Pages').click();
    assert.deepEqual(await pages.getByRole('button').allTextContents(), ['Things to fix', 'Runs', 'Alerts', 'Impact', 'Ask Genie']);
    assert.equal(await pages.getByRole('button', { name: /^Alerts/ }).isDisabled(), false, 'with Send alerts on, the Alerts page can be shown');
    await check({ page, look, tab, sample, shown, pages });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
}

const clippedSample = (sample) => sample.evaluate((root) => {
  const out = new Set();
  for (const el of root.querySelectorAll('*')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const bottom = el.getBoundingClientRect().bottom;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const edge = a.getBoundingClientRect().bottom;
      if ((a === root || getComputedStyle(a).overflowY !== 'visible') && bottom > edge + 1) out.add(`${el.textContent.trim().slice(0, 40)} +${Math.round(bottom - edge)}px`);
      if (a === root) break;
    }
  }
  return [...out];
});

for (const layout of LOOK_LAYOUTS) {
  test(`App look in the ${layout} layout cuts off no sample text at the bottom, in any style or page`, () => withEveryAppLookOption(async ({ look, tab, sample, shown, pages }) => {
    const cut = [];
    for (const style of ['A', 'B', 'C']) {
      await tab('Style').click();
      await look.getByText(`Style ${style}`, { exact: true }).click();
      await tab('Layout').click();
      await look.getByText(layout, { exact: true }).click();
      await shown({ 'app-sample': 'fix', 'sample-style': style.toLowerCase() });
      for (const line of await clippedSample(sample)) cut.push(`${layout}/${style}/fix ${line}`);
      await tab('Charts').click();
      await shown({ 'app-sample': 'charts' });
      for (const line of await clippedSample(sample)) cut.push(`${layout}/${style}/charts ${line}`);
      await tab('Pages').click();
      for (const control of ['Runs', 'Alerts', 'Impact', 'Ask Genie', 'Things to fix']) {
        await pages.getByRole('button', { name: new RegExp(`^${control}`) }).click();
        await shown({ 'app-sample': { Runs: 'runs', Alerts: 'alerts', Impact: 'impact', 'Ask Genie': 'genie', 'Things to fix': 'fix' }[control] });
        for (const line of await clippedSample(sample)) cut.push(`${layout}/${style}/${control} ${line}`);
      }
    }
    assert.deepEqual(cut, [], `no sample text is cut off at the bottom in the ${layout} layout, in any style or page`);
  }));
}

for (const style of ['a', 'b', 'c']) {
  for (const theme of ['light', 'dark']) {
    test(`App look in Style ${style.toUpperCase()} and ${theme} mode reads at 4.5 to 1 in the Home cards layout, in every palette and page`, () => withEveryAppLookOption(async ({ page, look, tab, shown, pages }) => {
      await tab('Layout').click();
      await look.getByText('Home cards', { exact: true }).click();
      await shown({ 'sample-layout': 'home' });
      const low = [];
      let measured = 0;
      for (const palette of SHELL.palettes) {
        await tab('Style').click();
        await look.getByText(`Style ${style.toUpperCase()}`, { exact: true }).click();
        await tab('Palette').click();
        await look.getByRole('group', { name: 'Light or dark' }).getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light' }).click();
        await look.locator(`[data-swatch="${palette}"]`).click();
        for (const [view, control] of LOOK_VIEWS) {
          if (view === 'charts') await tab('Charts').click();
          else if (view !== 'fix') {
            if (await tab('Pages').getAttribute('aria-selected') !== 'true') await tab('Pages').click();
            await pages.getByRole('button', { name: new RegExp(`^${control}`) }).click();
          }
          await shown({ 'app-sample': view, 'sample-style': style, 'sample-theme': theme, 'sample-palette': palette });
          const result = await lowContrast(page, ['[data-app-sample]']);
          measured += result.checked;
          assert.ok(result.checked >= 15, `${style}/${theme}/${palette}/${view}: measured ${result.checked} elements`);
          for (const line of result.low) low.push(`${style}/${theme}/${palette}/${view} ${line}`);
        }
      }
      console.log(`App look sample ${style}/${theme}: ${SHELL.palettes.length * LOOK_VIEWS.length} pages, ${measured} text elements measured, ${low.length} below 4.5:1`);
      assert.deepEqual(low, [], `every sample text in Style ${style.toUpperCase()} and ${theme} mode reads at 4.5:1 or better`);
    }));
  }
}

test('a shared App reads Lakebase by default when the workspace has it, the default per-user App reads Delta tables, a 403 says why, and a 404 says why with no choice', async () => {
  const probe = (data, status) => ({ me: { userName: OWNER, displayName: 'Owner' }, responses: { 'GET /api/2.0/postgres/projects': [data, status] } });
  const toAccess = async (page) => {
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^App / }).check();
    await toAppAccess(page);
    return page.getByRole('region', { name: 'App access' });
  };
  const choice = (access) => access.getByRole('group', { name: 'How fast do the App\'s pages open?' });
  const radios = async (group) => group.getByRole('radio').evaluateAll((els) => els.map((e) => [e.value, e.checked, e.disabled]));
  const toStart = async (page) => {
    await goToStep(page, 'App look');
    await startWhenReady(page);
  };

  let ui = await openUi('wizard', probe({ projects: [] }, 200));
  try {
    const access = await toAccess(ui.page);
    const group = choice(access);
    await group.getByRole('status').waitFor({ state: 'detached' });
    await group.getByText('Fast pages (open at once)', { exact: true }).waitFor();
    await group.getByText('Standard pages (take a few seconds to open)', { exact: true }).waitFor();
    assert.equal(await access.getByRole('radio', { name: /^Sensitive data/ }).isChecked(), true, 'the App signs each viewer in with no click');
    assert.deepEqual(await radios(group), [['lakebase', false, true], ['delta', true, false]], 'the default per-user App reads Delta tables');
    await access.getByRole('radio', { name: /^Internal data/ }).check();
    assert.deepEqual(await radios(group), [['lakebase', true, false], ['delta', false, false]], 'a shared App reads Lakebase by default, with no other click');
    await access.getByRole('radio', { name: /^Sensitive data/ }).check();
    assert.deepEqual(await radios(group), [['lakebase', false, true], ['delta', true, false]], 'a per-user App reads Delta tables');
    assert.equal(await group.locator('[data-blocked-reason="app-backend"] p').textContent(), LAKEBASE_PER_USER_REASON);
    assert.doesNotMatch(await group.innerText(), /Lakebase|service principal|Delta/, 'the person sees no Lakebase internals (must-exclude)');
    await access.getByRole('radio', { name: /^Internal data/ }).check();
    assert.deepEqual(await radios(group), [['lakebase', true, false], ['delta', false, false]], 'back to a shared App, Lakebase comes back');
    await toStart(ui.page);
    assert.equal(submittedSpec(ui.made).outputs.app_backend, 'lakebase');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }

  ui = await openUi('wizard', probe({ projects: [] }, 200));
  try {
    const access = await toAccess(ui.page);
    await access.getByRole('radio', { name: /^Internal data/ }).check();
    await choice(access).getByRole('status').waitFor({ state: 'detached' });
    await choice(access).getByText('Standard pages (take a few seconds to open)', { exact: true }).click();
    await toStart(ui.page);
    assert.equal(submittedSpec(ui.made).outputs.app_backend, 'delta', 'a pick of Delta is kept');
  } finally {
    await ui.close();
  }

  ui = await openUi('wizard', probe({ message: 'PERMISSION_DENIED: Lakebase is not enabled for this user' }, 403));
  try {
    const access = await toAccess(ui.page);
    await access.getByRole('radio', { name: /^Internal data/ }).check();
    const group = choice(access);
    const why = group.locator('[data-blocked-reason="app-backend"]');
    assert.equal(await why.locator('p').textContent(), 'Needs access Inspire does not have yet.');
    assert.match(await why.locator('[data-technical-details] pre').textContent(), /PERMISSION_DENIED: Lakebase is not enabled for this user/, 'the raw refusal sits under Details');
    assert.equal(await why.locator('[data-technical-details]').getAttribute('open'), null, 'Details start closed');
    assert.deepEqual(await radios(group), [['lakebase', false, true], ['delta', true, false]]);
    await toStart(ui.page);
    assert.equal(submittedSpec(ui.made).outputs.app_backend, 'delta');
  } finally {
    await ui.close();
  }

  ui = await openUi('wizard', probe({ error_code: 'ENDPOINT_NOT_FOUND' }, 404));
  try {
    const access = await toAccess(ui.page);
    await access.getByRole('radio', { name: /^Internal data/ }).check();
    const group = choice(access);
    assert.equal(await group.locator('[data-blocked-reason="app-backend"] p').textContent(), LAKEBASE_ABSENT);
    assert.equal(await group.getByRole('radio').count(), 0, 'a workspace without Lakebase shows no choice, only the reason');
    await toStart(ui.page);
    assert.equal(submittedSpec(ui.made).outputs.app_backend, 'delta');
  } finally {
    await ui.close();
  }
});

test('Where results live offers its own schema, falls back to the Inspire database schema with the GRANT to ask for, picks a catalog and a schema, and Next checks the table live', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, catalogs: ['main', 'sales'], schemas: { main: ['inspire', 's'], sales: ['mvp', 'gold'] } });
  const { page, made } = ui;
  try {
    await goToStep(page, 'Data');
    assert.equal(await page.getByLabel('Output table').count(), 0, 'the result table left the Data step');
    await dataToResults(page);
    const step = page.getByRole('region', { name: 'Where the result table lives' });
    await step.getByRole('heading', { name: 'Where should the result table live?' }).waitFor();
    const place = step.getByRole('group', { name: 'Result table catalog and schema' });
    const catalog = place.getByLabel('Catalog');
    const schema = place.getByLabel('Schema');
    await catalog.locator('option[value="sales"]').waitFor({ state: 'attached' });
    assert.deepEqual([await catalog.inputValue(), await schema.inputValue(), await step.getByLabel('Table name').inputValue()], ['main', 'inspire', 'n01_u01_s42_out']);
    const places = step.getByRole('radiogroup', { name: 'Where the tables go' });
    await places.locator('[data-option="inspire"] [data-recommended]').waitFor();
    assert.equal(await places.locator('[data-option="own"] [data-recommended]').count(), 0, 'the badge follows the default the person can write to');
    assert.equal(await places.locator('[data-option="own"]').count(), 0, 'a schema of its own Inspire cannot create is not offered (must-exclude)');
    assert.equal(await places.getByRole('radio', { name: /The Inspire database schema/ }).isChecked(), true, 'no right to create a schema keeps the Inspire database schema');
    const placeNote = step.getByRole('note', { name: 'Where the tables go note' });
    assert.equal(await placeNote.locator('p').innerText().then((t) => /GRANT/.test(t)), false, 'no raw GRANT text in the plain line');
    assert.match(await placeNote.locator('[data-technical-details] pre').textContent(), /GRANT CREATE SCHEMA ON CATALOG `main`/);
    await step.getByRole('note', { name: 'Moving the result table' }).getByText('Moving the table later copies its history to the new table and keeps the old one.').waitFor();
    await catalog.selectOption('sales');
    assert.equal(await schema.inputValue(), '', 'a new catalog asks for its schema again');
    await schema.locator('option[value="gold"]').waitFor({ state: 'attached' });
    assert.deepEqual(await schema.locator('option').evaluateAll((os) => os.map((o) => o.value)), ['', 'gold', 'mvp']);
    await next(page);
    await page.locator('[role="alert"]').waitFor();
    assert.deepEqual(await footerErrors(page), ['pick a catalog and a schema, and name the result table']);
    await schema.selectOption('mvp');
    await step.getByLabel('Table name').fill('churn_out');
    await step.getByText('sales.mvp.churn_out', { exact: true }).waitFor();
    made.state.access = [];
    await next(page);
    await page.locator('[role="alert"]').waitFor();
    assert.deepEqual(await footerErrors(page), ['catalog sales does not exist or you have no access to it']);
    await onStep(page, 'Results');
    await places.getByRole('radio', { name: /The Inspire database schema/ }).check();
    assert.deepEqual([await catalog.inputValue(), await schema.inputValue()], ['main', 'inspire']);
    made.state.access = [
      { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: OWNER },
      { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: OWNER },
      { level: 'schema', privilege: 'OWNER', principal: OWNER, mine: 'true', me: OWNER },
    ];
    await catalog.selectOption('sales');
    await schema.locator('option[value="mvp"]').waitFor({ state: 'attached' });
    await schema.selectOption('mvp');
    const withoutApp = page.waitForResponse((r) => r.url().includes('/api/inspire/implement/preflight?') && ['app_name', 'merge_app'].every((k) => new URL(r.url()).searchParams.get(k) === ''));
    await goToStep(page, 'What to build');
    await page.locator('[data-blocked-reason="app"]').waitFor({ timeout: 15000 });
    await until(async () => !(await page.getByRole('checkbox', { name: /^App / }).isChecked()), 'the App Inspire cannot build is turned off on Delivery, in view');
    assert.equal(await page.getByRole('checkbox', { name: /^App / }).isDisabled(), true);
    await withoutApp;
    await painted(page);
    assert.equal(await page.getByRole('checkbox', { name: /^App / }).isDisabled(), true, 'the check run without the App still keeps the App it cannot build from being ticked again');
    await page.locator('[data-blocked-reason="app"]').waitFor();
    await toSummary(page);
    await page.locator('[data-picked-row="dropped"]').getByText(/^App: /).waitFor();
    assert.deepEqual((await footerErrors(page)).filter((e) => /^App /.test(e)), [], 'a check of the dropped App never shows on the Summary (must-exclude)');
    await startWhenReady(page);
    assert.equal(submittedSpec(made).config.result_table, 'sales.mvp.n01_u01_s42_out');
    assert.equal(submittedSpec(made).outputs.app, false);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('A person who may create schemas gets the use case its own schema: Next creates and tags it, and the Summary and the build name that exact table', async () => {
  const own = 'main._inspire_acme_n01_u01.n01_u01_results';
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' }, forwardedToken: 'person-tok', dbToken: 'person-tok', catalogs: ['main'], schemas: { main: ['inspire'] },
    statements: { 'information_schema.schema_tags': () => ({ rows: [{ kind: 'right', schema_name: '', value: 'CREATE_SCHEMA' }] }) },
  });
  const { page, made } = ui;
  try {
    await goToStep(page, 'Data');
    await dataToResults(page);
    const step = page.getByRole('region', { name: 'Where the result table lives' });
    const places = step.getByRole('radiogroup', { name: 'Where the tables go' });
    await places.locator('[data-option="own"] [data-recommended]').waitFor();
    assert.equal(await places.getByRole('radio', { name: /Its own schema/ }).isChecked(), true, 'with the right, its own schema is the default');
    assert.equal(await step.getByRole('note', { name: 'Where the tables go note' }).count(), 0, 'no fallback note when the person may create the schema');
    await step.getByRole('group', { name: 'Result table' }).getByText(own, { exact: true }).waitFor();
    await toSummary(page);
    const made1 = made.sqlCalls.filter((c) => /^(CREATE|ALTER) SCHEMA/.test(c.sql)).map((c) => c.sql);
    assert.deepEqual(made1, ['CREATE SCHEMA IF NOT EXISTS `main`.`_inspire_acme_n01_u01`',
      "ALTER SCHEMA `main`.`_inspire_acme_n01_u01` SET TAGS ('inspire_session_id' = '42', 'inspire_use_case_id' = 'N01-U01', 'inspire_business' = 'Acme', 'inspire_database' = 'main.inspire')"]);
    await page.getByText(own, { exact: true }).first().waitFor();
    await startWhenReady(page);
    assert.equal(submittedSpec(made).config.result_table, own);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('A schema of the same name that is not this use case\'s: the wizard says so, picks the next free name, and creates and tags that one', async () => {
  const own = 'main._inspire_acme_n01_u01__2.n01_u01_results';
  const foreign = [{ kind: 'exists', schema_name: '_inspire_acme_n01_u01', value: '' }, { kind: 'inspire_use_case_id', schema_name: '_inspire_acme_n01_u01', value: 'N07-U02' }];
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' }, forwardedToken: 'person-tok', dbToken: 'person-tok', catalogs: ['main'], schemas: { main: ['inspire'] },
    statements: { 'information_schema.schema_tags': () => ({ rows: [{ kind: 'right', schema_name: '', value: 'CREATE_SCHEMA' }, ...foreign] }) },
  });
  const { page, made } = ui;
  try {
    await goToStep(page, 'Data');
    await dataToResults(page);
    const step = page.getByRole('region', { name: 'Where the result table lives' });
    const places = step.getByRole('radiogroup', { name: 'Where the tables go' });
    assert.equal(await places.getByRole('radio', { name: /Its own schema/ }).isChecked(), true);
    await step.getByRole('note', { name: 'Where the tables go note' })
      .getByText("_inspire_acme_n01_u01 already exists and is not this use case's schema (it holds use case N07-U02), so this use case's own schema is _inspire_acme_n01_u01__2.", { exact: true }).waitFor();
    await step.getByRole('group', { name: 'Result table' }).getByText(own, { exact: true }).waitFor();
    await toSummary(page);
    assert.deepEqual(made.sqlCalls.filter((c) => /^(CREATE|ALTER) SCHEMA/.test(c.sql)).map((c) => c.sql), ['CREATE SCHEMA IF NOT EXISTS `main`.`_inspire_acme_n01_u01__2`',
      "ALTER SCHEMA `main`.`_inspire_acme_n01_u01__2` SET TAGS ('inspire_session_id' = '42', 'inspire_use_case_id' = 'N01-U01', 'inspire_business' = 'Acme', 'inspire_database' = 'main.inspire')"]);
    assert.equal(made.sqlCalls.some((c) => /SCHEMA `main`\.`_inspire_acme_n01_u01`/.test(c.sql)), false, 'the schema that is not this use case\'s is never created over or tagged');
    await startWhenReady(page);
    assert.equal(submittedSpec(made).config.result_table, own);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('A re-run of this Inspire database finds the use case\'s schema from session 7: the wizard says it uses it again and writes this session\'s rows to their own table', async () => {
  const own = 'main._inspire_acme_n01_u01.n01_u01_results_s42';
  const schema = '_inspire_acme_n01_u01';
  const lineage = [['exists', ''], ['inspire_use_case_id', 'N01-U01'], ['inspire_database', 'main.inspire'], ['inspire_session_id', '7']]
    .map(([kind, value]) => ({ kind, schema_name: schema, value }));
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' }, forwardedToken: 'person-tok', dbToken: 'person-tok', catalogs: ['main'], schemas: { main: ['inspire'] },
    statements: { 'information_schema.schema_tags': () => ({ rows: [{ kind: 'right', schema_name: '', value: 'CREATE_SCHEMA' }, ...lineage] }) },
  });
  const { page, made } = ui;
  try {
    await goToStep(page, 'Data');
    await dataToResults(page);
    const step = page.getByRole('region', { name: 'Where the result table lives' });
    const places = step.getByRole('radiogroup', { name: 'Where the tables go' });
    assert.equal(await places.getByRole('radio', { name: /Its own schema/ }).isChecked(), true);
    await step.getByRole('note', { name: 'Where the tables go note' })
      .getByText("_inspire_acme_n01_u01 is this use case's schema from session 7 of this Inspire database, so Inspire uses it again; this session's results go to main._inspire_acme_n01_u01.n01_u01_results_s42 so session 7 keeps its rows.", { exact: true }).waitFor();
    await step.getByRole('group', { name: 'Result table' }).getByText(own, { exact: true }).waitFor();
    await toSummary(page);
    assert.equal(made.sqlCalls.some((c) => /^(CREATE|ALTER) SCHEMA/.test(c.sql)), false, 'the schema of session 7 is neither created again nor re-tagged');
    await startWhenReady(page);
    assert.equal(submittedSpec(made).config.result_table, own);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('When the use case\'s name and every suffixed name hold other use cases, the wizard says so and the tables go to the Inspire database schema', async () => {
  const inspire = 'main.inspire.n01_u01_s42_out';
  const names = ['_inspire_acme_n01_u01', ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `_inspire_acme_n01_u01__${n}`)];
  const taken = names.flatMap((schema) => [{ kind: 'exists', schema_name: schema, value: '' }, { kind: 'inspire_use_case_id', schema_name: schema, value: 'N07-U02' }]);
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' }, forwardedToken: 'person-tok', dbToken: 'person-tok', catalogs: ['main'], schemas: { main: ['inspire'] },
    statements: { 'information_schema.schema_tags': () => ({ rows: [{ kind: 'right', schema_name: '', value: 'CREATE_SCHEMA' }, ...taken] }) },
  });
  const { page, made } = ui;
  try {
    await goToStep(page, 'Data');
    await dataToResults(page);
    const step = page.getByRole('region', { name: 'Where the result table lives' });
    const places = step.getByRole('radiogroup', { name: 'Where the tables go' });
    await step.getByRole('note', { name: 'Where the tables go note' })
      .getByText("_inspire_acme_n01_u01 through _inspire_acme_n01_u01__9 already exist and none is this use case's schema, so this use case's tables go to the Inspire database schema.", { exact: true }).waitFor();
    assert.equal(await places.getByRole('radio', { name: /Its own schema/ }).count(), 0, 'no own schema is offered when every name is taken');
    await step.getByRole('group', { name: 'Result table' }).getByText(inspire, { exact: true }).waitFor();
    await toSummary(page);
    assert.equal(made.sqlCalls.some((c) => /^(CREATE|ALTER) SCHEMA/.test(c.sql)), false, 'no schema of another use case is created over or tagged');
    await startWhenReady(page);
    assert.equal(submittedSpec(made).config.result_table, inspire);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const target = (sid, uc, name, outputs, version = 1) => ({
  session_id: sid, use_case_id: uc, spec_version: version, status: 'ready', updated_at: '2026-10-26T00:00:00Z', asset_status: null,
  spec_json: JSON.stringify({ use_case_id: uc, use_case_name: name, outputs }), dashboard_id: null, genie_space_id: null, app_name: null,
});

const MERGE_STATE = {
  me: { userName: OWNER, displayName: 'Owner' },
  registry: [
    { ...target('42', 'N01-U02', 'Forecast demand', { app: true, app_access: 'sp', app_look: { style: 'b', layout: 'tabs', palette: 'ocean', theme: 'light' } }),
      app_name: 'ops-desk', dashboard_id: 'd1' },
    { ...target('42', 'N01-U03', 'Score suppliers', { app: true, app_access: 'user' }), app_name: 'care-desk' },
    { ...target('42', 'N01-U04', 'Plan stock', { app: true, app_access: 'sp' }), app_name: 'someone-else' },
  ],
  appsByName: {
    'ops-desk': { name: 'ops-desk', description: 'Inspire use case N01-U02 (session 42): Forecast demand' },
    'care-desk': { name: 'care-desk', description: 'Inspire use case N01-U03 (session 42): Score suppliers' },
    'someone-else': { name: 'someone-else', description: 'A tool the team built by hand' },
    'predict-churn': null,
  },
};

const JOIN_NOTE = 'The App this use case joins';
const appTile = (page) => page.locator('[data-output="app"] label').first().textContent();
const stepLabels = (page) => page.locator('ol li').allTextContents();
const ownersShown = async (page) => {
  const toggle = page.getByRole('button', { name: 'Advanced settings' });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  return page.getByLabel('App owners (comma separated)').count();
};

const PLACE_UC = { id: 'N01-U01', use_case: 'Predict churn', business_domain: 'Customer', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', genie_instruction: '## Parameters\n| top_k | text | 25 | Top K |\n| act_now_share | text | 0.05 | Act now share |\n' };
const PLACE_SCOPE = [
  { session_id: '42', use_case_id: 'N01-U02', business: 'Acme', domain: 'Customer' },
  { session_id: '42', use_case_id: 'N01-U03', business: 'Acme', domain: 'Finance' },
  { session_id: '42', use_case_id: 'N01-U05', business: 'Acme', domain: 'Customer' },
  { session_id: '77', use_case_id: 'N04-U01', business: 'Globex', domain: 'Customer' },
];
const placeStep = (page) => page.getByRole('region', { name: 'App placement' });
const placeTargets = (page) => placeStep(page).locator('[data-app-target]').evaluateAll((items) => items.map((li) => [li.dataset.appTarget,
  li.querySelector('[data-fit]').dataset.fit, li.querySelector('[data-recommended]')?.firstElementChild?.textContent || '']));
const policy = (page, name) => placeStep(page).getByRole('radiogroup', { name: 'How Inspire organizes Apps' }).getByRole('radio', { name });
const targetRadio = (page, id) => placeStep(page).locator(`[data-app-target="${id}"] input[type="radio"]`);

test('the App is picked on Deliver under the App tile: it lists the Apps Inspire built with their fit and creates or joins', async () => {
  const ui = await openUi('wizard', { ...MERGE_STATE, useCase: PLACE_UC, useCaseScope: PLACE_SCOPE });
  const { page, made } = ui;
  try {
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^Dashboard/ }).check();
    const dash = page.locator('[data-merge="dashboard"]');
    await dash.getByRole('button', { name: 'Create new' }).waitFor();
    assert.equal(await dash.getByRole('button', { name: 'Create new' }).getAttribute('aria-pressed'), 'true', 'Create new is the default');
    await page.getByRole('checkbox', { name: /^App / }).check();
    assert.equal(await page.locator('[data-merge="app"]').count(), 0, 'Delivery no longer picks the App');
    assert.doesNotMatch(await appTile(page), /You pick where it goes below/, 'the placement sits beside the tiles, so the tile never points below (must-exclude)');
    assert.equal(await page.locator('[data-deliver-layout="beside"]').count(), 1);
    assert.match(await page.locator('[data-deliver-more-item="app"]').textContent(), /^App: /, 'what each tile builds sits under one disclosure');
    const genie = page.locator('[data-merge="genie_space"]');
    await genie.getByText('Inspire has built none yet').waitFor();
    await placeStep(page).locator('[data-app-target]').first().waitFor();
    await onStep(page, 'Deliver');
    assert.deepEqual([await targetRadio(page, 'ops-desk').isChecked(), await targetRadio(page, 'ops-desk').isDisabled()], [false, true],
      'a new use case signs each viewer in, so it does not join an App that shows everyone the same rows (must-exclude)');
    await goToStep(page, 'App access');
    await page.getByRole('region', { name: 'App access' }).getByRole('radio', { name: /^Internal data/ }).check();
    await goToStep(page, 'Deliver');
    await targetRadio(page, 'ops-desk').check();
    assert.equal(await page.getByLabel('App name').count(), 0, 'joining an App asks no App name');
    assert.deepEqual(await placeTargets(page), [['ops-desk', 'recommended', 'Recommended'], ['care-desk', 'not_recommended', '']],
      'only Apps Inspire built, the best fit first and the only one badged, never one whose description is not an Inspire owner tag');
    assert.equal(await placeStep(page).getByText(/^Not recommended/).count(), 0, 'no Not recommended tag next to the badge');
    assert.equal(await placeStep(page).getByText(/^Recommended/).count(), 1, 'Recommended shows once, on the badge of the best fit');
    assert.match(await placeStep(page).locator('[data-app-target="care-desk"]').textContent(),
      /It holds only Finance use cases, not Customer, so the people who use it could see another domain's data or use cases unrelated to their work\./);
    await placeStep(page).getByRole('note', { name: JOIN_NOTE }).waitFor();
    assert.equal(await targetRadio(page, 'ops-desk').isChecked(), true,
      'with everyone seeing the same rows picked, the App built before App placement that holds only this business and domain can be joined');
    assert.equal((await stepLabels(page)).some((s) => /^\d+\. Who uses the App$/.test(s.trim())), false, 'joining an App keeps its sign-in, so there is no Who uses the App step (must-exclude)');
    await placeStep(page).getByRole('radio', { name: /^Create a new App/ }).check();
    await page.getByLabel('App name').waitFor();
    assert.ok((await stepLabels(page)).some((s) => /^\d+\. Who uses the App$/.test(s.trim())), (await stepLabels(page)).join(', '));
    assert.equal(await policy(page, /^One App per business domain/).isChecked(), true);
    assert.equal(await placeStep(page).getByRole('radiogroup', { name: 'How Inspire organizes Apps' }).locator('[data-recommended]').count(), 1);
    assert.equal(await page.getByLabel('App name').inputValue(), 'inspire-acme-customer', 'the new App is named for the business and the domain');
    await policy(page, /^One App per use case/).check();
    assert.equal(await page.getByLabel('App name').inputValue(), 'predict-churn');
    await policy(page, /^One App for all use cases/).check();
    assert.equal(await page.getByLabel('App name').inputValue(), 'inspire-hub-acme');
    await targetRadio(page, 'ops-desk').check();
    assert.equal(await placeStep(page).getByRole('note', { name: JOIN_NOTE }).textContent(),
      'It keeps the look of ops-desk (Style B, Top tabs, the Ocean palette and Light mode), its sign-in and its data source, '
      + 'so everyone who opens it sees the same rows. For your own, choose Create new.');
    assert.equal(await page.getByLabel('App name').count(), 0, 'a joined App keeps its own name');
    const steps = await stepLabels(page);
    assert.ok(!steps.some((s) => /App access|App look|App pages/.test(s)), `no App access, App look or App pages step: ${steps.join(', ')}`);
    await toVibes(page);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await onStep(page, 'Run it');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await onStep(page, 'Deliver');
    assert.equal((await stepLabels(page)).some((s) => /^\d+\. Who uses the App$/.test(s.trim())), false, 'joining an App keeps its sign-in, so there is no Who uses the App step (must-exclude)');
    await placeStep(page).getByRole('radio', { name: /^Create a new App/ }).check();
    await page.getByLabel('App name').waitFor();
    assert.ok((await stepLabels(page)).some((s) => /^\d+\. Who uses the App$/.test(s.trim())), (await stepLabels(page)).join(', '));
    await policy(page, /^One App per use case/).check();
    await goToStep(page, 'App access');
    await page.getByRole('region', { name: 'App access' }).getByRole('radio', { name: /^Sensitive data/ }).check();
    await goToStep(page, 'Deliver');
    assert.equal(await targetRadio(page, 'ops-desk').isDisabled(), true, 'with per-user chosen, the service-principal App cannot be picked');
    assert.match(await placeStep(page).locator('[data-app-target="ops-desk"]').textContent(), /ops-desk shows everyone the same rows/);
    await targetRadio(page, 'care-desk').check();
    assert.equal(await placeStep(page).getByRole('note', { name: JOIN_NOTE }).textContent(),
      'It keeps the look of care-desk, its sign-in and its data source, so each person sees only the rows their own access allows. '
      + 'For your own, choose Create new.', 'never a guessed look, and no shared rows');
    await toVibes(page);
    await startWhenReady(page);
    const spec = submittedSpec(made);
    assert.deepEqual([spec.outputs.app_access, spec.outputs.app_name, spec.outputs.merge, spec.outputs.app_owners, spec.outputs.app_placement],
      ['user', 'care-desk', { app: 'care-desk', dashboard: '', genie_space: '' }, [], 'use_case']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a new use case joins the App made for its domain by default, the badge sits on it, Create new stays put once chosen, and another business or domain says why it does not fit', async () => {
  const domainLook = { style: 'c', layout: 'home', palette: 'earth', theme: 'dark' };
  const domainState = {
    ...MERGE_STATE,
    useCase: PLACE_UC,
    useCaseScope: PLACE_SCOPE,
    registry: [
      { ...target('77', 'N04-U01', 'Route trucks', { app: true, app_access: 'sp', app_placement: 'domain' }), app_name: 'globex-desk' },
      ...MERGE_STATE.registry,
      { ...target('42', 'N01-U05', 'Price promos', { app: true, app_access: 'user', app_look: domainLook, app_placement: 'domain' }), app_name: 'inspire-acme-customer' },
    ],
    appsByName: { ...MERGE_STATE.appsByName,
      'inspire-acme-customer': { name: 'inspire-acme-customer', description: 'Inspire use case N01-U05 (session 42): Price promos' },
      'globex-desk': { name: 'globex-desk', description: 'Inspire use case N04-U01 (session 77): Route trucks' } },
  };
  const ui = await openUi('wizard', domainState);
  const { page, made } = ui;
  try {
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^App / }).check();
    await goToStep(page, 'App placement');
    await placeStep(page).getByRole('note', { name: JOIN_NOTE }).waitFor();
    assert.equal(await targetRadio(page, 'inspire-acme-customer').isChecked(), true, 'the App of this business and domain is joined by default');
    assert.match(await placeStep(page).getByRole('note', { name: JOIN_NOTE }).textContent(),
      /^It keeps the look of inspire-acme-customer \(Style C, Home cards, the Earth palette and Dark mode\), its sign-in and its data source/);
    assert.match(await placeStep(page).textContent(), /Last time for Acme: One App per business domain\./);
    const fits = await placeTargets(page);
    const rank = { recommended: 0, other_domains: 1, not_recommended: 2 };
    assert.deepEqual(fits.map(([, fit]) => rank[fit]), [...fits.map(([, fit]) => rank[fit])].sort(), `best fit first: ${JSON.stringify(fits)}`);
    assert.deepEqual(Object.fromEntries(fits.map(([id, fit]) => [id, fit])),
      { 'inspire-acme-customer': 'recommended', 'ops-desk': 'recommended', 'care-desk': 'not_recommended', 'globex-desk': 'not_recommended' });
    assert.deepEqual(fits.filter(([, , badge]) => badge).map(([id]) => id), ['inspire-acme-customer'], 'the badge sits on the App joined by default');
    assertOneBadgeOnDefault((await choicesShown(page)).filter((c) => ['app-place', 'app-target'].includes(c.choice)), 'App placement with Apps to join');
    assert.match(await placeStep(page).locator('[data-app-target="globex-desk"]').textContent(),
      /It holds use cases of Globex, another business, so the people who use it could see that business's data\./);
    await page.clock.install();
    const asks = watchAsks(page);
    assert.equal((await stepLabels(page)).some((s) => /^\d+\. Who uses the App$/.test(s.trim())), false, 'joining an App keeps its sign-in, so there is no Who uses the App step (must-exclude)');
    await placeStep(page).getByRole('radio', { name: /^Create a new App/ }).check();
    await page.getByLabel('App name').waitFor();
    assert.ok((await stepLabels(page)).some((s) => /^\d+\. Who uses the App$/.test(s.trim())), (await stepLabels(page)).join(', '));
    assert.equal(await page.getByLabel('App name').inputValue(), 'inspire-acme-customer-2', 'a new App never takes the name of one Inspire built');
    await asks.quiet(800);
    await page.clock.resume();
    assert.equal(await placeStep(page).getByRole('radio', { name: /^Create a new App/ }).isChecked(), true, 'the person chose Create new, so the default does not come back');
    await targetRadio(page, 'inspire-acme-customer').check();
    await toVibes(page);
    await startWhenReady(page);
    const spec = submittedSpec(made);
    assert.deepEqual([spec.outputs.app_name, spec.outputs.merge.app, spec.outputs.app_placement], ['inspire-acme-customer', 'inspire-acme-customer', 'domain']);
    assert.deepEqual(spec.outputs.app_look, domainLook, 'the look of the use case that built the App, not the joiner listed first');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const remembered = await openUi('wizard', { ...domainState, registry: [
    { ...target('42', 'N01-U02', 'Forecast demand', { app: true, app_access: 'sp', app_placement: 'use_case' }), app_name: 'ops-desk', updated_at: '2026-10-29T00:00:00Z' },
    ...domainState.registry.filter((r) => r.use_case_id !== 'N01-U02'),
  ] });
  try {
    await toDelivery(remembered.page);
    await remembered.page.getByRole('checkbox', { name: /^App / }).check();
    await goToStep(remembered.page, 'App placement');
    await placeStep(remembered.page).getByText('Last time for Acme: One App per use case.', { exact: false }).waitFor();
    assert.equal(await placeStep(remembered.page).getByRole('radio', { name: /^Create a new App/ }).isChecked(), true, 'one App per use case never joins');
    assert.equal(await policy(remembered.page, /^One App per use case/).isChecked(), true, 'the business last chose one App per use case');
    assert.equal(await remembered.page.getByLabel('App name').inputValue(), 'predict-churn');
    assert.deepEqual(remembered.pageErrors, []);
  } finally {
    await remembered.close();
  }
});

const PLACE_WAITING = 'wait until Inspire has listed the Apps it built, then choose where the App goes';
const DOMAIN_APP_STATE = {
  ...MERGE_STATE,
  useCase: PLACE_UC,
  useCaseScope: PLACE_SCOPE,
  registry: [
    ...MERGE_STATE.registry,
    { ...target('42', 'N01-U05', 'Price promos', { app: true, app_access: 'sp', app_placement: 'domain' }), app_name: 'inspire-acme-customer' },
  ],
  appsByName: { ...MERGE_STATE.appsByName, 'inspire-acme-customer': { name: 'inspire-acme-customer', description: 'Inspire use case N01-U05 (session 42): Price promos' } },
};

function holdAppList() {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const asked = [];
  return {
    asked,
    release: () => release(),
    init: (page) => page.route((url) => url.pathname === '/api/inspire/implement/merge-targets', async (route) => {
      asked.push(route.request().url());
      await held;
      await route.continue();
    }),
  };
}

test('while the App list loads nothing looks chosen and Next waits, and Create a new App picked then stays a new App when the list arrives, never the domain App', async () => {
  const list = holdAppList();
  const ui = await openUi('wizard', DOMAIN_APP_STATE, '', { init: list.init });
  const { page, made } = ui;
  try {
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^App / }).check();
    await goToStep(page, 'App placement');
    await until(() => list.asked.length > 0, 'the App list is asked');
    const group = placeStep(page).getByRole('radiogroup', { name: 'Where the App goes' });
    const fresh = placeStep(page).getByRole('radio', { name: /^Create a new App/ });
    await placeStep(page).getByText('Finding the Apps Inspire built').waitFor();
    assert.equal(await group.getAttribute('aria-busy'), 'true', 'the choice says it is still loading');
    assert.deepEqual(await placeStep(page).locator('input[name="app-place"]').evaluateAll((radios) => radios.map((r) => [r.value, r.checked, r.disabled])),
      [['join', false, true], ['new', false, false], ['inspire', false, false]], 'no choice looks made while the list loads, and Create a new App can be clicked');
    await next(page);
    await page.locator('[role="alert"]').getByText(PLACE_WAITING, { exact: true }).waitFor();
    await onStep(page, 'App placement');
    await fresh.check();
    assert.equal(await fresh.isChecked(), true, 'a click on Create a new App takes while the list loads');
    await placeStep(page).locator('[data-app-new-waiting]').waitFor();
    assert.equal(await page.getByLabel('App name').count(), 0, 'the name waits for the list, so it never takes the name of an App Inspire built');
    list.release();
    await page.getByLabel('App name').waitFor();
    assert.equal(await group.getAttribute('aria-busy'), 'false');
    assert.equal(await fresh.isChecked(), true, 'the list arriving never turns a new App into joining one');
    assert.equal(await targetRadio(page, 'inspire-acme-customer').isChecked(), false);
    assert.equal(await page.getByLabel('App name').inputValue(), 'inspire-acme-customer-2');
    await startWhenReady(page);
    const spec = submittedSpec(made);
    assert.deepEqual([spec.outputs.merge.app, spec.outputs.app_name, spec.outputs.app_placement], ['', 'inspire-acme-customer-2', 'domain']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    list.release();
    await ui.close();
  }
});

test('with the App list still loading the wizard opened on Summary keeps Start MVP off and asks for no plan, then builds once the default is set', async () => {
  const list = holdAppList();
  const plans = [];
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } }, '&step=summary', {
    init: async (page) => {
      page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/inspire/implement/plan') plans.push(r.url()); });
      await list.init(page);
    },
  });
  const { page, made } = ui;
  try {
    await onStep(page, 'Summary');
    await until(() => list.asked.length > 0, 'the App list is asked');
    const waiting = page.getByRole('button', { name: 'Listing the Apps…', exact: true });
    await waiting.waitFor();
    assert.equal(await waiting.isDisabled(), true, 'Start MVP stays off while where the App goes is not settled');
    await idle(page, { held: (r) => new URL(r.url()).pathname === '/api/inspire/implement/merge-targets' });
    assert.equal(await waiting.isDisabled(), true);
    assert.deepEqual(plans, [], 'no plan is asked for a placement that is not settled');
    assert.equal(await page.locator('[role="alert"]').getByText(PLACE_WAITING, { exact: false }).count(), 0, 'waiting is not shown as a mistake');
    list.release();
    await startWhenReady(page);
    assert.ok(plans.length >= 1);
    assert.equal(submittedSpec(made).outputs.merge.app, '');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    list.release();
    await ui.close();
  }
});

async function measure(page, name) {
  const box = await wizardFit(page);
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  }
  return box;
}

test('every wizard step but the App steps, Deliver with the App and where it goes included, fits a 1440x900 screen with nothing to scroll, and every step reads at 4.5:1 in light and dark', async () => {
  const ui = await openUi('wizard', { ...MERGE_STATE, me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  const heights = {};
  const fits = async (name) => {
    const box = await measure(page, name);
    heights[name] = box.height;
    assertFitsScreen(box, name);
  };
  const readable = async (name) => {
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const result = await lowContrast(page, ['[role="dialog"]']);
      assert.ok(result.checked >= 10, `${name}: measured ${result.checked} elements`);
      assert.deepEqual(result.low, [], `${name} ${dark ? 'dark' : 'light'}`);
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
  };
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await onStep(page, 'Use case');
    await fits('0-use-case');
    await readable('use case');
    await goToStep(page, 'Data');
    await fits('1-data');
    await goToStep(page, 'First run');
    await fits('2-first-run');
    await readable('first run');
    await goToStep(page, 'Results');
    await page.getByRole('region', { name: 'Where the result table lives' }).getByLabel('Table name').waitFor();
    await fits('3-results');
    await readable('results');
    await goToStep(page, 'Deliver');
    await page.getByRole('checkbox', { name: /^App / }).uncheck();
    for (const name of [/^Dashboard/, /^Alert/]) await page.getByRole('checkbox', { name }).check();
    await page.locator('[data-merge="dashboard"]').getByRole('button', { name: 'Create new' }).waitFor();
    await page.getByText(`Emails ${OWNER} when`, { exact: false }).waitFor();
    await fits('4-deliver');
    await page.locator('[data-merge="dashboard"]').getByRole('button', { name: 'Add to an existing one' }).click();
    await fits('4-deliver-joining');
    await page.getByRole('checkbox', { name: /^App / }).check();
    await placeStep(page).locator('[data-app-target]').first().waitFor();
    await fits('4-deliver-app');
    assert.equal(await page.locator('[data-deliver-layout="beside"]').count(), 1, 'the App placement sits beside the tiles');
    await readable('deliver');
    await placeStep(page).locator('[data-app-target] input[type="radio"]:not([disabled])').first().check();
    await fits('4-deliver-app-joining');
    await readable('deliver app joining');
    await placeStep(page).getByRole('radio', { name: /^Create a new App/ }).check();
    await goToStep(page, 'Who uses the App');
    const access = page.getByRole('region', { name: 'App access' });
    await access.getByRole('radio', { name: /^Sensitive data/ }).check();
    await readable('app access per user');
    await access.getByRole('radio', { name: /^Internal data/ }).check();
    await goToStep(page, 'App pages and look');
    await measure(page, '5-app-pages');
    await readable('app pages');
    await page.getByRole('region', { name: 'App features' }).getByRole('checkbox', { name: /^Let people edit data/ }).check();
    await page.locator('[data-swatch="mono"]').waitFor({ state: 'attached' });
    const lookTabs = page.getByRole('tablist', { name: 'App look sections' });
    for (const name of ['Palette', 'Layout', 'Charts', 'Pages']) {
      await lookTabs.getByRole('tab', { name, exact: true }).click();
      await readable(`app look ${name.toLowerCase()}`);
    }
    await goToStep(page, 'Run it');
    const holdout = page.getByRole('group', { name: 'Measure impact' }).getByRole('checkbox', { name: /^Hold back a share of records/ });
    await holdout.waitFor();
    await page.getByRole('group', { name: 'Keep it fresh' }).waitFor();
    await fits('6-run-it');
    await readable('run it');
    await goToStep(page, 'Summary');
    await page.locator('[data-picked-summary]').waitFor();
    await measure(page, '7-summary');
    await readable('summary');
    console.log(`wizard step heights at 1440x900: ${JSON.stringify(heights)}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Send alerts is a build setting of a shared App: off until ticked, then sent with the build', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, responses: { 'GET /api/2.0/postgres/projects': [{ projects: [] }, 200] } });
  const { page, made } = ui;
  try {
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^App / }).check();
    await toSharedAccess(page);
    await goToStep(page, 'App features');
    const features = page.getByRole('region', { name: 'App features' });
    const alerts = features.getByRole('checkbox', { name: /^Send alerts/ });
    assert.equal(await alerts.isChecked(), false, 'alerts start off');
    await features.locator('label', { hasText: 'Send alerts' })
      .getByText('People set up email alerts on what the App shows, each on its own schedule, sent only to people in this workspace.', { exact: false }).waitFor();
    assert.doesNotMatch(await features.locator('label', { hasText: 'Send alerts' }).textContent(), /\u2014|\u2013/);
    await alerts.check();
    await startWhenReady(page);
    assert.equal(submittedSpec(made).outputs.app_options.alerts, true);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const pad = (i) => String(i).padStart(2, '0');
function manyApps(count) {
  const ids = Array.from({ length: count }, (_, i) => pad(i + 1));
  return {
    me: { userName: OWNER, displayName: 'Owner' },
    useCase: PLACE_UC,
    registry: ids.map((id) => ({ ...target('42', `N02-U${id}`, `Finance case ${id}`, { app: true, app_access: 'sp' }), app_name: `fin-app-${id}` })),
    appsByName: Object.fromEntries(ids.map((id) => [`fin-app-${id}`,
      { name: `fin-app-${id}`, description: `Inspire use case N02-U${id} (session 42): Finance case ${id}` }])),
    useCaseScope: ids.map((id) => ({ session_id: '42', use_case_id: `N02-U${id}`, business: 'Acme', domain: 'Finance' })),
  };
}

async function placementBox(page) {
  const fit = await wizardFit(page);
  const list = await page.evaluate(() => {
    const shown = document.querySelector('[data-app-list]');
    const rows = [...shown.querySelectorAll('[data-app-target]')].map((li) => Math.round(li.getBoundingClientRect().height));
    return { list: Math.round(shown.getBoundingClientRect().height), scroll: shown.scrollHeight, client: shown.clientHeight, rows };
  });
  return { ...list, dialog: fit.height, content: fit.scroll };
}

const rowInView = (page, id) => page.evaluate((app) => {
  const list = document.querySelector('[data-app-list]').getBoundingClientRect();
  const row = document.querySelector(`[data-app-target="${app}"]`).getBoundingClientRect();
  return row.top >= list.top - 1 && row.bottom <= list.bottom + 1;
}, id);

const APP_LIST_CAP = 240;

test('fifteen Apps scroll inside a list of fixed height: the wizard keeps the height it has with two, the last App can be picked by scrolling or keys, and the chosen App is in view when the step opens again', async () => {
  const sizes = {};
  for (const count of [2, 15]) {
    const ui = await openUi('wizard', manyApps(count));
    const { page, made } = ui;
    try {
      await toDelivery(page);
      await page.getByRole('checkbox', { name: /^App / }).check();
      await toSharedAccess(page);
      await goToStep(page, 'App placement');
      await placeStep(page).locator('[data-app-target]').nth(count - 1).waitFor({ state: 'attached' });
      sizes[count] = await placementBox(page);
      assert.equal(await placeStep(page).locator('[data-app-target] [data-fit]').count(), count, 'every row keeps its fit badge');
      assert.equal(await placeStep(page).locator('[data-app-target]', { hasText: 'It holds only Finance use cases, not Customer' }).count(), count,
        'every row keeps its reason');
      if (count === 2) continue;
      assert.ok(sizes[15].list <= APP_LIST_CAP, `the list stays within ${APP_LIST_CAP}px: ${JSON.stringify(sizes[15])}`);
      assert.ok(sizes[15].scroll > sizes[15].client + 100, 'the other Apps are a scroll away');
      assert.equal(await rowInView(page, 'fin-app-15'), false, 'the last App starts below the fold');
      const last = targetRadio(page, 'fin-app-15');
      const appList = placeStep(page).locator('[data-app-list]');
      await wheelScrolls(page, appList, () => appList.locator('[data-app-target="fin-app-15"]'), { name: 'Apps Inspire built' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert.equal(await rowInView(page, 'fin-app-15'), true);
      await last.check();
      assert.equal(await placeStep(page).getByRole('note', { name: JOIN_NOTE }).textContent(), joinedText('fin-app-15'));
      await last.focus();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      assert.equal(await targetRadio(page, 'fin-app-13').isChecked(), true, 'the arrow keys move between the Apps');
      assert.equal(await page.evaluate(() => document.activeElement?.value), 'fin-app-13');
      assert.equal(await rowInView(page, 'fin-app-13'), true, 'the focused App scrolls into view');
      for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowUp');
      assert.equal(await page.evaluate(() => document.activeElement?.value), 'fin-app-03');
      assert.equal(await rowInView(page, 'fin-app-03'), true, 'the focus moves the scroll up too');
      await page.keyboard.press('Tab');
      assert.notEqual(await page.evaluate(() => document.activeElement?.name), 'app-target', 'Tab leaves the list of Apps');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.value), 'fin-app-03', 'Shift+Tab comes back to the chosen App');
      for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowDown');
      assert.equal(await targetRadio(page, 'fin-app-15').isChecked(), true);
      await toVibes(page);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await onStep(page, 'Run it');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await onStep(page, 'Deliver');
      await placeStep(page).locator('[data-app-target]').nth(14).waitFor({ state: 'attached' });
      await settled(page, '[data-app-list]');
      assert.equal(await targetRadio(page, 'fin-app-15').isChecked(), true);
      assert.equal(await rowInView(page, 'fin-app-15'), true, 'the chosen App is in view when the step opens again');
      await startWhenReady(page);
      assert.equal(submittedSpec(made).outputs.merge.app, 'fin-app-15');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
  console.log(`App placement sizes: ${JSON.stringify(sizes)}`);
  assert.equal(sizes[2].list, sizes[15].list, 'the list box is the same height for 2 Apps and 15');
  assert.ok(Math.abs(sizes[2].dialog - sizes[15].dialog) <= 2, `the dialog keeps its height: ${sizes[2].dialog} vs ${sizes[15].dialog}`);
  assert.ok(Math.abs(sizes[2].content - sizes[15].content) <= 2, `the step content keeps its height: ${sizes[2].content} vs ${sizes[15].content}`);
});

const joinedText = (name) => `It keeps the look of ${name}, its sign-in and its data source, so everyone who opens it sees the same rows. `
  + 'For your own, choose Create new.';

const WAREHOUSES = { warehouses: [{ id: 'wh1', name: 'Shared SQL', state: 'RUNNING' }, { id: 'wh2', name: 'Finance SQL', state: 'STOPPED' },
  { id: 'wh3', name: 'Ops SQL', state: 'RUNNING' }] };
const MANAGES = (level) => [{ access_control_list: [{ user_name: OWNER, all_permissions: [{ permission_level: level }] }] }, 200];
const DELTA_LABEL = 'SQL warehouse the App reads and saves with';
const LAKEBASE_LABEL = 'SQL warehouse the App saves, keeps history and runs alerts with (pages read the fast copy)';

test('the App reads and saves with the SQL warehouse picked on App access, labeled for Lakebase or Delta, the build keeps its own, and a warehouse Inspire cannot manage is named with the permission it needs', async () => {
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' },
    warehouses: WAREHOUSES,
    responses: {
      'GET /api/2.0/postgres/projects': [{ projects: [] }, 200],
      'GET /api/2.0/sql/warehouses/wh2': [{ id: 'wh2', name: 'Finance SQL' }, 200],
      'GET /api/2.0/sql/warehouses/wh3': [{ id: 'wh3', name: 'Ops SQL' }, 200],
      'GET /api/2.0/permissions/sql/warehouses/wh2': MANAGES('CAN_USE'),
      'GET /api/2.0/permissions/sql/warehouses/wh3': MANAGES('CAN_MANAGE'),
    },
  });
  const { page, made } = ui;
  try {
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^App / }).check();
    await toSharedAccess(page);
    const access = page.getByRole('region', { name: 'App access' });
    await access.getByRole('group', { name: 'How fast do the App\'s pages open?' }).getByRole('status').waitFor({ state: 'detached' });
    await openAdvanced(page);
    const field = access.locator('[data-app-warehouse="pick"]');
    const select = field.locator('select');
    await select.locator('option[value="wh3"]').waitFor({ state: 'attached' });
    assert.equal(await field.locator('label span').first().textContent(), LAKEBASE_LABEL, 'a Lakebase App still saves, keeps history and alerts on the warehouse');
    assert.equal(await select.inputValue(), 'wh1', 'the build warehouse is the default');
    assert.deepEqual(await select.locator('option').allTextContents(),
      ['Shared SQL (RUNNING) · used for the build', 'Finance SQL (STOPPED)', 'Ops SQL (RUNNING)']);
    const buildNote = field.getByText("Dashboards and alerts Inspire builds keep using the build's SQL warehouse, Shared SQL (RUNNING).", { exact: true });
    assert.equal(await buildNote.count(), 0, 'on the build warehouse the option itself says so');
    await access.getByText('Standard pages (take a few seconds to open)', { exact: true }).click();
    assert.equal(await field.locator('label span').first().textContent(), DELTA_LABEL);
    await select.selectOption('wh2');
    await buildNote.waitFor();
    await field.locator('[data-app-warehouse-check]').getByText('Inspire cannot manage Finance SQL, so the App cannot read and save with it: '
      + 'ask the warehouse owner to grant Inspire CAN MANAGE on it, or pick another SQL warehouse for the App', { exact: true }).waitFor();
    assert.ok(made.fetches.some((f) => f.path === '/api/2.0/permissions/sql/warehouses/wh2'), 'the check reads who can manage wh2');
    await select.selectOption('wh1');
    await select.selectOption('wh3');
    await page.waitForFunction(() => {
      const checked = [...document.querySelectorAll('[data-app-warehouse-check]')];
      return !checked.length;
    });
    await goToStep(page, 'App look');
    await startWhenReady(page);
    const spec = submittedSpec(made);
    assert.deepEqual([spec.outputs.app_warehouse_id, spec.config.warehouse_id, spec.outputs.app_backend], ['wh3', 'wh1', 'delta']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a use case added to another use case\'s App shows that App\'s SQL warehouse locked and sends no warehouse of its own', async () => {
  const state = {
    ...MERGE_STATE,
    useCase: PLACE_UC,
    useCaseScope: PLACE_SCOPE,
    warehouses: { warehouses: [{ id: 'wh1', name: 'Shared SQL', state: 'RUNNING' }, { id: 'wh9', name: 'Sales SQL', state: 'RUNNING' }] },
    appsByName: { ...MERGE_STATE.appsByName,
      'ops-desk': { ...MERGE_STATE.appsByName['ops-desk'], resources: [{ name: 'sql-warehouse', sql_warehouse: { id: 'wh9', permission: 'CAN_USE' } }] } },
  };
  const ui = await openUi('wizard', state);
  const { page, made } = ui;
  try {
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^App / }).check();
    await goToStep(page, 'App placement');
    await placeStep(page).locator('[data-app-target="ops-desk"]').waitFor();
    assert.deepEqual([await targetRadio(page, 'ops-desk').isChecked(), await targetRadio(page, 'ops-desk').isDisabled()], [false, true],
      'a new use case signs each viewer in, so it does not join an App that shows everyone the same rows (must-exclude)');
    await toSharedAccess(page);
    await goToStep(page, 'App placement');
    await targetRadio(page, 'ops-desk').check();
    await placeStep(page).getByRole('note', { name: JOIN_NOTE }).waitFor();
    const locked = placeStep(page).locator('[data-app-warehouse="locked"]');
    await locked.locator('option', { hasText: 'Sales SQL (RUNNING)' }).waitFor({ state: 'attached' });
    assert.deepEqual([await locked.locator('select').inputValue(), await locked.locator('select').isDisabled()], ['wh9', true]);
    assert.equal(await locked.locator('p').textContent(), 'Locked: the pages of this use case read with the SQL warehouse of ops-desk, the one Forecast '
      + 'demand chose when it built it; changing it would change the pages of the other use cases in it too.');
    assert.equal(await locked.locator('[data-technical-details] pre').textContent(), 'Built by use case N01-U02', 'the use case id sits only under Details');
    await targetRadio(page, 'care-desk').check();
    assert.equal(await locked.count(), 0, 'an App whose warehouse Inspire cannot read shows no warehouse');
    await targetRadio(page, 'ops-desk').check();
    await toVibes(page);
    await startWhenReady(page);
    const spec = submittedSpec(made);
    assert.deepEqual([spec.outputs.merge.app, spec.outputs.app_warehouse_id], ['ops-desk', '']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
