import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { CURRENT, DECIDE, HISTORY, ROWS, SUMMARY, TABLE, actBody, appInfo, idle, lister, openApp, sent, serveDist, tracked, until, footerActions } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const CLOCK = new Date('2026-10-27T09:30:00Z');
const AS_OF = String((CLOCK.getTime() - 5000) * 1000);
const SHOTS = process.env.FX_BUSY_SHOTS || '';
const label = (n) => `Item number ${n} with a long descriptive name`;

function holder() {
  const writes = [];
  let next = null;
  return {
    writes,
    hold() { let open; const gate = new Promise((r) => { open = r; }); next = { gate, open }; return next; },
    async route(route, json, answer) {
      const body = actBody(route);
      writes.push(body);
      const mine = next;
      next = null;
      if (mine) await mine.gate;
      return answer(json, body, mine?.fail);
    },
  };
}

const written = (json, body, fail) => (fail ? json(fail.status, { error: fail.error })
  : json(200, { written: body.record_keys || [], conflicts: [], batch_id: `b${'0'.repeat(30)}${body.record_keys?.length || 0}` }));

function listRoutes(writes) {
  return tracked({
    records: lister(ROWS, { actions: true, changes: true, summary: SUMMARY, as_of_us: AS_OF }),
    'records/act': ({ route, json }) => writes.route(route, json, written),
    'records/history': ({ json, url }) => {
      const key = url.searchParams.get('record_key');
      const i = ROWS.findIndex((r) => r.record_key === key);
      const current = { ...CURRENT, ...ROWS[i], valid_from_us: String(200 + i), action_owner: null, action_status: 'New' };
      return json(200, { ...HISTORY, record_key: key, versions: [current], current });
    },
  }).routes;
}

async function openList(routes) {
  const opened = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes, clock: CLOCK, timezone: 'Asia/Dubai' });
  await opened.page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0 && document.querySelector('.list-tools'));
  return opened;
}

const spinnerWithin = (page, selector) => page.evaluate((sel) => new Promise((done) => {
  const button = document.querySelector(sel);
  const t0 = performance.now();
  button.click();
  button.click();
  const look = () => {
    const on = document.querySelector('[data-saving]');
    if (on && on.querySelector('.saving-ring') && /Saving…/.test(on.textContent)) done(performance.now() - t0);
    else if (performance.now() - t0 > 2000) done(Infinity);
    else requestAnimationFrame(look);
  };
  look();
}), selector);

const shot = async (page, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test('a drawer action shows Saving… with a spinner at once, locks the other writes and the record, says Still saving… after 10 s, and sends one write', async () => {
  const writes = holder();
  const { page, seen, context } = await openList(listRoutes(writes));
  const drawer = page.locator('dialog.drawer');
  await page.locator('.cell-t').first().click();
  await drawer.locator('.dr-act').waitFor();
  await footerActions(drawer);
  const hold = writes.hold();
  const ms = await spinnerWithin(page, 'dialog.drawer [data-act="done"]');
  assert.ok(ms < 100, `the spinner showed after ${ms} ms`);
  assert.equal(await drawer.locator('[data-saving]').innerText(), 'Saving…');
  assert.equal(await drawer.locator('[data-act="done"]').getAttribute('aria-busy'), 'true');
  for (const name of ['Could not fix', 'Snooze…', 'Save action', 'Add note']) {
    assert.equal(await drawer.getByRole('button', { name, exact: true }).isDisabled(), true, `${name} waits for the save`);
  }
  assert.equal(await drawer.getByRole('combobox', { name: 'Give to someone' }).isDisabled(), true);
  assert.equal(await drawer.locator('select[name="action_status"]').isDisabled(), true, 'the record form is locked while it saves');
  assert.equal(await drawer.locator('.panel-b').getAttribute('aria-busy'), 'true');
  await shot(page, 'drawer_saving');
  await page.keyboard.press('d');
  await page.clock.runFor(10500);
  await page.waitForFunction(() => document.querySelector('dialog.drawer [data-saving]')?.textContent === 'Still saving…');
  await shot(page, 'drawer_still_saving');
  assert.equal(writes.writes.length, 1, 'a double click and the d key while saving send no second write');
  hold.open();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Marked done. The next run checks whether it worked.');
  await page.waitForFunction(() => !document.querySelector('[data-saving]'));
  assert.equal(await drawer.getByRole('button', { name: 'Could not fix' }).isDisabled(), false);
  assert.equal(writes.writes.length, 1);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a bulk action locks its rows and the other writes, the list still pages while it saves, and a failure keeps the selection and the note', async () => {
  const writes = holder();
  const { page, seen, context } = await openList(listRoutes(writes));
  await page.getByRole('checkbox', { name: `Select ${label(1)}` }).check();
  await page.getByRole('checkbox', { name: `Select ${label(2)}` }).check();
  await page.getByRole('button', { name: 'Mark done…' }).click();
  await page.locator('textarea[name="bulk_note"]').fill('Closed with the supplier');
  const hold = writes.hold();
  hold.fail = { status: 500, error: 'The SQL warehouse did not answer in time' };
  const ms = await spinnerWithin(page, '.pop button[type="submit"]');
  assert.ok(ms < 100, `the spinner showed after ${ms} ms`);
  for (const name of ['Snooze…', 'Assign to…', 'Set status…', 'Not an issue…']) {
    assert.equal(await page.locator('.bulk').getByRole('button', { name, exact: true }).isDisabled(), true, `${name} waits for the save`);
  }
  assert.deepEqual(await page.locator('.card--table tbody tr.is-saving .cell-t b').allInnerTexts(), [label(1), label(2)], 'only the rows being saved are locked');
  assert.equal(await page.getByRole('checkbox', { name: `Select ${label(3)}` }).isDisabled(), true, 'no new pick while it saves');
  await shot(page, 'bulk_saving');
  const asked = seen.records.length;
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.waitForFunction((t) => [...document.querySelectorAll('.card--table tbody .cell-t b')].some((b) => b.textContent === t), label(26));
  assert.ok(seen.records.length > asked && seen.records.at(-1).offset === 25, 'the next page was read while the write was still open');
  assert.equal(writes.writes.length, 1);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await page.waitForFunction((t) => [...document.querySelectorAll('.card--table tbody .cell-t b')].some((b) => b.textContent === t), label(1));
  hold.open();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'The SQL warehouse did not answer in time');
  await page.waitForFunction(() => !document.querySelector('[data-saving]'));
  assert.equal(await page.locator('.bulk b').innerText(), '2 selected:', 'the selection survives the failure');
  if (!(await page.locator('textarea[name="bulk_note"]').count())) await page.getByRole('button', { name: 'Mark done…' }).click();
  assert.equal(await page.locator('textarea[name="bulk_note"]').inputValue(), 'Closed with the supplier', 'the note survives the failure');
  assert.equal(await page.locator('.card--table tbody tr.is-saving').count(), 0);
  await page.locator('.pop button[type="submit"]').click();
  await until(() => writes.writes.length === 2);
  assert.deepEqual(writes.writes[1].values, { action_status: 'Done', note: 'Closed with the supplier' });
  await page.locator('.bulk').waitFor({ state: 'detached' });
  assert.deepEqual(seen.errors.filter((e) => !/status of 500/.test(e)), []);
  await context.close();
});

test('pressing d twice on a row while its first save is open sends one write, and the row is locked until it lands', async () => {
  const writes = holder();
  const { page, seen, context } = await openList(listRoutes(writes));
  await page.locator('.card-h h2').first().click();
  await page.keyboard.press('j');
  const hold = writes.hold();
  await page.keyboard.press('d');
  await page.keyboard.press('d');
  await page.keyboard.press('s');
  await page.waitForFunction(() => document.querySelector('.card--table tbody tr.is-saving'));
  assert.equal(await page.locator('.card--table tbody tr.is-saving .cell-t b').innerText(), label(1));
  await sent(page);
  assert.equal(writes.writes.length, 1, 'the second d and the s while saving were not sent');
  hold.open();
  await page.waitForFunction(() => !document.querySelector('.card--table tbody tr.is-saving'));
  await idle(page);
  assert.equal(writes.writes.length, 1);
  await page.keyboard.press('s');
  await until(() => writes.writes.length === 2);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const TURN = {
  turn_id: 't1', state: 'done', answer: 'I can mark the two critical ones done.', steps: [], actions: [],
  confirm: { action: 'done', label: 'Mark done', route: 'records/act', values: { action_status: 'Done' },
    rows: [{ record_key: 'R001', label: 'Item 1' }, { record_key: 'R002', label: 'Item 2' }],
    body: { page: 'n01_u05', record_keys: ['R001', 'R002'], seen: { R001: '100', R002: '101' }, values: { action_status: 'Done' } } },
  genie: null, model: 'system.ai.claude-sonnet-4-6', refused: false, conversation_id: 'c1', error: '',
};

test('an Ask Genie confirmation shows Saving… at once, locks Cancel, keeps the card on a failure so Confirm can be pressed again, and saves once', async () => {
  const writes = holder();
  const { routes } = tracked({
    'records/act': ({ route, json }) => writes.route(route, json, written),
    'agent/status': ({ json }) => json(200, { mode: 'agent', note: '', page: 'n01_u05', genie: true, model: TURN.model }),
    'agent/ask': ({ json }) => json(200, { ...TURN, state: 'running', answer: '', confirm: null }),
    'agent/turn': ({ json }) => json(200, TURN),
  });
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ ...DECIDE }), { routes });
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your question' }).fill('Mark the critical ones done');
  await page.getByRole('button', { name: 'Send' }).click();
  const card = page.getByRole('group', { name: 'Mark done: 2 records' });
  await card.getByRole('button', { name: 'Confirm' }).waitFor();
  const hold = writes.hold();
  hold.fail = { status: 409, error: 'Someone changed this record since you loaded it' };
  const ms = await spinnerWithin(page, '.ag-confirm .ag-act .btn--pri');
  assert.ok(ms < 100, `the spinner showed after ${ms} ms`);
  assert.equal(await card.getByRole('button', { name: 'Cancel' }).isDisabled(), true);
  await shot(page, 'genie_confirm_saving');
  hold.open();
  await card.getByText('Someone changed this record since you loaded it').waitFor();
  assert.equal(await card.getByRole('button', { name: 'Confirm' }).isDisabled(), false, 'the person can confirm again after a failure');
  assert.equal(writes.writes.length, 1);
  await card.getByRole('button', { name: 'Confirm' }).click();
  await card.getByText('Saved 2 records.').waitFor();
  assert.equal(writes.writes.length, 2);
  assert.deepEqual(seen.errors.filter((e) => !/status of 409/.test(e)), []);
  await context.close();
});
