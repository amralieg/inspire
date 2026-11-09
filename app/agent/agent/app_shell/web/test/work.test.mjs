import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { actBody, appInfo, CURRENT, DECIDE, HISTORY, LABEL, lister, moved, openApp, OTHER, resizeTo, ROWS, sent, serveDist, SUMMARY, TABLE, tracked, until } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const CLOCK = new Date('2026-10-27T09:30:00Z');
const TOMORROW = '2026-10-28';
const toastText = (page) => page.evaluate(() => (document.querySelector('.toast.is-on .toast-t') || document.querySelector('.toast .toast-t'))?.textContent || '');
const toastButtons = (page) => page.locator('.toast .toast-a button').allInnerTexts();
const label = (n) => `Item number ${n} with a long descriptive name`;
const AS_OF = String((CLOCK.getTime() - 5000) * 1000);

function routesFor(reply, more = {}) {
  return tracked({
    records: lister(ROWS, { actions: true, changes: true, summary: SUMMARY, as_of_us: AS_OF }),
    'records/act': ({ route, json, seen }) => {
      const body = actBody(route);
      (seen.acts ||= []).push(body);
      return json(200, reply.act ? reply.act(body) : { written: body.record_keys || [], conflicts: [], batch_id: `b-${seen.acts.length}` });
    },
    'records/undo': ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      (seen.undos ||= []).push(body);
      return json(200, reply.undo || { restored: 1, skipped: 0, skipped_sample: [], batch_id: 'u-1', undoes: body.batch_id });
    },
    'records/history': ({ json, url }) => {
      const key = url.searchParams.get('record_key');
      const i = ROWS.findIndex((r) => r.record_key === key);
      const current = { ...CURRENT, ...ROWS[i], valid_from_us: String(200 + i), action_owner: null, action_status: 'New' };
      return json(200, { ...HISTORY, record_key: key, versions: [current], current });
    },
    ...more,
  });
}

async function openList(routes, info = appInfo(DECIDE, 1, TABLE)) {
  const opened = await openApp(browser, served.base, info, { routes, clock: CLOCK, timezone: 'Asia/Dubai', hash: '#/n01_u05/work' });
  await opened.page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0 && document.querySelector('.list-tools'));
  return opened;
}

test('Select all matching acts on every matching record with the load time and the list view, never a key list, and its Undo sends the batch id', async () => {
  const reply = {
    act: () => ({ written: 28, conflicts_count: 2, conflicts: [{ record_key: 'R004' }, { record_key: 'R009' }], batch_id: 'b-41' }),
    undo: { restored: 28, skipped: 1, skipped_sample: [{ record_key: 'R011', error: 'Someone changed this record' }], batch_id: 'u-41', undoes: 'b-41' },
  };
  const { routes } = routesFor(reply);
  const { page, seen, context } = await openList(routes);
  await page.getByRole('checkbox', { name: 'Select every record on this page' }).check();
  assert.equal(await page.locator('.bulk b').innerText(), '25 selected:');
  await page.getByRole('button', { name: 'Select all 30 matching' }).click();
  assert.equal(await page.locator('.bulk b').innerText(), 'All 30 matching records selected');
  assert.equal(await page.locator('.bulk-asof').innerText(), 'As of Oct 27, 2026, 09:29 AM UTC. A record that changes after that is left as it is.');
  const loaded = seen.records.at(-1);
  await page.getByRole('button', { name: 'Mark all done…' }).click();
  assert.equal(await page.locator('textarea[name="bulk_note"]').getAttribute('maxlength'), '500');
  await page.locator('textarea[name="bulk_note"]').fill('Closed the promo for all of them');
  await page.getByRole('button', { name: 'Mark 30 records done' }).click();
  await until(() => seen.acts?.length === 1);
  const act = seen.acts[0];
  assert.deepEqual(Object.keys(act).sort(), ['match', 'page', 'values'], 'a select-all act names no record_keys and no seen versions');
  assert.equal('record_keys' in act || 'seen' in act, false);
  assert.deepEqual(act.values, { action_status: 'Done', note: 'Closed the promo for all of them' });
  assert.deepEqual(act.match.filters, loaded.filters);
  assert.deepEqual(act.match.view, { ai: {}, search: '', mine: false, changed: false, window: 'all', time_zone: 'Asia/Dubai' }, 'the match carries the All open window the list read');
  assert.equal(act.match.as_of_us, AS_OF, 'the match is as of the moment the server read the list, never the browser clock');
  await page.waitForFunction(() => document.querySelector('.toast.is-on .toast-t'));
  assert.equal(await toastText(page), '28 records marked done. 2 records changed since you loaded them and were left as they are.');
  assert.deepEqual(await toastButtons(page), ['Undo']);
  assert.equal(await page.locator('.conflicts').innerText(),
    `2 records changed since you loaded them and were left as they are: ${label(4)}, ${label(9)}.`);
  await page.locator('.toast-a').getByRole('button', { name: 'Undo' }).click();
  await until(() => seen.undos?.length === 1);
  assert.deepEqual(seen.undos[0], { page: 'n01_u05', batch_id: 'b-41' });
  await page.waitForFunction(() => /^Undone/.test(document.querySelector('.toast .toast-t')?.textContent || ''));
  assert.equal(await toastText(page), `Undone: 28 records are back as they were. 1 record changed since and was left as it is: ${label(11)}.`);
  await page.locator('.conflicts').getByRole('button', { name: 'Close this notice' }).click();
  await page.locator('.conflicts').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.conflicts').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('every status takes a note, a dismissal still needs its reason, and Snooze sends a date from tomorrow on', async () => {
  const { routes } = routesFor({});
  const { page, seen, context } = await openList(routes);
  const pick = async () => {
    await page.getByRole('checkbox', { name: `Select ${label(1)}` }).check();
    await page.getByRole('checkbox', { name: `Select ${label(2)}` }).check();
  };
  await pick();
  await page.getByRole('button', { name: 'Set status…' }).click();
  await page.locator('select[name="bulk_choice"]').selectOption('In progress');
  await page.locator('textarea[name="bulk_note"]').fill('Called both stores');
  await page.getByRole('button', { name: 'Set status of 2 records' }).click();
  await until(() => seen.acts?.length === 1);
  assert.deepEqual(seen.acts[0], { page: 'n01_u05', record_keys: ['R001', 'R002'], seen: { R001: '100', R002: '101' },
    values: { action_status: 'In progress', note: 'Called both stores' } });
  await page.waitForFunction(() => !document.querySelector('.bulk'));
  await pick();
  await page.getByRole('button', { name: 'Set status…' }).click();
  await page.locator('select[name="bulk_choice"]').selectOption('Not an issue');
  assert.equal(await page.getByRole('button', { name: 'Set status of 2 records' }).isDisabled(), true, 'a dismissal still needs its reason');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Snooze…' }).click();
  const until_ = page.locator('input[name="bulk_snooze"]');
  assert.deepEqual([await until_.inputValue(), await until_.getAttribute('min')], [TOMORROW, TOMORROW]);
  await until_.fill('2026-10-27');
  assert.equal(await page.getByRole('button', { name: 'Snooze 2 records' }).isDisabled(), true, 'a snooze ends tomorrow at the earliest');
  await until_.fill('2026-11-03');
  await page.getByRole('button', { name: 'Snooze 2 records' }).click();
  await until(() => seen.acts?.length === 2);
  assert.deepEqual(seen.acts[1].values, { snooze_until: '2026-11-03' }, 'an empty note is not sent');
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === '2 records snoozed until Nov 3, 2026.');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const SIM_MATCH = (key) => ({ filters: { category: ['Books'], region: ['South'] }, view: { window: 'all', exclude: [key] }, as_of_us: '5555555555555555' });
const SIM_BY = [{ filter: 'category', label: 'Category', value: 'Books' }, { filter: 'region', label: 'Region', value: 'South' }];
const simRow = (i, extra = {}) => {
  const base = ROWS[i % ROWS.length];
  const key = i < ROWS.length ? base.record_key : `X${String(i).padStart(3, '0')}`;
  return { ...base, entity_id: key, record_key: key, _inspire_key: key, _inspire_version: String(300 + i), entity_label: base.entity_label, ...extra };
};
const simOf = (row) => ({ record_key: row.record_key, label: row.entity_label, valid_from_us: row._inspire_version, row });

async function openSimilar(found, reply = {}) {
  const asked = [];
  const { routes } = routesFor(reply, {
    'records/similar': ({ json, url }) => {
      asked.push(Object.fromEntries(url.searchParams));
      return json(200, { by: SIM_BY, ...found, match: SIM_MATCH(url.searchParams.get('record_key')) });
    },
  });
  const opened = await openList(routes, appInfo(DECIDE, 1, { ...TABLE, similar_by: ['category', 'region'] }));
  const { page, seen } = opened;
  await page.locator('.cell-t').first().click();
  await page.locator('dialog.drawer .dr-act').waitFor();
  await page.locator('dialog.drawer').getByRole('button', { name: 'Mark done' }).click();
  await until(() => seen.acts?.length === 1);
  await page.waitForFunction(() => [...document.querySelectorAll('.toast.is-on .toast-a button')].some((b) => /^Apply to \d+ similar$/.test(b.textContent)));
  await page.locator('.toast-a').getByRole('button', { name: /^Apply to \d+ similar$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply to similar records' });
  await dialog.waitFor();
  return { ...opened, asked, dialog };
}

const rowsIn = (dialog) => dialog.locator('.sim-l > li');
const keptText = (dialog) => dialog.locator('[data-kept]').innerText();
const applyButton = (dialog) => dialog.locator('footer button[type="submit"]');

test('Apply to similar lists every record the server found as a collapsed row with the Work list fields, expands one in place, and writes nothing before Apply', async () => {
  const records = Array.from({ length: 7 }, (_, i) => simOf(simRow(i + 2)));
  const { page, seen, context, asked, dialog } = await openSimilar({ count: 7, sample: records });
  assert.deepEqual(asked, [{ page: 'n01_u05', record_key: 'R001', by: 'category,region' }]);
  assert.equal(await dialog.locator('h2').innerText(), `Apply to 7 records like ${LABEL}?`);
  assert.match(await dialog.locator('header p').innerText(), /^These 7 open records share Category Books, Region South\. Nothing changes until you apply\.$/);
  assert.equal(await rowsIn(dialog).count(), 7, 'every record is listed, never five of them');
  assert.deepEqual(await dialog.locator('.sim-l .sim-n b').allInnerTexts(), records.map((r) => r.label));
  const first = rowsIn(dialog).first();
  const row = records[0].row;
  assert.equal(await first.locator('.sim-n small').innerText(), `${row.entity_id} · ${row.category}`, 'the key and segment line the Work list shows');
  assert.deepEqual(await first.locator('.sim-f > span').allInnerTexts(), [`Tier ${row.priority_tier}`, `Loss ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' }).format(row.value)}`]);
  assert.equal(await first.locator('.sim-x').count(), 0, 'every row starts collapsed');
  const toggle = first.getByRole('button', { name: new RegExp(`^${row.entity_label}`) });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  const region = first.getByRole('region', { name: `Details of ${row.entity_label}` });
  await region.waitFor();
  assert.equal(await toggle.getAttribute('aria-controls'), await region.getAttribute('id'));
  await page.waitForFunction(() => [...document.querySelectorAll('.sim-x .mgrid > div > span')].some((d) => d.textContent === 'Channel'));
  const shownFields = await region.locator('.mgrid > div > span').allInnerTexts();
  for (const name of ['Next best action', 'Channel', 'Region', 'Rank']) assert.ok(shownFields.includes(name), `the full record shows ${name}: ${shownFields}`);
  assert.equal(shownFields.includes('Loss'), false, 'what the collapsed line already shows is not repeated');
  assert.equal(await region.locator('.mgrid > div', { has: page.locator('span', { hasText: /^Channel$/ }) }).locator('b').innerText(), row.channel);
  await toggle.click();
  assert.equal(await first.locator('.sim-x').count(), 0, 'it collapses again');
  assert.equal(await keptText(dialog), '7 of 7 included');
  assert.equal(await applyButton(dialog).innerText(), 'Apply to 7 records');
  assert.equal(await dialog.locator('select[name="similar_choice"]').inputValue(), 'done', 'the dialog starts from what was just applied');
  await sent(page);
  assert.equal(seen.acts.length, 1, 'opening and expanding writes nothing');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await sent(page);
  assert.equal(seen.acts.length, 1, 'Cancel writes nothing');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a record left out of Apply to similar is never sent, the count and button follow every checkbox, and none included disables Apply', async () => {
  const records = Array.from({ length: 7 }, (_, i) => simOf(simRow(i + 2)));
  const out = records[2];
  const reply = { act: (body) => (body.similar ? { written: body.record_keys.slice(1), conflicts: [], conflicts_count: 0, left_out: 0, batch_id: 'b-9',
    changed: [body.record_keys[0]] } : { written: body.record_keys, conflicts: [], batch_id: 'b-1' }) };
  const { page, seen, context, dialog } = await openSimilar({ count: 7, sample: records }, reply);
  await dialog.getByRole('checkbox', { name: `Include ${out.label}` }).uncheck();
  assert.equal(await keptText(dialog), '6 of 7 included');
  assert.equal(await applyButton(dialog).innerText(), 'Apply to 6 records');
  assert.match(await rowsIn(dialog).nth(2).getAttribute('class'), /is-out/);
  await dialog.getByRole('button', { name: 'Select none' }).click();
  assert.equal(await keptText(dialog), '0 of 7 included');
  assert.equal(await applyButton(dialog).innerText(), 'Apply to 0 records');
  assert.equal(await applyButton(dialog).isDisabled(), true, 'nothing included, nothing to apply');
  assert.equal(await dialog.getByRole('button', { name: 'Select none' }).isDisabled(), true);
  await dialog.getByRole('button', { name: 'Select all' }).click();
  assert.equal(await keptText(dialog), '7 of 7 included');
  assert.equal(await dialog.getByRole('button', { name: 'Select all' }).isDisabled(), true);
  const box = dialog.getByRole('checkbox', { name: `Include ${out.label}` });
  await box.focus();
  await page.keyboard.press('Space');
  assert.equal(await box.isChecked(), false, 'Space leaves a record out from the keyboard');
  assert.equal(await keptText(dialog), '6 of 7 included');
  assert.equal(await dialog.locator('[data-kept]').getAttribute('role'), 'status', 'a screen reader hears the count change');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  assert.equal(await rowsIn(dialog).nth(2).locator('.sim-t').getAttribute('aria-expanded'), 'true', 'Tab reaches the row and Enter expands it');
  await dialog.locator('select[name="similar_choice"]').selectOption('could-not-fix');
  await dialog.locator('textarea[name="similar_note"]').fill('Same store, same supplier');
  await applyButton(dialog).click();
  await until(() => seen.acts?.length === 2);
  const applied = seen.acts[1];
  const kept = records.filter((r) => r !== out);
  assert.deepEqual(applied.record_keys, kept.map((r) => r.record_key), 'Apply sends exactly the records kept');
  assert.equal(applied.record_keys.includes(out.record_key), false, 'the record left out is never sent');
  assert.deepEqual(applied.seen, Object.fromEntries(kept.map((r) => [r.record_key, r.valid_from_us])), 'each with the version the person reviewed');
  assert.deepEqual(applied.similar, SIM_MATCH('R001'), 'with the records like this one the server found, never a fresh match');
  assert.equal('match' in applied, false, 'the server is never asked to work out records like this one again');
  assert.deepEqual(applied.values, { action_status: 'Could not fix', note: 'Same store, same supplier' });
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => /changed since you reviewed/.test(document.querySelector('.toast.is-on .toast-t')?.textContent || ''));
  assert.equal(await toastText(page), `5 records marked as could not fix. 1 record changed since you reviewed it and was left as it was: ${kept[0].label}.`);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('when every reviewed record changed meanwhile, Apply to similar says nothing was saved and names them', async () => {
  const records = Array.from({ length: 2 }, (_, i) => simOf(simRow(i + 2)));
  const { routes } = routesFor({}, {
    'records/similar': ({ json }) => json(200, { by: SIM_BY, count: 2, sample: records, match: SIM_MATCH('R001') }),
    'records/act': ({ route, json, seen }) => {
      const body = actBody(route);
      (seen.acts ||= []).push(body);
      if (!body.similar) return json(200, { written: body.record_keys, conflicts: [], batch_id: 'b-1' });
      return json(409, { error: '2 records changed since you reviewed them and were left as they were; nothing was saved', written: [], conflicts: [],
        conflicts_count: 0, left_out: 0, batch_id: null, changed: body.record_keys, code: 'stale_record' });
    },
  });
  const { page, seen, context } = await openList(routes, appInfo(DECIDE, 1, { ...TABLE, similar_by: ['category', 'region'] }));
  await page.locator('.cell-t').first().click();
  await page.locator('dialog.drawer .dr-act').waitFor();
  await page.locator('dialog.drawer').getByRole('button', { name: 'Mark done' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.toast.is-on .toast-a button')].some((b) => b.textContent === 'Apply to 2 similar'));
  await page.locator('.toast-a').getByRole('button', { name: 'Apply to 2 similar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply to similar records' });
  await applyButton(dialog).click();
  await until(() => seen.acts?.length === 2);
  await page.waitForFunction(() => /^Nothing was saved/.test(document.querySelector('.toast.is-on .toast-t')?.textContent || ''));
  assert.equal(await toastText(page), `Nothing was saved: 2 records changed since you reviewed them and were left as they were: ${records[0].label}, ${records[1].label}.`);
  assert.equal(await dialog.isVisible(), true, 'the dialog stays open so the person can review again');
  await context.close();
});

test('over 50 similar records show 50 with Show more, the rest stay included and counted, and a list the server capped says so', async () => {
  const records = Array.from({ length: 120 }, (_, i) => simOf(simRow(i + 40)));
  const { page, context, dialog } = await openSimilar({ count: 130, sample: records });
  assert.equal(await rowsIn(dialog).count(), 50);
  assert.equal(await keptText(dialog), '120 of 120 included', 'records not shown yet are still counted, never dropped silently');
  assert.equal(await dialog.locator('[data-capped]').innerText(),
    'The App lists 120 of the 130, the most one change covers. Apply changes only the listed ones you keep; open Apply to similar again for the rest.');
  const more = dialog.locator('.sim-more');
  assert.equal(await more.innerText(), 'Show 50 more (70 not shown yet)');
  await more.click();
  assert.equal(await rowsIn(dialog).count(), 100);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), `Include ${records[50].label}`, 'focus lands on the first record just shown');
  assert.equal(await more.innerText(), 'Show 20 more (20 not shown yet)');
  await more.click();
  assert.equal(await rowsIn(dialog).count(), 120);
  assert.equal(await dialog.locator('.sim-more').count(), 0);
  assert.equal(await applyButton(dialog).innerText(), 'Apply to 120 records');
  await context.close();
});

test('the similar records dialog fits at 1280 and 1440 with Arabic values that read right to left, and in a right-to-left page', async () => {
  const AR = 'منتج رقم';
  const records = Array.from({ length: 12 }, (_, i) => simOf(simRow(i + 2, { entity_label: `${AR} ${i + 1} ${'وصف طويل جدا '.repeat(i % 3 + 1)}`, category: 'كتب', priority_tier: 'تصرف الآن' })));
  for (const width of [1280, 1440]) {
    const { page, context, dialog } = await openSimilar({ count: 12, sample: records });
    await resizeTo(page, width);
    await rowsIn(dialog).first().locator('.sim-t').click();
    await dialog.locator('.sim-x').waitFor();
    for (const dir of ['ltr', 'rtl']) {
      await page.evaluate((d) => { document.documentElement.dir = d; }, dir);
      const fit = await page.evaluate(() => {
        const form = document.querySelector('dialog[open] form.dlg');
        const list = form.querySelector('.sim-l');
        const box = form.getBoundingClientRect();
        const outside = [...form.querySelectorAll('.sim-l li, .sim-l li *')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width && (r.left < box.left - 1 || r.right > box.right + 1);
        }).length;
        return { form: form.scrollWidth <= form.clientWidth, list: list.scrollWidth <= list.clientWidth, outside, inView: box.left >= 0 && box.right <= window.innerWidth,
          rtl: list.querySelector('.sim-n b bdi').matches(':dir(rtl)'), tier: list.querySelector('.sim-f bdi').matches(':dir(rtl)') };
      });
      assert.deepEqual(fit, { form: true, list: true, outside: 0, inView: true, rtl: true, tier: true }, `${width} ${dir}`);
    }
    await context.close();
  }
});

test('Recent changes lists each change newest first, and Undo on one says what it put back and what it left', async () => {
  const batches = [
    { batch_id: 'b-4', editor: OTHER, at: '2026-10-27T09:30:00Z', count: 3, values: { action_status: 'Done' }, undoes: null, note: '', undone: false, can_undo: false },
    { batch_id: 'b-3', editor: 'dana', at: '2026-10-27T09:20:00Z', count: 1, values: { action_status: 'New' }, undoes: 'b-0', note: '', undone: false, can_undo: true },
    { batch_id: 'b-2', editor: ['pat.lee', 'example.com'].join('@'), at: '2026-10-27T09:10:00Z', count: 30, values: { action_status: 'Done' }, undoes: null, note: 'Closed the promo', undone: false,
      can_undo: true },
    { batch_id: 'b-1', editor: OTHER, at: '2026-10-26T16:00:00Z', count: 2, values: { action_owner: OTHER }, undoes: null, note: '', undone: true, can_undo: true },
  ];
  const { routes } = routesFor({ undo: { restored: 29, skipped: 1, skipped_sample: [{ record_key: 'R003', error: 'changed' }], batch_id: 'u-2', undoes: 'b-2' } },
    { 'records/batches': ({ json }) => json(200, { batches, limit: 20 }) });
  const { page, seen, context } = await openList(routes);
  await page.getByRole('button', { name: 'Recent changes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recent changes' });
  await dialog.locator('.batches li').first().waitFor();
  assert.deepEqual(await dialog.locator('.batches li > span').allInnerTexts(), [
    `Oct 27, 2026, 09:30 AM UTC, ${OTHER}: 3 records marked done`,
    'Oct 27, 2026, 09:20 AM UTC, dana: undid an earlier change on 1 record',
    `Oct 27, 2026, 09:10 AM UTC, ${batches[2].editor}: 30 records marked done. Note: Closed the promo`,
    `Oct 26, 2026, 04:00 PM UTC, ${OTHER}: 2 records given to ${OTHER}`]);
  assert.equal(await dialog.locator('[data-batch="b-1"] button').count(), 0, 'an undone change offers no second Undo');
  assert.equal(await dialog.locator('[data-batch="b-3"] button').count(), 0, 'an undo is not undone from here');
  assert.equal(await dialog.locator('[data-batch="b-1"] small').innerText(), 'Undone');
  assert.equal(await dialog.locator('[data-batch="b-4"] button').count(), 0, 'someone else made it and the person owns no part of this use case');
  assert.equal(await dialog.locator('[data-batch="b-4"] [data-undo-theirs]').innerText(),
    'Only the person who made this change or an owner of this use case can undo it.');
  await dialog.locator('[data-batch="b-2"]').getByRole('button', { name: 'Undo' }).click();
  await until(() => seen.undos?.length === 1);
  assert.deepEqual(seen.undos[0], { page: 'n01_u05', batch_id: 'b-2' });
  await dialog.locator('[data-batch="b-2"] small[role="status"]').filter({ hasText: 'Undone:' }).waitFor();
  assert.equal(await dialog.locator('[data-batch="b-2"] small').innerText(), `Undone: 29 records are back as they were. 1 record changed since and was left as it is: ${label(3)}.`);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Start working shows one record at a time with k of N, Done and next and Snooze and next write, Skip does not, and the end says All caught up', async () => {
  const rows = ROWS.slice(0, 3);
  const { routes } = routesFor({}, { records: lister(rows, { actions: true, changes: true, summary: SUMMARY }) });
  const { page, seen, context } = await openList(routes);
  await page.getByRole('button', { name: 'Start working' }).click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.work-f').waitFor();
  const at = async (n) => {
    await page.waitForFunction((t) => document.querySelector('dialog.drawer[open] h2')?.textContent === t, label(n));
    return drawer.locator('[data-work-k]').innerText();
  };
  assert.equal(await at(1), '1 of 3 on this list');
  await drawer.getByRole('button', { name: 'Done and next' }).click();
  assert.equal(await at(2), '2 of 3 on this list');
  assert.deepEqual(seen.acts[0], { page: 'n01_u05', record_keys: ['R001'], seen: { R001: '200' }, values: { action_status: 'Done' } });
  await drawer.getByRole('button', { name: 'Skip' }).click();
  assert.equal(await at(3), '3 of 3 on this list');
  assert.equal(seen.acts.length, 1, 'Skip writes nothing');
  assert.equal(await drawer.locator('input[name="work_snooze"]').inputValue(), TOMORROW);
  await drawer.getByRole('button', { name: 'Snooze and next' }).click();
  const done = page.getByRole('dialog', { name: 'All caught up' });
  await done.waitFor();
  assert.deepEqual(seen.acts[1], { page: 'n01_u05', record_keys: ['R003'], seen: { R003: '202' }, values: { snooze_until: TOMORROW } });
  assert.equal(await done.locator('p').innerText(), 'You went through 3 records: 1 marked done, 1 snoozed and 1 skipped.');
  assert.equal(await page.locator('dialog.drawer[open]').count(), 0, 'the record panel closed at the end');
  assert.equal(await page.evaluate(() => document.querySelector('.toast.is-on .toast-t')?.textContent), '1 record snoozed until Oct 28, 2026.',
    'the Undo toast outlives the record panel it was shown in');
  assert.ok(await page.locator('.toast.is-on').isVisible());
  await done.getByRole('button', { name: 'Done' }).click();
  await done.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('dialog.drawer[open]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Undo toast in the record panel never covers the work buttons, the record title, its links or the count, on a phone, a laptop or a wide screen', async () => {
  const { routes } = routesFor({});
  for (const width of [390, 1024, 1440]) {
    const opened = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes, clock: CLOCK, timezone: 'Asia/Dubai', width, hash: '#/n01_u05/work' });
    const { page, seen, context } = opened;
    await page.waitForFunction(() => document.querySelector('[data-start-work]'));
    await page.locator('[data-start-work]').click();
    await page.locator('dialog.drawer .work-f').waitFor();
    await page.locator('dialog.drawer').getByRole('button', { name: 'Done and next' }).click();
    await page.waitForFunction(() => document.querySelector('.toast.is-on .toast-a button'));
    await moved(page);
    const hit = await page.evaluate(() => {
      const t = document.querySelector('.toast.is-on').getBoundingClientRect();
      return [...document.querySelectorAll('dialog.drawer .work-f button, dialog.drawer .work-f input, dialog.drawer .panel-h h2, dialog.drawer .panel-h button, dialog.drawer [data-work-k]')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.left < t.right && t.left < r.right && r.top < t.bottom && t.top < r.bottom;
      }).map((b) => b.textContent || b.name || b.getAttribute('aria-label'));
    });
    assert.deepEqual(hit, [], `at ${width}px the toast covers ${hit.join(', ')}`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('the keyboard moves through the list, opens, marks done, snoozes, selects and undoes, and does nothing while you type', async () => {
  const { routes } = routesFor({});
  const { page, seen, context } = await openList(routes);
  const cursor = () => page.evaluate(() => document.querySelector('.card--table tr.is-cursor .cell-t b')?.textContent || '');
  await page.locator('.card-h h2').first().click();
  await page.keyboard.press('j');
  assert.equal(await cursor(), label(1));
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  assert.equal(await cursor(), label(2));
  await page.keyboard.press('ArrowDown');
  assert.equal(await cursor(), label(3));
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('x');
  assert.equal(await page.locator('.bulk b').innerText(), '1 selected:');
  await page.keyboard.press('x');
  await page.locator('.bulk').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.bulk').count(), 0);
  await page.keyboard.press('d');
  await until(() => seen.acts?.length === 1);
  assert.deepEqual(seen.acts[0], { page: 'n01_u05', record_keys: ['R002'], seen: { R002: '101' }, values: { action_status: 'Done' } });
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === '1 record marked done.');
  await page.keyboard.press('u');
  await until(() => seen.undos?.length === 1);
  assert.deepEqual(seen.undos[0], { page: 'n01_u05', batch_id: 'b-1' });
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent !== '1 record marked done.');
  await page.keyboard.press('s');
  await until(() => seen.acts?.length === 2);
  assert.deepEqual(seen.acts[1].values, { snooze_until: TOMORROW });
  await page.keyboard.press('Enter');
  await page.waitForFunction((t) => document.querySelector('dialog.drawer[open] h2')?.textContent === t, label(2));
  await page.locator('dialog.drawer .dr-act').waitFor();
  await page.keyboard.press('j');
  await page.waitForFunction((t) => document.querySelector('dialog.drawer[open] h2')?.textContent === t, label(3));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.drawer[open]'));
  await page.keyboard.press('a');
  await page.waitForFunction(() => document.activeElement?.name === 'action_owner');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.drawer[open]'));
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Search the list');
  const acts = seen.acts.length;
  const undos = seen.undos.length;
  for (const key of ['d', 's', 'x', 'u', 'j', 'a', '?']) await page.keyboard.press(key);
  await sent(page);
  assert.equal(await page.getByLabel('Search the list').inputValue(), 'dsxuja?', 'every key went into the box');
  assert.deepEqual([seen.acts.length, seen.undos.length], [acts, undos], 'no shortcut fired while typing');
  assert.equal(await page.locator('.bulk').count(), 0);
  assert.equal(await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count(), 0);
  await page.getByLabel('Search the list').fill('');
  await page.locator('.card-h h2').first().click();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await help.waitFor();
  assert.equal(await help.locator('.keys > div').count(), 11);
  assert.match(await help.innerText(), /never while you type in a box/);
  await page.keyboard.press('Escape');
  await help.waitFor({ state: 'hidden' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});
