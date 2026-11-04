import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DECIDE, SRC, appInfo, bundleEntry, openApp, openBundle, serveDist } from './harness.mjs';
import { AS_OF, CASES, MEMBERS, kindRoutes, statusOf } from './exampleRoutes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KINDS = JSON.parse(readFileSync(join(HERE, '..', '..', 'kinds.json'), 'utf8'));
const ASSETS = join(HERE, '..', 'dist', 'assets');
const P = { ink: '#111', muted: '#666', line: '#ddd', card: '#fff', well: '#eee', font: 'Inter', series: ['#1', '#2', '#3', '#4', '#5', '#6'], tier: { 'Act now': '#c00' } };

let served;
let base;
let browser;
let parts;

before(async () => {
  served = await serveDist();
  base = served.base;
  browser = await chromium.launch();
  parts = await bundleEntry(`import * as charts from ${JSON.stringify(join(SRC, 'charts.js'))};\n`
    + `import * as kinds from ${JSON.stringify(join(SRC, 'KindParts.jsx'))};\nwindow.charts = charts;\nwindow.kinds = kinds;`);
});

after(async () => {
  await browser?.close();
  served?.close();
});

async function inBundle(run, arg) {
  const { page, context, errors } = await openBundle(browser, parts, {});
  const out = await page.evaluate(run, arg);
  await context.close();
  assert.deepEqual(errors, []);
  return out;
}

const layoutOf = (id) => KINDS.layouts.find((l) => l.id === id);

const itemsIn = (page, section) => page.locator(`[data-section="${section}"]`).evaluateAll((nodes) => nodes.reduce((sum, n) => {
  const rows = n.querySelectorAll('[data-choice-row]').length;
  const cards = n.querySelectorAll('[data-segment], [data-card^="effect:"]').length;
  return sum + (rows || cards || (n.querySelector('canvas, table, .kpi') ? 1 : 0));
}, 0));
const listAsked = (page, test) => page.waitForRequest((r) => new URL(r.url()).pathname.endsWith('/api/records') && test(r.postDataJSON() || {}));
const pageAsked = (page, wanted = () => true) => page.waitForRequest((r) => new URL(r.url()).pathname.endsWith('/api/page') && wanted(r.postDataJSON()))
  .then((r) => r.postDataJSON());
const sectionsOf = (page) => page.evaluate(() => [...document.querySelectorAll('[data-section]')].map((n) => n.dataset.section));

const exampleOf = (id) => JSON.parse(readFileSync(join(HERE, '..', '..', 'examples', `${id}.json`), 'utf8'));

async function open(id, acts = [], rows = CASES[id].rows.map((r) => ({ ...r })), unread = false) {
  const info = appInfo(DECIDE, 1, {}, `examples/${id}.json`);
  const opened = await openApp(browser, base, info, { routes: kindRoutes(CASES[id].data(), rows, acts, exampleOf(id), {}, unread) });
  await opened.page.locator(CASES[id].ready).first().waitFor();
  return { ...opened, info, rows };
}

for (const id of Object.keys(CASES)) {
  test(`the ${id} layout is served, opens with What to do now and draws every section in order with its minimum items`, async () => {
    const layout = layoutOf(id);
    assert.equal(layout.enabled, true);
    const { page, seen, context, info } = await open(id);
    assert.deepEqual(info.pages[0].layout.sections, layout.sections);
    await page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3);
    const order = await sectionsOf(page);
    assert.equal(order[0], 'todo', 'every page opens with What to do now');
    assert.deepEqual([...new Set(order)], layout.sections);
    for (const [section, low] of Object.entries(layout.min_items)) {
      const n = await itemsIn(page, section);
      assert.ok(n >= low, `${section} holds ${n}, needs ${low}`);
    }
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}

test('a segment treatment is chosen once and reaches every member still without one, keeping the decisions already made on single members', async () => {
  const acts = [];
  const { page, seen, context } = await open('segment_explorer', acts);
  const card = page.locator('[data-segment="S2"]');
  await card.locator('[data-seg-open]').filter({ hasText: '2 of 380 members still need a treatment' }).waitFor();
  assert.equal(await page.locator('[data-segment="S1"] [data-seg-open]').innerText(), '3 of 420 members still need a treatment');
  const star = card.locator('[data-treatment="Win-back offer"]');
  assert.equal(await star.textContent(), '★ Win-back offer');
  assert.match(await star.getAttribute('class'), /btn--pri/);
  await card.locator('[data-treatment="Leave as is"]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Leave as is chosen for 2 members of Lapsing families');
  assert.deepEqual(acts[0], { page: 'n04_u01', match: { filters: { segment: ['S2'] }, view: { column_filters: { action_status: ['New'] } }, as_of_us: AS_OF },
    treatment: 'Leave as is', values: { action_status: 'In progress', note: 'Treatment: Leave as is' } });
  assert.match(await card.locator('[data-decided]').innerText(), /Treatment: Leave as is/);
  await page.locator('[data-take-all]').click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-segment] [data-decided]').length === n, 4);
  assert.deepEqual(acts.slice(1).map((a) => [a.match.filters.segment[0], a.values.note]),
    [['S1', 'Treatment: Loyalty upgrade'], ['S3', 'Treatment: Leave as is'], ['S4', 'Treatment: Win-back offer']]);
  assert.equal(await page.locator('[data-section="segment_cards"] .card--table').count() > 0, true, 'the members list sits under the segment cards');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('after a reload each segment card shows the treatments its members got, counted by the server from the recorded decisions', async () => {
  const rows = MEMBERS.map((r) => ({ ...r }));
  rows.filter((r) => r.segment === 'S2' && statusOf(r) === 'New').forEach((r) => Object.assign(r, { _inspire_status: 'In progress', _treatment: 'Win-back offer' }));
  rows.filter((r) => r.segment === 'S1').slice(0, 1).forEach((r) => Object.assign(r, { _inspire_status: 'In progress', _treatment: 'Loyalty upgrade', _inspire_closed_note: 'Treatment: Win-back offer' }));
  const { page, seen, context } = await open('segment_explorer', [], rows);
  await page.locator('[data-segment="S2"] [data-treated]').first().waitFor();
  assert.equal(await page.locator('[data-segment="S2"] [data-treated]').innerText(), 'Treatment: Win-back offer, 2 members');
  assert.equal(await page.locator('[data-segment="S1"] [data-treated]').innerText(), 'Treatment: Loyalty upgrade, 1 member');
  assert.equal(await page.locator('[data-segment="S3"] [data-treated], [data-segment="S4"] [data-treated]').count(), 0);
  assert.equal(await page.locator('[data-segment="S2"] [data-seg-open]').innerText(), 'Every member has a treatment or a decision');
  assert.equal(await page.locator('[data-chosen]').count(), 0, 'nothing was chosen in this visit, the counts come from the recorded decisions');
  assert.ok(seen.records.some((b) => b.treatments === true && !b.filters?.segment), 'one page-wide request asks for the treatment counts');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a treatment count that cannot be read says so on each card and the card still takes a treatment', async () => {
  const acts = [];
  const { page, seen, context } = await open('segment_explorer', acts, undefined, true);
  const card = page.locator('[data-segment="S2"]');
  await card.locator('[data-treated-unread]').waitFor();
  assert.equal(await card.locator('[data-treated-unread]').innerText(), 'The treatment counts could not be read. Reload the page to see them.');
  assert.equal(await page.locator('[data-treated-unread]').count(), 4);
  assert.equal(await card.locator('[data-seg-open]').innerText(), '2 of 380 members still need a treatment');
  await card.locator('[data-treatment="Win-back offer"]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Win-back offer chosen for 2 members of Lapsing families');
  assert.deepEqual([acts.length, acts[0].treatment, acts[0].match.filters.segment], [1, 'Win-back offer', ['S2']]);
  assert.match(await card.locator('[data-chosen]').innerText(), /Treatment: Win-back offer/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a picked segment keeps every other card in view, dimmed and clickable, and a treatment reaches only the members of its own card', async () => {
  const acts = [];
  const { page, seen, context, rows } = await open('segment_explorer', acts);
  const asked = pageAsked(page);
  await page.locator('[data-segment="S2"] [data-pick="S2"]').click();
  assert.deepEqual((await asked).filters.segment, ['S2']);
  await page.waitForFunction(() => document.querySelector('[data-segment="S2"]')?.classList.contains('is-picked'));
  assert.equal(await page.locator('.seg-card').count(), 4, 'picking a segment never hides the other segments');
  assert.deepEqual(await page.locator('.seg-card.is-dimmed').evaluateAll((n) => n.map((c) => c.dataset.segment)), ['S1', 'S3', 'S4']);
  const before = rows.map((r) => [r.record_key, statusOf(r), r._treatment]);
  await page.locator('[data-segment="S2"] [data-treatment="Win-back offer"]').click();
  await page.locator('[data-segment="S2"] [data-treated="Win-back offer"]').waitFor();
  const changedKeys = (from) => rows.filter((r, i) => statusOf(r) !== from[i][1] || r._treatment !== from[i][2]).map((r) => r.record_key);
  const s2 = changedKeys(before);
  assert.deepEqual(s2.sort(), MEMBERS.filter((r) => r.segment === 'S2' && statusOf(r) === 'New').map((r) => r.record_key).sort());
  assert.ok(rows.filter((r) => s2.includes(r.record_key)).every((r) => r.segment === 'S2' && r._treatment === 'Win-back offer'));
  const middle = rows.map((r) => [r.record_key, statusOf(r), r._treatment]);
  await page.locator('[data-segment="S1"] [data-treatment="Loyalty upgrade"]').click();
  await page.locator('[data-segment="S1"] [data-treated="Loyalty upgrade"]').waitFor();
  const s1 = changedKeys(middle);
  assert.ok(s1.length === 3 && rows.filter((r) => s1.includes(r.record_key)).every((r) => r.segment === 'S1'), `a dimmed card treats only its own members: ${s1}`);
  assert.deepEqual(acts.map((a) => [a.match.filters.segment, a.treatment]), [[['S2'], 'Win-back offer'], [['S1'], 'Loyalty upgrade']]);
  assert.ok(rows.filter((r) => r.segment !== 'S1' && r.segment !== 'S2').every((r) => !r._treatment), 'no treatment reached another segment');
  const added = pageAsked(page, (body) => (body.filters?.segment || []).includes('S3'));
  await page.locator('[data-segment="S3"] [data-pick="S3"]').click();
  assert.deepEqual([...(await added).filters.segment].sort(), ['S2', 'S3'], 'a dimmed card is still a pick');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('picking a segment card shows that segment: the page filters to it, the card stays marked and a second pick shows every segment again', async () => {
  const { page, seen, context } = await open('segment_explorer');
  const title = page.locator('[data-segment="S2"] [data-pick="S2"]');
  assert.equal(await title.getAttribute('aria-pressed'), 'false');
  const asked = pageAsked(page);
  const members = listAsked(page, (b) => b.filters?.segment?.[0] === 'S2' && !b.column_filters);
  await title.click();
  assert.deepEqual((await asked).filters.segment, ['S2']);
  assert.deepEqual((await members).postDataJSON().filters.segment, ['S2'], 'the members list asks for the picked segment only');
  await page.waitForFunction(() => document.querySelector('[data-segment="S2"]')?.classList.contains('is-picked'));
  assert.equal(await title.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.seg-card.is-picked').count(), 1);
  const again = pageAsked(page);
  await title.click();
  assert.deepEqual((await again).filters.segment || [], []);
  await page.waitForFunction(() => !document.querySelector('.seg-card.is-picked'));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the recommendation desk groups the top offers per entity with reasons, sends one and records why another was skipped', async () => {
  const acts = [];
  const { page, seen, context } = await open('recommendation_desk', acts);
  assert.equal(await page.locator('[data-rec-entity]').count(), 8);
  const ana = page.locator('[data-rec-entity="Ana"]');
  assert.equal(await ana.locator('[data-choice-row]').count(), 3);
  assert.match(await ana.locator('.reasons').first().innerText(), /bought travel before/);
  const first = ana.locator('[data-choice-row="K1"]');
  assert.equal(await first.locator('[data-choice="send"]').textContent(), '★ Send');
  await first.locator('[data-choice="send"]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Send: Travel card');
  assert.deepEqual(acts[0], { page: 'n04_u02', record_keys: ['K1'], seen: { K1: '701' }, values: { action_status: 'Done', note: 'Send' } });
  const third = ana.locator('[data-choice-row="K3"]');
  assert.equal(await third.locator('[data-choice="skip"]').textContent(), '★ Skip');
  await third.locator('[data-choice="skip"]').click();
  assert.equal(acts.length, 1, 'a skip waits for its reason');
  await third.getByRole('button', { name: 'Bad timing' }).click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Skip: Phone upgrade');
  assert.deepEqual(acts[1], { page: 'n04_u02', record_keys: ['K3'], seen: { K3: '703' }, values: { action_status: 'Dismissed', dismiss_reason: 'Skip: Bad timing' } });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the recommendation desk looks a customer up by name and shows every customer again when the lookup is cleared', async () => {
  const { page, seen, context } = await open('recommendation_desk');
  await page.locator('[data-rec-search]').fill('bo');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-rec-entity]').length === 1);
  assert.equal(await page.locator('[data-rec-entity]').getAttribute('data-rec-entity'), 'Bo');
  assert.equal(seen.records.at(-1).search, 'bo');
  await page.locator('[data-rec-search]').fill('nobody');
  await page.locator('[data-rec-search]').press('Enter');
  await page.locator('[data-part="rec_list"] .empty').filter({ hasText: 'Nothing matches nobody.' }).waitFor();
  await page.getByRole('button', { name: 'Show all' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-rec-entity]').length === 8);
  assert.equal(seen.records.at(-1).search, undefined);
  assert.equal(await page.locator('[data-rec-search]').inputValue(), '');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the lift readout marks each effect real, losing or unproven and decides scale, keep, change or stop with the ★ from the action', async () => {
  const acts = [];
  const { page, seen, context } = await open('lift_readout', acts);
  assert.equal(await page.locator('[data-card="effect:Spring bundle"] [data-verdict]').getAttribute('data-verdict'), 'real');
  assert.equal(await page.locator('[data-card="effect:Flash sale"] [data-verdict]').getAttribute('data-verdict'), 'unproven');
  assert.equal(await page.locator('[data-card="effect:Free delivery"] [data-verdict]').getAttribute('data-verdict'), 'loses');
  assert.match(await page.locator('[data-card="effect:Free delivery"]').getAttribute('class'), /\bis-loses\b/);
  assert.match(await page.locator('[data-card="effect:Free delivery"] [data-verdict]').innerText(), /^It loses: the whole range is below no lift, p = 0\.010$/);
  assert.match(await page.locator('[data-card="effect:Spring bundle"]').innerText(), /12\.0%[\s\S]*Range 5\.0% to 19\.0%[\s\S]*The lift is real: p = 0\.004/);
  const stars = await page.locator('[data-choice-row] .btn--pri').evaluateAll((b) => b.map((n) => n.dataset.choice));
  assert.deepEqual(stars, ['scale', 'keep', 'change', 'stop']);
  await page.locator('[data-choice-row="K4"] [data-choice="stop"]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Stop: Flash sale');
  assert.deepEqual(acts[0].values, { action_status: 'Done', note: 'Stop' });
  await page.locator('[data-take-all]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Stop on 1 ★ suggestion');
  assert.deepEqual(acts.slice(1).map((a) => [a.values.action_status, a.values.note, a.record_keys]), [
    ['Done', 'Scale: the ★ suggestion', ['K1']], ['Done', 'Keep: the ★ suggestion', ['K2']], ['In progress', 'Change: the ★ suggestion', ['K3']],
    ['Done', 'Stop: the ★ suggestion', ['K4']]]);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('picking an effect card filters the page to that promotion through the promotion filter, so its waterfall, curves and decision follow', async () => {
  const { page, seen, context } = await open('lift_readout');
  const asked = pageAsked(page);
  const decisions = listAsked(page, (b) => b.filters?.promotion?.[0] === 'Spring bundle');
  await page.locator('[data-card="effect:Spring bundle"] [data-pick="Spring bundle"]').click();
  assert.deepEqual((await asked).filters.promotion, ['Spring bundle']);
  assert.ok(await decisions, 'the keep, scale or stop list follows the pick');
  await page.waitForFunction(() => document.querySelector('[data-card="effect:Spring bundle"]')?.classList.contains('is-picked'));
  assert.equal(await page.locator('[data-card="effect:Spring bundle"] [data-pick]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.locator('[data-card^="effect:"]').evaluateAll((n) => n.map((c) => [c.dataset.card, c.classList.contains('is-dimmed')])),
    [['effect:Spring bundle', false], ['effect:Flash sale', true], ['effect:Free delivery', true]], 'picking a promotion keeps every effect card in view');
  const added = pageAsked(page);
  await page.locator('[data-card="effect:Flash sale"] [data-pick="Flash sale"]').click();
  assert.deepEqual([...(await added).filters.promotion].sort(), ['Flash sale', 'Spring bundle'], 'a dimmed effect card is still a pick');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the choice helpers pick the earliest named choice, map a skip to a dismissal with its reason, and judge an effect by p and range', async () => {
  const got = await inBundle(({ choices }) => {
    const { suggestedChoice, choiceValues, treatmentValues, treatedBySegment, groupByEntity, effectVerdict, pickedIn, pickState } = window.kinds;
    return {
      scale: suggestedChoice(choices, 'Scale it, do not stop')?.id,
      stop: suggestedChoice(choices, 'stop it, then scale later')?.id,
      none: suggestedChoice(choices, 'review with finance'),
      empty: suggestedChoice(choices, ''),
      skip: choiceValues({ id: 'skip', label: 'Skip', status: 'Dismissed' }, 'Bad timing'),
      send: choiceValues({ id: 'send', label: 'Send', status: 'Done' }),
      treat: treatmentValues('Win-back offer'),
      treated: treatedBySegment([{ segment: 'S1', treatment: 'Win back', n: 2 }, { segment: 1, treatment: 'Leave', n: '3' }, { segment: 'S1', treatment: 'Leave', n: 1 },
        { segment: null, treatment: 'Win back', n: 9 }, { segment: 'S2', treatment: '', n: 4 }, null]),
      none_treated: treatedBySegment(null),
      grouped: groupByEntity([{ e: 'A', r: 3 }, { e: 'A', r: 1 }, { e: 'B', r: 2 }, { e: 'A', r: 2 }], 'e', 'r', 2).map(([n, items]) => [n, items.map((i) => i.r)]),
      real: effectVerdict({ p_value: 0.01, lower: 0.02, upper: 0.1 }).real,
      crosses: effectVerdict({ p_value: 0.01, lower: -0.02, upper: 0.1 }).real,
      weak: effectVerdict({ p_value: 0.2, lower: 0.02, upper: 0.1 }).real,
      missing: effectVerdict({ lower: 0.02, upper: 0.1 }).real,
      states: [
        { p_value: 0.01, lower: 0.02, upper: 0.1 }, { p_value: 0.01, lower: -0.3, upper: -0.1 }, { p_value: 0.3, lower: -0.3, upper: -0.1 },
        { p_value: 0.01, lower: -0.1, upper: 0 }, { p_value: 0.01, effect: -0.2 }, { p_value: 0.01, effect: 0.2 }, { p_value: 0.3, effect: -0.2 },
      ].map((r) => effectVerdict(r).state),
      picked: [pickedIn({ segment: ['S1', 'S2'] }, 'segment', 'S2'), pickedIn({ segment: ['S1'] }, 'segment', 'S2'), pickedIn({}, 'segment', 'S1'),
        pickedIn({ segment: [3] }, 'segment', '3'), pickedIn({ segment: ['S1'] }, null, 'S1')],
      states_of_picks: [pickState({ segment: ['S2'] }, 'segment', 'S2'), pickState({ segment: ['S2'] }, 'segment', 'S1'), pickState({}, 'segment', 'S1'),
        pickState({ segment: [] }, 'segment', 'S1'), pickState({ segment: ['S1'] }, undefined, 'S1'), pickState({ region: ['N'] }, 'segment', 'S1')],
    };
  }, { choices: layoutOf('lift_readout').choices });
  assert.deepEqual(got, {
    scale: 'scale', stop: 'stop', none: null, empty: null,
    skip: { action_status: 'Dismissed', dismiss_reason: 'Skip: Bad timing' }, send: { action_status: 'Done', note: 'Send' },
    treat: { action_status: 'In progress', note: 'Treatment: Win-back offer' },
    treated: { S1: [{ treatment: 'Win back', n: 2 }, { treatment: 'Leave', n: 1 }], 1: [{ treatment: 'Leave', n: 3 }] }, none_treated: {},
    grouped: [['A', [1, 2]], ['B', [2]]], real: true, crosses: false, weak: false, missing: false,
    states: ['real', 'loses', 'loses', 'unproven', 'loses', 'real', 'unproven'],
    picked: [true, false, false, true, false],
    states_of_picks: [' is-picked', ' is-dimmed', '', '', '', ''],
  });
});

test('the treemap sizes by the first measure and shades by the second, the radar scales each trait to its peak, and the sankey keeps the two sides apart', async () => {
  const got = await inBundle(({ P }) => {
    const { chartOption } = window.charts;
    const money = { label: 'Value', format: 'currency', currency: 'USD' };
    const tree = chartOption({ type: 'treemap', x: { kind: 'category' }, y: [{ label: 'Customers', format: 'integer' }, money] },
      [{ x: 'Big', y0: 400, y1: 900 }, { x: 'Small', y0: 50, y1: 100 }, { x: 'Gone', y0: -5, y1: 500 }], P);
    const radar = chartOption({ type: 'radar', x: { kind: 'category' }, series: { column: 's', top: 5 }, y: [{ label: 'Score', format: 'number' }] },
      [{ x: 'Orders', s: 'A', y0: 10 }, { x: 'Orders', s: 'B', y0: 5 }, { x: 'Basket', s: 'A', y0: 2 }, { x: 'Basket', s: 'B', y0: 8 }], P);
    const sankey = chartOption({ type: 'sankey', x: { kind: 'category' }, series: { column: 's', top: 8 }, y: [{ label: 'Customers', format: 'integer' }] },
      [{ x: 'Loyal', s: 'Lapsing', y0: 40 }, { x: 'Lapsing', s: 'Loyal', y0: 10 }, { x: 'Loyal', s: 'Loyal', y0: 0 }], P);
    const t = tree.series[0].data;
    const r = radar.series[0].data;
    const s = sankey.series[0];
    return {
      tree: t.map((d) => [d.name, d.value, d.itemStyle.color]),
      radar: { axes: radar.radar.indicator.map((i) => i.name), lines: r.map((d) => [d.name, d.value]) },
      sankey: { nodes: s.data.map((d) => d.name), links: s.links.map((l) => [l.source, l.target, l.value]), label: s.label.formatter({ name: 'before|Loyal' }),
        animation: s.animation },
    };
  }, { P });
  assert.deepEqual(got.tree, [['Big', 400, '#6'], ['Small', 50, '#1'], ['Gone', 0, '#3']]);
  assert.deepEqual(got.radar, { axes: ['Orders', 'Basket'], lines: [['B', [0.5, 1]], ['A', [1, 0.25]]] });
  assert.deepEqual(got.sankey, { nodes: ['before|Loyal', 'now|Lapsing', 'before|Lapsing', 'now|Loyal'],
    links: [['before|Loyal', 'now|Lapsing', 40], ['before|Lapsing', 'now|Loyal', 10]], label: 'Loyal', animation: false });
});

test('the treemap, radar and sankey modules load only in the lazy layout chart chunk, never in the main bundle', () => {
  const main = readFileSync(join(ASSETS, 'app.js'), 'utf8');
  const lazy = readFileSync(join(ASSETS, 'echartsKinds.js'), 'utf8');
  for (const kind of ['treemap', 'radar', 'sankey']) {
    assert.ok(!main.includes(`series.${kind}`), `${kind} stays out of the main bundle`);
    assert.ok(lazy.includes(`series.${kind}`), `the layout chart chunk registers ${kind}`);
  }
});
