import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { DECIDE, PERSON, SRC, appInfo, bundleEntry, openApp, openBundle, serveDist } from './harness.mjs';
import { forecastRoutes, plannerRoutes } from './exampleRoutes.mjs';
import { PID, reviewRoutes, versionRoutes } from './planRoutes.mjs';

const STYLES = ['shell', 'looks', 'app', 'edits', 'daily', 'data', 'chrome', 'layouts'].map((s) => `import ${JSON.stringify(join(SRC, 'styles', `${s}.css`))};`).join('\n');
const HOST = `
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
${STYLES}
import { ToastProvider } from ${JSON.stringify(join(SRC, 'ui.jsx'))};
import PlanMode from ${JSON.stringify(join(SRC, 'PlanMode.jsx'))};
import ForecastMode from ${JSON.stringify(join(SRC, 'ForecastMode.jsx'))};
import { MODES, pageMode } from ${JSON.stringify(join(SRC, 'modes.js'))};
const { app, which, part } = window.props;
window.labels = { plan: [MODES.plan.work, MODES.plan.performance], forecast: [MODES.forecast.work, MODES.forecast.performance], mode: pageMode(app.pages[0]).id };
const View = (which === 'plan' ? PlanMode : ForecastMode)[part === 'work' ? 'Work' : 'Performance'];
createRoot(document.getElementById('root')).render(h(ToastProvider, null, h('main', { className: 'main' }, h(View, { app, page: app.pages[0], onRun: (say) => { window.solved = say(); }, running: false }))));
`;

let browser;
let host;
let served;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
  host = await bundleEntry(HOST);
});

after(async () => {
  await browser?.close();
  served?.close();
});


const INFO = { plan: appInfo(DECIDE, 1, {}, 'examples/planner.json'), forecast: appInfo(DECIDE, 1, {}, 'examples/forecast_cockpit.json') };
const PAGE = { plan: INFO.plan.pages[0].id, forecast: INFO.forecast.pages[0].id };

async function open(which, part, routes) {
  return openBundle(browser, host, { app: INFO[which], which, part }, routes);
}

const toastIs = (page, text) => page.waitForFunction((t) => document.querySelector('.toast .toast-t')?.textContent?.startsWith(t), text);

test('the plan and forecast modes name their work and performance sections Plan, Performance, Review and Accuracy', async () => {
  const { page, context, errors } = await open('plan', 'work', { ...plannerRoutes([], []), ...versionRoutes('plan').routes });
  await page.locator('[data-plan-section]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.labels), { plan: ['Plan', 'Performance'], forecast: ['Review', 'Accuracy'], mode: 'plan' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('the Plan section locks every line until a draft exists, then records each override on the draft with its reason', async () => {
  const decided = [];
  const versions = versionRoutes('plan');
  const { page, context, errors } = await open('plan', 'work', { ...plannerRoutes(decided, [], { keep: true }), ...versions.routes });
  await page.locator('[data-plan-row="K1"]').waitFor();
  assert.match(await page.locator('[data-plan-locked]').innerText(), /Start a draft to accept or override lines/);
  assert.equal(await page.locator('[data-plan-row="K1"]').getByRole('button', { name: 'Accept' }).count(), 0);
  assert.equal(await page.locator('[data-limit]').count(), 3);
  assert.equal(await page.locator('[data-limit="Oven hours"].is-full').count(), 1);
  assert.equal(await page.locator('[data-resolve]').count(), 1);
  await page.locator('[data-resolve]').click();
  assert.equal(await page.evaluate(() => window.solved), 'Started a new solve: the plan updates when the run ends');
  await page.locator('[data-move="new"]').click();
  await page.locator('[data-version="1"][data-status="Draft"]').waitFor();
  await toastIs(page, 'Started Version 1');
  assert.equal(await page.locator('[data-plan-locked]').count(), 0);
  const row = page.locator('[data-plan-row="K1"]');
  await row.getByRole('button', { name: 'Override' }).click();
  const form = page.locator('tr.plan-form form');
  await form.locator('input[type="number"]').fill('95');
  const save = form.getByRole('button', { name: 'Save override' });
  assert.equal(await save.isDisabled(), true, 'an override without a reason cannot be saved');
  await form.locator('input[dir="auto"]').fill('Line two is down');
  await save.click();
  await toastIs(page, 'Saved your override and its reason');
  assert.deepEqual(decided[0], { page: PAGE.plan, record_key: 'K1', seen: '500', decision: 'override', reason: 'Line two is down', recommended: 90, value: 95, plan_id: PID });
  assert.deepEqual(errors, []);
  await context.close();
});

test('approving a plan version asks for a reason, accepts the lines left open on the version, then locks the plan', async () => {
  const decided = [];
  const versions = versionRoutes('plan', { versions: [{ plan_id: PID, number: 1, label: 'Version 1', status: 'Draft', overrides: [] }] });
  const { page, context, errors } = await open('plan', 'work', { ...plannerRoutes(decided, [], { keep: true }), ...versions.routes });
  await page.locator('[data-plan-row="K1"]').getByRole('button', { name: 'Accept' }).waitFor();
  await page.locator('[data-move="approve"]').click();
  const reasonSave = page.locator('[data-reason-form="approve"] [data-reason-save]');
  assert.equal(await reasonSave.isDisabled(), true, 'an approval without a reason cannot be sent');
  await page.locator('[data-reason-form="approve"] [data-reason]').fill('   ');
  assert.equal(await reasonSave.isDisabled(), true, 'a reason of only spaces is no reason');
  assert.equal(await page.locator('[data-reason-form="approve"] [data-reason]').getAttribute('maxlength'), '500');
  await page.locator('[data-reason-form="approve"] [data-reason]').fill('Fits the oven hours');
  await reasonSave.click();
  await page.locator('[data-version="1"][data-status="Approved"]').waitFor();
  await toastIs(page, 'Version 1 is approved. Accepted the suggested value of 6 lines');
  assert.equal(decided.length, 6);
  assert.ok(decided.every((d) => d.decision === 'accept' && d.plan_id === PID));
  assert.deepEqual(versions.state.moves.at(-1), { page: PAGE.plan, action: 'approve', reason: 'Fits the oven hours', plan_id: PID, seen: 'Draft' });
  await page.locator('[data-plan-locked]').waitFor();
  assert.match(await page.locator('[data-plan-locked]').innerText(), /Version 1 is Approved\. Start a new draft/);
  assert.deepEqual(await page.locator('[data-move]').evaluateAll((els) => els.map((e) => e.dataset.move)), ['new', 'publish', 'reopen']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a person who is not an owner can send a version for review but not approve it', async () => {
  const versions = versionRoutes('plan', { approve: false, versions: [{ plan_id: PID, number: 1, label: 'Version 1', status: 'Draft', overrides: [] }] });
  const { page, context, errors } = await open('plan', 'work', { ...plannerRoutes([], []), ...versions.routes });
  const approve = page.locator('[data-move="approve"]');
  await approve.waitFor();
  assert.equal(await approve.isDisabled(), true);
  assert.match(await approve.getAttribute('title'), /Only the owners/);
  await page.locator('[data-move="submit"]').click();
  assert.equal(await page.locator('[data-reason-form="submit"] [data-reason-save]').isDisabled(), false, 'a note for the reviewers is optional');
  await page.locator('[data-reason-form="submit"] [data-reason-save]').click();
  await page.locator('[data-version="1"][data-status="In review"]').waitFor();
  assert.deepEqual(versions.state.moves, [{ page: PAGE.plan, action: 'submit', reason: '', plan_id: PID, seen: 'Draft' }]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a plan move the server refuses shows its error and keeps the version as it was', async () => {
  const versions = versionRoutes('plan', { versions: [{ plan_id: PID, number: 1, label: 'Version 1', status: 'Approved', overrides: [] }] });
  const routes = { ...plannerRoutes([], []), ...versions.routes, 'plans/version': ({ json }) => json(409, { error: 'Version 1 is Published now, not Approved; check it and try again' }) };
  const { page, context } = await open('plan', 'work', routes);
  await page.locator('[data-move="publish"]').click();
  await page.locator('[data-reason-form="publish"] [data-reason]').fill('Sent to the plant');
  await page.locator('[data-reason-form="publish"] [data-reason-save]').click();
  await page.locator('[data-versions] .tile-err').waitFor();
  assert.match(await page.locator('[data-versions] .tile-err').innerText(), /Published now, not Approved/);
  assert.equal(await page.locator('[data-version="1"]').getAttribute('data-status'), 'Approved');
  await context.close();
});

test('an older Approved version can be published while the next draft stays open, and a Draft offers no publish', async () => {
  const OLD = 'b'.repeat(32);
  const versions = versionRoutes('plan', { versions: [{ plan_id: PID, number: 2, label: 'Version 2', status: 'Draft', overrides: [] },
    { plan_id: OLD, number: 1, label: 'Version 1', status: 'Approved', overrides: [] }] });
  const { page, context, errors } = await open('plan', 'work', { ...plannerRoutes([], []), ...versions.routes });
  await page.locator('[data-version="1"] [data-move-version="1"]').waitFor();
  assert.equal(await page.locator('[data-move-version="2"]').count(), 0);
  assert.equal(await page.locator('[data-move="new"]').count(), 0);
  assert.deepEqual(await page.locator('.plan-moves [data-move]').evaluateAll((els) => els.map((e) => e.dataset.move)), ['submit', 'approve']);
  await page.locator('[data-move-version="1"]').click();
  await page.locator('[data-reason-form="publish"] [data-reason-save]').waitFor();
  assert.equal(await page.locator('[data-reason-form="publish"] [data-reason-save]').isDisabled(), true);
  await page.locator('[data-reason-form="publish"] [data-reason]').fill('Publish this cycle, keep drafting the next');
  await page.locator('[data-reason-form="publish"] [data-reason-save]').click();
  await page.locator('[data-version="1"][data-status="Published"]').waitFor();
  await toastIs(page, 'Version 1 is published');
  assert.deepEqual(versions.state.moves, [{ page: PAGE.plan, action: 'publish', reason: 'Publish this cycle, keep drafting the next', plan_id: OLD, seen: 'Approved' }]);
  assert.equal(await page.locator('[data-version="2"]').getAttribute('data-status'), 'Draft');
  assert.equal(await page.locator('[data-move-version]').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('an older Approved version under a newer published one offers no publish', async () => {
  const versions = versionRoutes('plan', { versions: [{ plan_id: PID, number: 3, label: 'Version 3', status: 'Draft', overrides: [] },
    { plan_id: 'c'.repeat(32), number: 2, label: 'Version 2', status: 'Published', overrides: [] }, { plan_id: 'b'.repeat(32), number: 1, label: 'Version 1', status: 'Approved', overrides: [] }] });
  const { page, context, errors } = await open('plan', 'work', { ...plannerRoutes([], []), ...versions.routes });
  await page.locator('[data-version="1"]').waitFor();
  assert.equal(await page.locator('[data-move-version]').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Performance compares the approved plan with the actuals and counts the value realized', async () => {
  const results = { version: { plan_id: PID, label: 'Version 2', status: 'Published' }, counted: 3, on_plan: 2, off_plan: 1, unknown: 0,
    value_planned: 7000, value_realized: 4500, has_value: true, truncated: false, missing: '',
    lines: [{ line_key: 'K3', label: 'Tea tin', planned: 130, actual: 90, gap: -40, state: 'off', overridden: true, reason: 'Short of tins', value: 2500 },
      { line_key: 'K1', label: 'Oat bar', planned: 90, actual: 90, gap: 0, state: 'on', overridden: false, reason: '', value: 4000 }] };
  const { page, context, errors } = await open('plan', 'perf', { 'plans/performance': ({ json }) => json(200, results) });
  await page.locator('[data-stat="realized"]').waitFor();
  assert.match(await page.locator('[data-stat="version"]').innerText(), /Version 2\s+Published/);
  assert.match(await page.locator('[data-stat="on_plan"]').innerText(), /2 of 3/);
  assert.equal(await page.locator('[data-stat="off_plan"].is-bad').count(), 1);
  assert.match(await page.locator('[data-stat="realized"]').innerText(), /\$4\.5K\s+of \$7K planned/);
  assert.deepEqual(await page.locator('[data-perf-line]').evaluateAll((els) => els.map((e) => [e.dataset.perfLine, e.dataset.state])), [['K3', 'off'], ['K1', 'on']]);
  assert.match(await page.locator('[data-perf-line="K3"]').innerText(), /Tea tin\s+130\s+90\s+[−-]40\s+Off plan\s+Short of tins/);
  assert.deepEqual(errors, []);
  await context.close();
  const empty = await open('plan', 'perf', { 'plans/performance': ({ json }) => json(200, { version: null, lines: [], missing: '' }) });
  await empty.page.locator('[data-no-plan]').waitFor();
  await empty.context.close();
});


test('Review lists the series at risk first, and an override needs a value and a reason and is saved on the open cycle', async () => {
  const sent = [];
  const { page, context, errors } = await open('forecast', 'work', { ...forecastRoutes([]), ...reviewRoutes({ plan_id: PID, number: 1, label: 'Version 1', status: 'Draft', overrides: [] }, sent) });
  await page.locator('[data-series="S1"]').waitFor();
  assert.equal(await page.locator('[data-series]').count(), 1, 'only the series at risk show first');
  assert.match(await page.locator('[data-series-queue] .card-h p').first().innerText(), /1 of 2 series/);
  await page.locator('[data-show="all"]').click();
  assert.deepEqual(await page.locator('[data-series]').evaluateAll((els) => els.map((e) => [e.dataset.series, e.dataset.atRisk])), [['S1', 'yes'], ['S2', 'no']]);
  await page.locator('[data-series="S1"] [data-override-open]').click();
  await page.locator('[data-override-value]').fill('150');
  assert.equal(await page.locator('[data-override-save]').isDisabled(), true, 'an override without a reason cannot be saved');
  assert.equal(await page.locator('[data-override-reason]').getAttribute('maxlength'), '500');
  await page.locator('[data-override-reason]').fill('Promo week');
  await page.locator('[data-override-save]').click();
  await toastIs(page, 'Saved your forecast for S1 and its reason');
  assert.deepEqual(sent, [{ page: PAGE.forecast, plan_id: PID, series_id: 'S1', period: '2026-12', value: 150, reason: 'Promo week' }]);
  assert.match(await page.locator('[data-series="S1"] [data-override]').innerText(), /150\s+Promo week/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Review locks overrides until a cycle is open, and signing off a cycle needs a reason', async () => {
  const sent = [];
  const { page, context, errors } = await open('forecast', 'work', { ...forecastRoutes([]), ...reviewRoutes(null, sent) });
  await page.locator('[data-series="S1"]').waitFor();
  assert.equal(await page.locator('[data-override-open]').count(), 0);
  assert.match(await page.locator('[data-plan-locked]').innerText(), /Start a review cycle/);
  await page.locator('[data-move="new"]').click();
  await page.locator('[data-override-open]').first().waitFor();
  assert.deepEqual(await page.locator('[data-move]').evaluateAll((els) => els.map((e) => e.textContent)), ['Sign off the cycle']);
  await page.locator('[data-move="approve"]').click();
  assert.equal(await page.locator('[data-reason-form="approve"] [data-reason-save]').isDisabled(), true);
  await page.locator('[data-reason-form="approve"] [data-reason]').fill('Reviewed every series at risk');
  await page.locator('[data-reason-form="approve"] [data-reason-save]').click();
  await page.locator('[data-plan-locked]').filter({ hasText: 'Cycle 1 is signed off' }).waitFor();
  assert.equal(await page.locator('[data-override-open]').count(), 0);
  assert.deepEqual(sent.at(-1), { page: PAGE.forecast, action: 'approve', reason: 'Reviewed every series at risk', plan_id: PID, seen: 'Draft' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('Accuracy shows forecast error, bias, error against naive and the lift of overrides over the model', async () => {
  const accuracy = { points: 40, series: 4, error: 0.1, bias: -0.05, mase: 0.9, overrides: 3, helped: 2, hurt: 1, lift: 0.4, lift_note: '' };
  const { page, context, errors } = await open('forecast', 'perf', { 'forecast/accuracy': ({ json }) => json(200, accuracy) });
  await page.locator('[data-stat="lift"]').waitFor();
  assert.match(await page.locator('[data-stat="error"]').innerText(), /10\.0%\s+over 40 past periods of 4 series/);
  assert.match(await page.locator('[data-stat="bias"]').innerText(), /-5\.0%\s+the forecast runs below the actuals/);
  assert.equal(await page.locator('[data-stat="bias"].is-bad').count(), 1);
  assert.match(await page.locator('[data-stat="mase"]').innerText(), /0\.9/);
  assert.match(await page.locator('[data-stat="lift"]').innerText(), /\+40\.0%\s+better than the model alone \S+ 2 helped, 1 hurt/);
  assert.equal(await page.locator('[data-stat="lift"].is-good').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
  const bare = await open('forecast', 'perf', { 'forecast/accuracy': ({ json }) => json(200, { ...accuracy, overrides: 0, lift: null, helped: 0, hurt: 0,
    lift_note: 'the plan versions table does not exist yet' }) });
  await bare.page.locator('[data-plans-missing]').waitFor();
  assert.match(await bare.page.locator('[data-stat="lift"]').innerText(), /Not recorded\s+no override has an actual to check yet/);
  await bare.context.close();
});

const railText = (page) => page.locator('nav.rail [data-rail]').evaluateAll((els) => els.map((e) => [e.dataset.rail, e.textContent.trim()]));

test('in the App a planner page names its rail Plan and Performance and opens the plan versions, its lines and the plan against actuals', async () => {
  const versions = versionRoutes('plan');
  const results = { version: null, lines: [], missing: '' };
  const { page, seen, context } = await openApp(browser, served.base, INFO.plan, { routes: { ...plannerRoutes([], []), ...versions.routes,
    'plans/performance': ({ json }) => json(200, results) } });
  await page.locator('nav.rail [data-rail="work"]').waitFor();
  const rail = Object.fromEntries(await railText(page));
  assert.equal(rail.work, 'Plan');
  assert.equal(rail.performance, 'Performance');
  await page.locator('nav.rail [data-rail="work"]').click();
  await page.locator('[data-plan-section] [data-move="new"]').waitFor();
  await page.locator('[data-plan-row="K1"]').waitFor();
  assert.equal(await page.locator('[data-mode-pending]').count(), 0);
  await page.locator('nav.rail [data-rail="performance"]').click();
  await page.locator('[data-plan-performance] [data-no-plan]').waitFor();
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('in the App a forecast page names its rail Review and Accuracy and opens the review queue and the accuracy panel', async () => {
  const accuracy = { points: 4, series: 1, error: 0.2, bias: 0.1, mase: 1.3, overrides: 0, helped: 0, hurt: 0, lift: null, lift_note: '' };
  const { page, seen, context } = await openApp(browser, served.base, INFO.forecast, { routes: { ...forecastRoutes([]), ...reviewRoutes(null, []),
    'forecast/accuracy': ({ json }) => json(200, accuracy) } });
  await page.locator('nav.rail [data-rail="work"]').waitFor();
  const rail = Object.fromEntries(await railText(page));
  assert.equal(rail.work, 'Review');
  assert.equal(rail.performance, 'Accuracy');
  await page.locator('nav.rail [data-rail="work"]').click();
  await page.locator('[data-review-section] [data-series="S1"]').waitFor();
  await page.locator('nav.rail [data-rail="performance"]').click();
  await page.locator('[data-accuracy] [data-stat="error"]').waitFor();
  assert.match(await page.locator('[data-stat="error"]').innerText(), /20\.0%/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Plan and Review sections fit 1280 and 1440 with no sideways scroll, in light, dark and right to left, and their buttons show a focus ring', async () => {
  const accuracy = { points: 4, series: 1, error: 0.2, bias: 0.1, mase: 1.3, overrides: 0, helped: 0, hurt: 0, lift: null, lift_note: '' };
  const kinds = {
    plan: { routes: () => ({ ...plannerRoutes([], []), ...versionRoutes('plan').routes, 'plans/performance': ({ json }) => json(200, { version: null, lines: [], missing: '' }) }),
      ready: '[data-plan-section] [data-plan-row="K1"]', section: '[data-plan-section]' },
    forecast: { routes: () => ({ ...forecastRoutes([]), ...reviewRoutes(null, []), 'forecast/accuracy': ({ json }) => json(200, accuracy) }),
      ready: '[data-review-section] [data-series="S1"]', section: '[data-review-section]' },
  };
  for (const [which, kind] of Object.entries(kinds)) {
    for (const [width, scheme, rtl] of [[1280, 'light', false], [1440, 'dark', false], [1280, 'dark', true], [1440, 'light', true]]) {
      const at = `${which} ${width} ${scheme}${rtl ? ' rtl' : ''}`;
      const { page, seen, context } = await openApp(browser, served.base, INFO[which], { width, scheme, routes: kind.routes(), hash: `#/${PAGE[which]}/work` });
      await page.locator(kind.ready).waitFor();
      if (rtl) await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
      const fit = await page.evaluate((sel) => {
        const box = document.querySelector(sel);
        const wide = [...document.querySelectorAll('.main, html'), box].map((el) => el.scrollWidth - el.clientWidth);
        const out = [...box.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && !el.closest('.tw') && (r.right > window.innerWidth + 1 || r.left < -1); })
          .slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
        return { wide, out };
      }, kind.section);
      assert.ok(fit.wide.every((d) => d <= 1), `${at}: no sideways scroll (${fit.wide})`);
      assert.deepEqual(fit.out, [], `${at}: nothing outside the screen`);
      const buttons = page.locator(`${kind.section} button:not([disabled])`);
      assert.ok(await buttons.count() >= 2, `${at}: the section has buttons to reach`);
      await buttons.first().focus();
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [document.activeElement.tagName, s.outlineStyle, s.outlineWidth, s.boxShadow]; });
      assert.ok(ring[1] !== 'none' && ring[2] !== '0px' || ring[3] !== 'none', `${at}: the focused ${ring[0]} shows a focus ring (${ring.slice(1)})`);
      assert.deepEqual(seen.errors, [], at);
      await context.close();
    }
  }
});
