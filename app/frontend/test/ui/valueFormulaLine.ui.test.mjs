// REQ-476, REQ-475 (formula visual): every ON driver shows a live formula line built from its own inputs, in the dialog and on the Save
// page; an invalid input shows "—" (never the old amount) and names the input; hours that make the task longer say so in words; help shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { PLAN, mountWizard, openCard, openWizard, goTo } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const est = (id, label, kind, def, help) => ({ id, label, kind, source: 'estimate', default: def, why: '', help });
const dat = (id, label, kind, help) => ({ id, label, kind, source: 'data', metric: 'records', help });
const TIME_HELP = 'Hours of work the use case takes off each time the task is done, for example 1.5 hours saved per case.';
const plan = (hours) => ({ ...PLAN, groups: [{ g: 'All', records_per_year: 8352, metrics: {} }], grouping: 'region',
  drivers: [{ id: 'time_saved', label: 'Time saved', verb: 'REDUCE COST', on: true, why: 'Fewer hours.', asks: [
    dat('events_per_year', 'Times the task is done per year', 'count', 'How many times a year this task is done across the business.'),
    est('people', 'People who work on it each time', 'count', 1, 'How many people work on the task each time.'),
    ...hours,
    est('cost_per_hour', 'Cost of one hour of work', 'money', 104, 'What one hour of a person\'s time costs the business.')] }] });
const SAVED = plan([est('hours_saved', 'Hours saved each time', 'hours', 1.8, TIME_HELP)]);
const LEGACY = plan([est('hours_before', 'Hours per case today', 'hours', 1, 'Hours today.'), est('hours_after', 'Hours per case with the use case', 'hours', 2, 'Hours with it.')]);

// A preview that really multiplies; cost above 1000 is refused the way the server refuses a bad number.
const previewOf = (previews) => (app) => app.post('/api/inspire/value/preview', (req, res) => {
  previews.push(req.body);
  const i = req.body.answers.drivers.time_saved.inputs;
  if (Number(i.cost_per_hour) > 1000) return res.status(400).json({ error: 'Time saved: "Cost of one hour of work" is too high to be an hourly cost.' });
  const hours = i.hours_saved ?? Math.max(0, i.hours_before - i.hours_after);
  const amount = 8352 * i.people * hours * i.cost_per_hour;
  const ins = Object.entries(i).map(([id, value]) => ({ id, value }));
  return res.json({ yearly: { verb: 'REDUCE COST', period: 'Per Year', currency: 'USD', total: { unit: 'USD', amount }, estimated: true, calculated: false,
    parts: [{ id: 'time_saved', label: 'Time saved', amount, inputs: [{ id: 'events_per_year', value: 8352 }, ...ins] }], case_noun: 'record', attribution_pct: 100 } });
});
const mount = (planReply, previews) => (app) => { previewOf(previews)(app); mountWizard({ planReply: { plan: planReply } })(app); };

test('F1: the time saved page shows the live formula line from its own inputs, with a money amount', async () => {
  const { ui, card, page } = await openCard(mount(SAVED, []));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:time_saved');
    const line = dialog.locator('[data-formula-line]');
    await line.waitFor({ timeout: 15000 });
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => /=\s*\$1\.\d+M a year/.test(document.querySelector('[data-formula-line]')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await text(line), /^8,352 times a year × 1 person × 1\.8 hours saved × \$104 an hour = \$1\.\d+M a year$/);
  } finally { await ui.close(); }
});

test('F2: changing the cost of an hour changes the line and the amount together', async () => {
  const { ui, card, page } = await openCard(mount(SAVED, []));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:time_saved');
    await page.waitForFunction(() => /=\s*\$1\.\d+M a year/.test(document.querySelector('[data-formula-line]')?.textContent || ''), null, { timeout: 15000 });
    const before = await text(dialog.locator('[data-kind-amount]'));
    await dialog.locator('[data-ask="cost_per_hour"] input[type=number]').fill('50');
    await page.waitForFunction(() => /\$50 an hour/.test(document.querySelector('[data-formula-line]')?.textContent || ''), null, { timeout: 15000 });
    await page.waitForFunction((b) => document.querySelector('[data-kind-amount]')?.textContent !== b, before, { timeout: 15000 });
    assert.match(await text(dialog.locator('[data-formula-line]')), /\$50 an hour = \$751\.\d+K a year$/);
  } finally { await ui.close(); }
});

test('F3: an invalid input shows "—" for the amount and the line, never the old amount, and names the input', async () => {
  const { ui, card, page } = await openCard(mount(SAVED, []));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:time_saved');
    await page.waitForFunction(() => /=\s*\$1\.\d+M a year/.test(document.querySelector('[data-formula-line]')?.textContent || ''), null, { timeout: 15000 });
    await dialog.locator('[data-ask="cost_per_hour"] input[type=number]').fill('5000');
    await dialog.getByRole('alert').filter({ hasText: 'Cost of one hour of work' }).waitFor({ timeout: 15000 });
    assert.doesNotMatch(await text(dialog.locator('[data-kind-amount]')), /\$1\.\d+M/);
    assert.match(await text(dialog.locator('[data-kind-amount]')), /—/);
    assert.match(await text(dialog.locator('[data-formula-line]')), /= —/);
    assert.doesNotMatch(await text(dialog.locator('[data-run-total]')), /\$1\.\d+M/, 'the running total is not stale either');
  } finally { await ui.close(); }
});

test('F4: hours today below hours with the use case says "takes longer" in words, not a silent 0', async () => {
  const { ui, card, page } = await openCard(mount(LEGACY, []));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:time_saved');
    const line = dialog.locator('[data-formula-line]');
    await line.waitFor({ timeout: 15000 });
    assert.match(await text(line), /takes longer than today, so no time is saved/);
    assert.doesNotMatch(await text(line), /0 hours saved/);
  } finally { await ui.close(); }
});

test('F5: each input shows its business-words help, and a data input shows its help too', async () => {
  const { ui, card, page } = await openCard(mount(SAVED, []));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:time_saved');
    assert.match(await text(dialog.locator('[data-ask="hours_saved"]')), /Hours of work the use case takes off each time/);
    assert.match(await text(dialog.locator('[data-ask="events_per_year"]')), /How many times a year this task is done/);
  } finally { await ui.close(); }
});

test('F6: the Save page editor shows the same formula line for the opened driver', async () => {
  const { ui, card, page } = await openCard(mount(SAVED, []));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'save');
    await dialog.getByRole('button', { name: 'Edit numbers' }).first().click();
    await dialog.locator('[data-editor="time_saved"] [data-formula-line]').waitFor({ timeout: 15000 });
    assert.match(await text(dialog.locator('[data-editor="time_saved"] [data-formula-line]')), /1\.8 hours saved × \$104 an hour/);
  } finally { await ui.close(); }
});
