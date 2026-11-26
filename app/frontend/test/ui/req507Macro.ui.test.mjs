// REQ-507 L5 (StepMacro, MacroChart; green once L7 wires them): the Market data step for a plan with economic factors. The offer (public data
// recommended), source cards with Marketplace first and the IMF terms, a series fetched through the App's route, the chart with history and
// forecast apart, the citation, the elasticity slider (asks the server again), a blocked host, and the factor saved with its source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { dragTo, openCard, openWizard } from './valueWizardSupport.mjs';
import { FACTOR_PLAN, SERIES, goTo507, mountReq507, textOf } from './req507Support.mjs';

test.after(closeBrowser);

async function toSeries(dialog) {
  await goTo507(dialog, 'macro:offer');
  assert.equal(await dialog.getByRole('button', { name: 'Use public data' }).getAttribute('data-recommended'), 'true');
  await dialog.getByRole('button', { name: 'Use public data' }).click();
  await dialog.locator('[data-wizard-page="macro:series"]').waitFor();
}

test('R507-M1: the offer names the factors; source cards come Marketplace first, IMF says its data never trains a model', async () => {
  const calls = [];
  const { ui, card, page } = await openCard(mountReq507({ calls, plan: FACTOR_PLAN }));
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'macro:offer');
    assert.match(await textOf(dialog.locator('[data-wizard-page="macro:offer"]')), /Use public economic data for these factors\?/);
    assert.match(await textOf(dialog.locator('[data-wizard-page="macro:offer"]')), /Consumer demand/);
    await toSeries(dialog);
    assert.deepEqual(await dialog.locator('[data-macro-source]').evaluateAll((els) => els.map((e) => e.getAttribute('data-macro-source'))),
      ['marketplace', 'worldbank', 'imf', 'oecd', 'eurostat', 'undata']);
    assert.match(await textOf(dialog.locator('[data-macro-source="imf"]')), /never used to train a model/);
    assert.match(await textOf(dialog.locator('[data-macro-source="marketplace"]')), /admin/i, 'an unconfigured Marketplace share says an admin names its table');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-M2: a picked series is fetched through the App, drawn with history and forecast apart, and cited', async () => {
  const calls = [];
  const { ui, card, page } = await openCard(mountReq507({ calls, plan: FACTOR_PLAN }));
  try {
    const dialog = await openWizard(page, card);
    await toSeries(dialog);
    await dialog.locator('[data-macro-source="worldbank"]').click();
    await dialog.getByRole('textbox', { name: 'Country' }).fill('USA');
    await dialog.getByRole('textbox', { name: 'Indicator' }).fill('NE.CON.PRVT.KD.ZG');
    await dialog.getByRole('button', { name: 'Get series' }).click();
    await dialog.locator('[data-wizard-page="macro:factor"]').waitFor({ timeout: 15000 });
    const asked = calls.find((c) => c.route === 'macro-series');
    assert.equal(asked.query.source, 'worldbank');
    assert.equal(asked.query.country, 'USA');
    assert.equal(asked.query.factor_id, 'consumer_demand');
    assert.equal(await dialog.locator('[data-macro-chart] [data-macro-history]').count(), 1);
    assert.equal(await dialog.locator('[data-macro-chart] [data-macro-forecast]').count(), 1);
    assert.equal(await textOf(dialog.locator('[data-macro-citation]')), 'World Bank, NE.CON.PRVT.KD.ZG, USA, 2016-2025, fetched 23 Nov 2026, CC BY 4.0');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-M3: the elasticity slider asks the server again; the factor is saved with its source', async () => {
  const calls = [];
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ calls, puts, plan: FACTOR_PLAN }));
  try {
    const dialog = await openWizard(page, card);
    await toSeries(dialog);
    await dialog.locator('[data-macro-source="worldbank"]').click();
    await dialog.getByRole('textbox', { name: 'Country' }).fill('USA');
    await dialog.getByRole('textbox', { name: 'Indicator' }).fill('NE.CON.PRVT.KD.ZG');
    await dialog.getByRole('button', { name: 'Get series' }).click();
    await dialog.locator('[data-wizard-page="macro:factor"]').waitFor({ timeout: 15000 });
    const slider = dialog.locator('[data-elasticity] input[type=range]');
    assert.equal(await slider.inputValue(), '1');
    await dragTo(slider, 0.5);
    for (let i = 0; i < 50 && !calls.some((c) => c.route === 'macro-series' && c.query.elasticity === '0.5'); i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.ok(calls.some((c) => c.route === 'macro-series' && c.query.elasticity === '0.5'), 'the server computes the scaled factor');
    await dialog.getByRole('button', { name: 'Use this for Consumer demand' }).click();
    await goTo507(dialog, 'terms', { macro: 'public' });
    await dialog.getByLabel('I have read and accept these terms').check();
    await dialog.getByRole('button', { name: 'Accept and save' }).click();
    for (let i = 0; i < 50 && !puts.length; i += 1) await new Promise((r) => setTimeout(r, 100));
    const factor = puts[0].answers.plan.economic_factors.find((f) => f.id === 'consumer_demand');
    assert.deepEqual(factor.source, { name: 'World Bank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'USA', fetched_at: SERIES.fetched_at, url: SERIES.citation.url });
    assert.equal(factor.elasticity, 0.5);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-M4: a blocked host shows the plain message and lets the person keep their own estimates', async () => {
  const blocked = { blocked: true, host: 'api.worldbank.org', message: 'Your workspace blocks api.worldbank.org; ask an admin to allow it, or use a Marketplace share' };
  const { ui, card, page } = await openCard(mountReq507({ plan: FACTOR_PLAN, series: blocked }));
  try {
    const dialog = await openWizard(page, card);
    await toSeries(dialog);
    await dialog.locator('[data-macro-source="worldbank"]').click();
    await dialog.getByRole('textbox', { name: 'Country' }).fill('USA');
    await dialog.getByRole('textbox', { name: 'Indicator' }).fill('NE.CON.PRVT.KD.ZG');
    await dialog.getByRole('button', { name: 'Get series' }).click();
    await dialog.locator('[data-macro-blocked]').waitFor({ timeout: 15000 });
    assert.equal(await textOf(dialog.locator('[data-macro-blocked]')), blocked.message);
    await dialog.getByRole('button', { name: 'Keep my own estimates' }).click();
    await dialog.locator('[data-wizard-page="story:draft"]').waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
