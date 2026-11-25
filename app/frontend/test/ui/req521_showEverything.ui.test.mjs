// REQ-521 Part B (UI): the Start picker shows what the person can read; "Show everything" (unticked by default) adds what they cannot
// read, each with a "Request access to <name>" box; picking any shows "Request Access" at the top of the picker, which sends one request
// for every picked object and shows the result per object. An unreadable object is never a run source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const SHOW = 'Show everything';
const REQUEST = 'Request Access';
const NOTHING_READABLE = 'You can read no catalog yet. Tick Show everything to ask for access.';
const STATE = {};

// The contract of /api/catalogs, /api/catalogs/:c/schemas and /api/tables/:c/:s with include_unreadable=1 (backend test req521_listing_rfa).
function world({ readable = true, answer } = {}) {
  const seen = { lists: [], sent: [] };
  const wanted = (req) => {
    seen.lists.push(req.originalUrl);
    return req.query.include_unreadable === '1';
  };
  const mount = (app) => {
    app.get('/api/catalogs', (req, res) => {
      const all = wanted(req);
      res.json({ catalogs: [
        ...(all ? [{ name: 'hr', readable: false }] : []),
        ...(readable ? [{ name: 'main', ...(all ? { readable: true } : {}) }] : []),
      ], truncated: false });
    });
    app.get('/api/catalogs/:catalog/schemas', (req, res) => {
      const all = wanted(req);
      const c = req.params.catalog;
      res.json({ schemas: c !== 'main' ? [] : [
        { name: 's', full_name: 'main.s', ...(all ? { readable: true } : {}) },
        ...(all ? [{ name: 'secret', full_name: 'main.secret', readable: false }] : []),
      ] });
    });
    app.get('/api/tables/:catalog/:schema', (req, res) => {
      const all = wanted(req);
      const scope = `${req.params.catalog}.${req.params.schema}`;
      const tables = scope !== 'main.s' ? [] : [
        { name: 'orders', full_name: 'main.s.orders', schema_name: 's', ...(all ? { readable: true } : {}) },
        ...(all ? [{ name: 'salaries', full_name: 'main.s.salaries', schema_name: 's', readable: false }] : []),
      ];
      res.json({ tables, count: tables.length, metric_views: [] });
    });
    app.post('/api/access-request', (req, res) => {
      seen.sent.push(req.body);
      const objects = Array.isArray(req.body?.objects) ? req.body.objects : [];
      const results = objects.map((o) => (answer ? answer(o) : { ...o, sent: true, destinations: ['owners@example.com'], reason: '' }));
      res.json({ sent: results.some((r) => r.sent), destinations: [], reason: '', links: [], results });
    });
  };
  return { seen, mount };
}

const showEverything = (page) => page.getByRole('checkbox', { name: SHOW, exact: true });
const requestBox = (page, name) => page.getByRole('checkbox', { name: `Request access to ${name}`, exact: true });

async function open(w) {
  const ui = await openUi('launch', STATE, '', { mount: w.mount });
  await ui.page.getByPlaceholder(BUSINESS).fill('Acme');
  return ui;
}

test('REQ-521: the picker has a "Show everything" box, unticked by default, and lists only readable objects until it is ticked', async () => {
  const w = world();
  const ui = await open(w);
  const { page } = ui;
  try {
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    assert.equal(await showEverything(page).count(), 1, `REQ-521: Not implemented: no "${SHOW}" checkbox on the Start page`);
    assert.equal(await showEverything(page).isChecked(), false, 'unticked by default');
    assert.equal(await page.locator('button[title="hr"]').count(), 0, 'an unreadable catalog is not listed by default');
    assert.ok(w.seen.lists.every((u) => !u.includes('include_unreadable')), `the default lists never ask for unreadable objects: ${w.seen.lists}`);
    await showEverything(page).check();
    await requestBox(page, 'hr').waitFor({ timeout: 15000 });
    assert.ok(w.seen.lists.some((u) => u.startsWith('/api/catalogs?') && /include_unreadable=1/.test(u)), `ticked, the catalog list asks for unreadable ones: ${w.seen.lists}`);
    assert.equal(await page.getByRole('button', { name: REQUEST, exact: true }).count(), 0, 'no Request Access button until an object is picked');
    await showEverything(page).uncheck();
    await idle(page);
    assert.equal(await requestBox(page, 'hr').count(), 0, 'unticked again, the unreadable rows are hidden');
  } finally {
    await ui.close();
  }
});

test('REQ-521: picking an unreadable catalog shows Request Access above the columns; pressing it sends the object and shows the result', async () => {
  const w = world();
  const ui = await open(w);
  const { page } = ui;
  try {
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    assert.equal(await showEverything(page).count(), 1, `REQ-521: Not implemented: no "${SHOW}" checkbox`);
    await showEverything(page).check();
    await requestBox(page, 'hr').check();
    const button = page.getByRole('button', { name: REQUEST, exact: true });
    await button.waitFor({ timeout: 15000 });
    const heading = page.getByText('Catalogs', { exact: true }).first();
    assert.ok((await button.boundingBox()).y < (await heading.boundingBox()).y, 'the button sits at the top of the picker, above the columns');
    await button.click();
    await until(() => w.seen.sent.length === 1, 'one request is sent');
    assert.deepEqual(w.seen.sent[0], { objects: [{ type: 'CATALOG', full_name: 'hr' }] }, 'the body names the object only; the server knows who asks');
    const result = page.locator('[data-access-request-object="hr"]');
    await result.waitFor({ timeout: 15000 });
    assert.equal((await result.innerText()).trim(), 'hr: Request sent to owners@example.com');
    assert.equal(await requestBox(page, 'hr').isChecked(), false, 'a sent object is unpicked');
  } finally {
    await ui.close();
  }
});

test('REQ-521: schemas and tables can be requested together; a refused one stays picked with its reason, and neither is ever a run source', async () => {
  const w = world({ answer: (o) => (o.full_name === 'main.s.salaries'
    ? { ...o, sent: false, destinations: [], reason: 'no one has set up where access requests for these go yet' }
    : { ...o, sent: true, destinations: ['data-team@example.com'], reason: '' }) });
  const ui = await open(w);
  const { page, made } = ui;
  try {
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    assert.equal(await showEverything(page).count(), 1, `REQ-521: Not implemented: no "${SHOW}" checkbox`);
    await showEverything(page).check();
    await page.locator('button[title="main"]').click();
    await requestBox(page, 'main.secret').check();
    await page.locator('button[title="s"]').click();
    await requestBox(page, 'main.s.salaries').check();
    await page.locator('button[title="orders"]').click();
    await page.getByRole('button', { name: REQUEST, exact: true }).click();
    await until(() => w.seen.sent.length === 1, 'one request for both objects');
    assert.deepEqual(w.seen.sent[0].objects, [{ type: 'SCHEMA', full_name: 'main.secret' }, { type: 'TABLE', full_name: 'main.s.salaries' }]);
    await page.locator('[data-access-request-object="main.s.salaries"]').waitFor({ timeout: 15000 });
    assert.equal((await page.locator('[data-access-request-object="main.secret"]').innerText()).trim(), 'main.secret: Request sent to data-team@example.com');
    assert.equal((await page.locator('[data-access-request-object="main.s.salaries"]').innerText()).trim(),
      'main.s.salaries: Not sent: no one has set up where access requests for these go yet');
    assert.equal(await requestBox(page, 'main.s.salaries').isChecked(), true, 'a refused object stays picked so it can be sent again');
    assert.equal(await requestBox(page, 'main.secret').isChecked(), false);
    await idle(page);
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.locator('[data-launch-run-unsaved]').click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['01_uc_metadata'], 'main.s.orders', 'only the readable pick is a run source');
  } finally {
    await ui.close();
  }
});

test('REQ-521: a person who can read no catalog is told to tick Show everything', async () => {
  const w = world({ readable: false });
  const ui = await open(w);
  const { page } = ui;
  try {
    await idle(page);
    await page.getByText(NOTHING_READABLE, { exact: true }).waitFor({ timeout: 15000 }).catch(() => {});
    assert.equal(await page.getByText(NOTHING_READABLE, { exact: true }).count(), 1, `REQ-521: Not implemented: the empty list does not say "${NOTHING_READABLE}"`);
    await showEverything(page).check();
    await requestBox(page, 'hr').waitFor({ timeout: 15000 });
  } finally {
    await ui.close();
  }
});

test('REQ-521 must-keep: with the box unticked, a readable table is picked and run exactly as before, with no request control shown', async () => {
  const w = world();
  const ui = await open(w);
  const { page, made } = ui;
  try {
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').waitFor({ timeout: 15000 });
    await page.locator('button[title="orders"]').click();
    await idle(page);
    assert.equal(await page.getByRole('checkbox', { name: /^Request access to / }).count(), 0, 'no request box for readable objects');
    assert.equal(await page.getByRole('button', { name: REQUEST, exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.locator('[data-launch-run-unsaved]').click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['01_uc_metadata'], 'main.s.orders');
    assert.equal(w.seen.sent.length, 0, 'no access request is sent');
  } finally {
    await ui.close();
  }
});
