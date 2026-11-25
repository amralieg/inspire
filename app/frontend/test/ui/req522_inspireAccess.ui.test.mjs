// REQ-522 (UI): a run reads as Inspire's service principal, so the Start picker shows, per catalog, schema and table, whether you and
// Inspire can read it (inspire_readable beside REQ-521's readable), and Request Access asks for each one that is missing it.
// Spec: ~/claude/inspire/briefs/req522_spec.md. The routes are mounted here, so this does not wait on the backend brief.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { splitTechnical } from '../../src/lib/plainText.js';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const SHOW = 'Show everything';
const REQUEST = 'Request Access';
const STATE = {};
const GRANT = 'GRANT SELECT ON CATALOG `ops` TO `11111111-2222-4333-8444-555555555555`';

// main: both read. ops: you read, Inspire cannot. dim: you read, Inspire unknown. hr: only Inspire reads. vault: neither.
function world({ answer } = {}) {
  const seen = { lists: [], sent: [] };
  const all = (req) => {
    seen.lists.push(req.originalUrl);
    return req.query.include_unreadable === '1';
  };
  const row = (base, readable, inspire, showAll) => ({ ...base, ...(showAll ? { readable } : {}), inspire_readable: inspire });
  const mount = (app) => {
    app.get('/api/catalogs', (req, res) => {
      const a = all(req);
      res.json({ catalogs: [
        row({ name: 'dim' }, true, null, a),
        ...(a ? [row({ name: 'hr' }, false, true, a)] : []),
        row({ name: 'main' }, true, true, a),
        row({ name: 'ops' }, true, false, a),
        ...(a ? [row({ name: 'vault' }, false, false, a)] : []),
      ], truncated: false });
    });
    app.get('/api/catalogs/:catalog/schemas', (req, res) => {
      const a = all(req);
      const c = req.params.catalog;
      const schemas = c === 'main' ? [row({ name: 's', full_name: 'main.s' }, true, true, a)]
        : c === 'ops' ? [row({ name: 'granted', full_name: 'ops.granted' }, true, true, a)] : [];
      res.json({ schemas });
    });
    app.get('/api/tables/:catalog/:schema', (req, res) => {
      const a = all(req);
      const scope = `${req.params.catalog}.${req.params.schema}`;
      const tables = scope === 'main.s' ? [
        row({ name: 'orders', full_name: 'main.s.orders', schema_name: 's', pickable: true }, true, true, a),
        row({ name: 'noapp', full_name: 'main.s.noapp', schema_name: 's', pickable: false, request: 'inspire' }, true, false, a),
      ] : scope === 'ops.granted' ? [row({ name: 'facts', full_name: 'ops.granted.facts', schema_name: 'granted', pickable: true }, true, true, a)] : [];
      res.json({ tables, count: tables.length, metric_views: [] });
    });
    app.post('/api/access-request', (req, res) => {
      seen.sent.push(req.body);
      const objects = Array.isArray(req.body?.objects) ? req.body.objects : [];
      const results = objects.flatMap((o) => (o.need || ['person']).map((who) => (answer ? answer(o, who)
        : { type: o.type, full_name: o.full_name, for: who, sent: true, destinations: ['owners@example.com'], reason: '' })));
      res.json({ sent: results.some((r) => r.sent), destinations: [], reason: '', links: [], results });
    });
  };
  return { seen, mount };
}

const showEverything = (page) => page.getByRole('checkbox', { name: SHOW, exact: true });
const requestBox = (page, name) => page.getByRole('checkbox', { name: `Request access to ${name}`, exact: true });
const need = (page, name) => page.locator(`[data-access-need="${name}"]`);
const line = (page, name, who) => page.locator(`[data-access-request-object="${name}"][data-access-request-for="${who}"]`);

async function open(w) {
  const ui = await openUi('launch', STATE, '', { mount: w.mount });
  await ui.page.getByPlaceholder(BUSINESS).fill('Acme');
  return ui;
}

test('REQ-522: by default a catalog you can read but Inspire cannot says "Inspire needs access" and has a request box; pickable and unknown rows do not', async () => {
  const w = world();
  const ui = await open(w);
  const { page } = ui;
  try {
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    await idle(page);
    assert.equal(await need(page, 'ops').count(), 1, 'REQ-522: Not implemented: a catalog Inspire cannot read carries no "Inspire needs access" marker');
    assert.equal((await need(page, 'ops').innerText()).trim(), 'Inspire needs access');
    assert.equal(await requestBox(page, 'ops').count(), 1, 'the person can ask for Inspire');
    for (const name of ['main', 'dim']) {
      assert.equal(await need(page, name).count(), 0, `${name}: no marker (pickable, or not checked)`);
      assert.equal(await requestBox(page, name).count(), 0, `${name}: no request box`);
    }
    assert.equal(await page.locator('button[title="hr"]').count() + await requestBox(page, 'hr').count(), 0, 'what you cannot read stays hidden by default');
  } finally {
    await ui.close();
  }
});

test('REQ-522: Show everything names who needs access; one Request Access press asks for you and for Inspire and shows a line per principal', async () => {
  const w = world();
  const ui = await open(w);
  const { page } = ui;
  try {
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    await showEverything(page).check();
    await requestBox(page, 'vault').waitFor({ timeout: 15000 });
    assert.equal(await need(page, 'hr').count(), 1, 'REQ-522: Not implemented: rows carry no access marker');
    assert.equal((await need(page, 'hr').innerText()).trim(), 'You need access');
    assert.equal((await need(page, 'vault').innerText()).trim(), 'You and Inspire need access');
    assert.equal((await need(page, 'ops').innerText()).trim(), 'Inspire needs access');
    await requestBox(page, 'hr').check();
    await requestBox(page, 'ops').check();
    await requestBox(page, 'vault').check();
    await page.getByRole('button', { name: REQUEST, exact: true }).click();
    await until(() => w.seen.sent.length === 1, 'one request');
    assert.deepEqual(w.seen.sent[0], { objects: [
      { type: 'CATALOG', full_name: 'hr' },
      { type: 'CATALOG', full_name: 'ops', need: ['inspire'] },
      { type: 'CATALOG', full_name: 'vault', need: ['person', 'inspire'] },
    ] }, 'need is sent only when Inspire needs access; a person-only object keeps the REQ-521 body');
    await line(page, 'vault', 'inspire').waitFor({ timeout: 15000 });
    assert.equal((await line(page, 'hr', 'person').innerText()).trim(), 'hr: Request sent to owners@example.com');
    assert.equal((await line(page, 'ops', 'inspire').innerText()).trim(), 'ops: Request for Inspire sent to owners@example.com');
    assert.equal((await line(page, 'vault', 'person').innerText()).trim(), 'vault: Request sent to owners@example.com');
    assert.equal((await line(page, 'vault', 'inspire').innerText()).trim(), 'vault: Request for Inspire sent to owners@example.com');
    for (const name of ['hr', 'ops', 'vault']) assert.equal(await requestBox(page, name).isChecked(), false, `${name}: sent, so unpicked`);
  } finally {
    await ui.close();
  }
});

test('REQ-522: a catalog or table Inspire cannot read is never a run source; the catalog still opens so a schema Inspire can read is picked', async () => {
  const w = world();
  const ui = await open(w);
  const { page, made } = ui;
  try {
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    await idle(page);
    assert.equal(await need(page, 'ops').count(), 1, 'REQ-522: Not implemented: no "Inspire needs access" marker on ops');
    await page.locator('button[title="ops"]').click();
    await page.locator('button[title="granted"]').waitFor({ timeout: 15000 });
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await requestBox(page, 'main.s.noapp').waitFor({ timeout: 15000 });
    assert.equal((await need(page, 'main.s.noapp').innerText()).trim(), 'Inspire needs access');
    await page.locator('button[title="orders"]').click();
    await idle(page);
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.locator('[data-launch-run-unsaved]').click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['01_uc_metadata'], 'main.s.orders', 'neither ops (whole) nor main.s.noapp is a run source');
  } finally {
    await ui.close();
  }
});

test('REQ-522: an Inspire request that could not be sent shows its reason and the grant to copy, and stays picked', async () => {
  const reason = 'Inspire could not find its own account in this workspace, so ask the data owner to run the grant below';
  const w = world({ answer: (o, who) => ({ type: o.type, full_name: o.full_name, for: who, sent: false, destinations: [], reason, statements: [GRANT] }) });
  const ui = await open(w);
  const { page } = ui;
  try {
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    await idle(page);
    assert.equal(await requestBox(page, 'ops').count(), 1, 'REQ-522: Not implemented: no request box for a catalog Inspire cannot read');
    await requestBox(page, 'ops').check();
    await page.getByRole('button', { name: REQUEST, exact: true }).click();
    await line(page, 'ops', 'inspire').waitFor({ timeout: 15000 });
    assert.equal((await line(page, 'ops', 'inspire').innerText()).trim(), `ops: Request for Inspire not sent: ${reason}`);
    const copy = page.locator('[data-access-request-copy="ops"]');
    assert.ok((await copy.innerText()).includes(GRANT), 'the grant is there to copy');
    assert.equal(await copy.getByRole('button', { name: 'Copy', exact: true }).count(), 1);
    assert.equal(await requestBox(page, 'ops').isChecked(), true, 'not sent, so still picked');
  } finally {
    await ui.close();
  }
});

test('REQ-522: when the request never reaches Inspire, the person reads a plain sentence, never the browser error, and keeps the picks', async () => {
  const w = world();
  const ui = await open(w);
  const { page } = ui;
  try {
    await page.route('**/api/access-request', (route) => route.abort('failed'));
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    await showEverything(page).check();
    await requestBox(page, 'hr').check();
    await page.getByRole('button', { name: REQUEST, exact: true }).click();
    const expected = `No request was sent: ${splitTechnical('Failed to fetch').plain}`;
    await page.getByText(expected, { exact: true }).waitFor({ timeout: 15000 }).catch(() => {});
    const body = await page.locator('body').innerText();
    assert.equal(body.includes('Failed to fetch'), false, 'REQ-522: Not implemented: the raw browser error reaches the person');
    assert.equal(await page.getByText(expected, { exact: true }).count(), 1, `the plain sentence: ${expected}`);
    assert.equal(await requestBox(page, 'hr').isChecked(), true, 'nothing was sent, so the pick stays');
  } finally {
    await ui.close();
  }
});

test('REQ-522 must-keep: when Inspire reads everything you read, the picker and the run are as before, with no marker or request box', async () => {
  const w = world();
  const ui = await open(w);
  const { page, made } = ui;
  try {
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').waitFor({ timeout: 15000 });
    await page.locator('button[title="orders"]').click();
    await idle(page);
    assert.equal(await need(page, 'main').count() + await need(page, 'main.s').count() + await need(page, 'main.s.orders').count(), 0);
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.locator('[data-launch-run-unsaved]').click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['01_uc_metadata'], 'main.s.orders');
    assert.equal(w.seen.sent.length, 0, 'no access request is sent');
  } finally {
    await ui.close();
  }
});
