// FX-96 (REQ-492, REQ-495): the value dialog draws each formula as boxes joined by signs into a result box, charts the parts of the yearly total,
// and asks how confident the user is in the value (REQ-507: a Low/Medium/High question on the Ramp and cost step).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { PLAN, mountWizard, openCard, openWizard, goTo } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const est = (id, label, kind, def) => ({ id, label, kind, source: 'estimate', default: def, why: '', help: 'Help.' });
const dat = (id, label, kind) => ({ id, label, kind, source: 'data', metric: 'records', help: 'Help.' });
const PLAN4 = { ...PLAN, groups: [{ g: 'All', records_per_year: 8352, metrics: {} }], grouping: 'region',
  drivers: [{ id: 'time_saved', label: 'Time saved', verb: 'REDUCE COST', on: true, why: 'Fewer hours.', asks: [
    dat('events_per_year', 'Times the task is done per year', 'count'), est('people', 'People who work on it each time', 'count', 1),
    est('hours_saved', 'Hours saved each time', 'hours', 1.8), est('cost_per_hour', 'Cost of one hour of work', 'money', 104)] }] };
const mount = (app) => {
  app.post('/api/inspire/value/preview', (req, res) => {
    const i = req.body.answers.drivers.time_saved.inputs;
    const amount = 8352 * i.people * i.hours_saved * i.cost_per_hour;
    res.json({ yearly: { verb: 'REDUCE COST', period: 'Per Year', currency: 'USD', total: { unit: 'USD', amount }, estimated: true, calculated: false,
      parts: [{ id: 'time_saved', label: 'Time saved', amount, inputs: [{ id: 'events_per_year', value: 8352 }, ...Object.entries(i).map(([id, value]) => ({ id, value }))] }], case_noun: 'record', attribution_pct: 100 } });
  });
  mountWizard({ planReply: { plan: PLAN4 } })(app);
};
const ready = (page) => page.waitForFunction(() => /\$\d/.test(document.querySelector('[data-kind-amount]')?.textContent || ''), null, { timeout: 15000 });

test('V1 (REQ-492): one box per input, signs between them, and a result box equal to the shown amount; moving an input moves the result', async () => {
  const { ui, card, page } = await openCard(mount);
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:time_saved');
    const diagram = dialog.locator('[data-formula-diagram]');
    await diagram.waitFor({ timeout: 15000 });
    await ready(page);
    assert.equal(await diagram.locator('[data-diagram-input]').count(), 4);
    assert.equal(await diagram.locator('[data-diagram-op]').count(), 4, 'three signs between four boxes, one equals sign');
    const result = await text(diagram.locator('[data-diagram-result]'));
    assert.ok(result.includes((await text(dialog.locator('[data-kind-amount]'))).replace(' per year', '')), `result ${result} is the shown amount`);
    await dialog.locator('[data-ask="cost_per_hour"] input[type=number]').fill('50');
    await page.waitForFunction((b) => document.querySelector('[data-diagram-result]')?.textContent !== b, result, { timeout: 15000 });
    await ready(page);
    assert.match(await text(diagram.locator('[data-diagram-input]').nth(3)), /\$50/);
    assert.ok((await text(diagram.locator('[data-diagram-result]'))).includes((await text(dialog.locator('[data-kind-amount]'))).replace(' per year', '')));
  } finally { await ui.close(); }
});

test('V2 (REQ-495): the chart has one bar per part of the yearly total, and the confidence is a Low/Medium/High question with no meter', async () => {
  const { ui, card, page } = await openCard(mountWizard());
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:time_saved');
    const chart = dialog.locator('[data-value-chart]');
    await chart.waitFor({ timeout: 15000 });
    await chart.locator('[data-chart-bar]').first().waitFor({ timeout: 15000 });
    assert.equal(await chart.locator('[data-chart-bar]').count(), 3, 'three kinds are on');
    assert.equal(await dialog.locator('[data-confidence-meter]').count(), 0, 'the confidence is no longer a meter');
    await goTo(dialog, 'economics:cost');
    const confidence = dialog.getByRole('radiogroup', { name: 'How confident are you in this value?' });
    assert.match(await text(confidence), /How confident are you in this value\?.*Low.*Medium.*High/);
    assert.equal(await confidence.getByRole('radio').count(), 3);
    await confidence.getByRole('radio', { name: 'High' }).check();
    assert.equal(await confidence.getByRole('radio', { name: 'High' }).isChecked(), true);
    assert.equal(await dialog.locator('[role="meter"]').count(), 0);
  } finally { await ui.close(); }
});

for (const [w, h] of [[1280, 800], [1440, 900]]) {
  test(`V3: nothing overflows the dialog at ${w} px`, async () => {
    const { ui, card, page } = await openCard(mount);
    try {
      await page.setViewportSize({ width: w, height: h });
      const dialog = await openWizard(page, card);
      await goTo(dialog, 'driver:time_saved');
      await dialog.locator('[data-formula-diagram]').waitFor({ timeout: 15000 });
      await dialog.locator('[data-value-chart]').waitFor({ timeout: 15000 });
      await ready(page);
      const bad = await dialog.evaluate((root) => {
        const box = root.getBoundingClientRect();
        const out = [];
        for (const el of root.querySelectorAll('[data-formula-diagram], [data-diagram-input], [data-diagram-result], [data-value-chart], [data-chart-bar], [data-confidence-meter]')) {
          const r = el.getBoundingClientRect();
          if (r.right > box.right + 0.5 || r.left < box.left - 0.5) out.push(el.getAttribute('data-diagram-input') ?? el.tagName);
          if (el.scrollWidth > el.clientWidth + 1) out.push(`scroll:${el.tagName}`);
        }
        return { out, scroll: root.scrollWidth - root.clientWidth };
      });
      assert.deepEqual(bad.out, []);
      assert.ok(bad.scroll <= 1, 'the dialog does not scroll sideways');
    } finally { await ui.close(); }
  });
}
