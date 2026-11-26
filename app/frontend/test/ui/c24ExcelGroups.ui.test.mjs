// C24 (REQ-503 part, REQ-465): the Excel step groups its columns (group tick: all / some / none, column ticks under it), the xlsx has only the
// ticked columns, and the ID cell of each row links to that use case in the App (#/review/<run>/<id>, the link the App already opens).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';
import { EXCEL_COLUMNS, EXCEL_GROUPS, defaultDocOptions } from '../../src/lib/docgen/docOptions.js';
import { buildDocModel } from '../../src/lib/docgen/docModel.js';
import { buildXlsx } from '../../src/lib/docgen/xlsxDoc.js';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const readXlsx = require('read-excel-file/node');

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED, output_language: 'English' } : s));
const PICKED = ['Predict churn', 'Score upsell'];

function backend() {
  const calls = { saves: [] };
  const mount = (app) => {
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
    app.post('/api/inspire/docs/save', (req, res) => {
      calls.saves.push(req.body);
      res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 });
    });
    app.get('/api/workspace/list', (_req, res) => res.json({ files: [] }));
  };
  return { calls, mount };
}
const currentPage = (dialog) => dialog.locator('[data-docs-page]:visible').first().getAttribute('data-docs-page');
const next = (dialog) => dialog.getByRole('button', { name: /^Next/ }).click();
const checked = (loc) => loc.getAttribute('aria-checked');
async function openColumns(mount) {
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS }, '', { mount });
  await ui.page.setViewportSize({ width: 1440, height: 900 });
  await ui.page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
  for (const n of PICKED) await ui.page.getByRole('checkbox', { name: `Select ${n}`, exact: true }).check();
  await ui.page.locator('[data-value-bulk-bar]').getByRole('button', { name: /Generate docs/ }).click();
  const dialog = ui.page.getByRole('dialog', { name: /Generate documents/ });
  await dialog.waitFor();
  for (let i = 0; i < 6 && (await currentPage(dialog)) !== 'columns'; i += 1) await next(dialog);
  return { ui, dialog };
}
const sheetXml = async (b64) => {
  const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
  return zip.file('xl/worksheets/sheet1.xml').async('string');
};

test('groups: every Excel column is in exactly one of at least 3 groups', () => {
  assert.ok(EXCEL_GROUPS.length >= 3);
  const all = EXCEL_GROUPS.flatMap((g) => g.columns);
  assert.deepEqual([...all].sort(), EXCEL_COLUMNS.map((c) => c.id).sort());
  assert.equal(new Set(all).size, all.length);
});

test('(a)(b) the Excel step shows group ticks with their column ticks; the group tick is all / some / none', async () => {
  const { ui, dialog } = await openColumns(backend().mount);
  try {
    const groups = dialog.locator('[data-doc-group]');
    assert.ok((await groups.count()) >= 3, 'at least 3 group ticks');
    for (const g of EXCEL_GROUPS) {
      const box = dialog.locator(`[data-doc-group-box="${g.id}"]`);
      assert.equal(await box.locator('[data-doc-column]').count(), g.columns.length, `${g.id} lists its columns`);
      assert.equal(await dialog.locator(`[data-doc-group="${g.id}"]`).count(), 1);
    }
    const g = EXCEL_GROUPS.find((x) => x.columns.length >= 2);
    const tick = dialog.locator(`[data-doc-group="${g.id}"]`);
    const cols = g.columns.map((id) => dialog.locator(`[data-doc-column="${id}"]`));
    await tick.click(); // click until none (all -> none, some -> all)
    if ((await checked(tick)) !== 'false') await tick.click();
    assert.equal(await checked(tick), 'false', 'group unticked');
    for (const c of cols) assert.equal(await checked(c), 'false', 'every column of the group is unticked');
    await cols[0].click();
    assert.equal(await checked(cols[0]), 'true');
    assert.equal(await checked(tick), 'mixed', 'one column of an unticked group: indeterminate');
    await tick.click();
    assert.equal(await checked(tick), 'true', 'a mixed group ticks all');
    for (const c of cols) assert.equal(await checked(c), 'true');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('(c)(d) the generated xlsx has only the ticked columns and the ID cell links the use case in the App', async () => {
  const be = backend();
  const { ui, dialog } = await openColumns(be.mount);
  try {
    const off = EXCEL_GROUPS.find((x) => !x.columns.includes('id') && x.columns.length >= 2);
    const tick = dialog.locator(`[data-doc-group="${off.id}"]`);
    if ((await checked(tick)) !== 'false') await tick.click();
    if ((await checked(tick)) !== 'false') await tick.click();
    assert.equal(await checked(tick), 'false');
    for (let i = 0; i < 3 && (await currentPage(dialog)) !== 'review'; i += 1) await next(dialog);
    await dialog.getByRole('button', { name: /Generate \d+ files?$/ }).click();
    const end = Date.now() + 90000;
    while (!be.calls.saves.some((s) => s.name.endsWith('.xlsx')) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    const save = be.calls.saves.find((s) => s.name.endsWith('.xlsx'));
    assert.ok(save, 'an xlsx was saved');
    const rows = (await readXlsx(Buffer.from(save.content_base64, 'base64')))[0].data;
    const want = EXCEL_COLUMNS.filter((c) => defaultDocOptions().columns.includes(c.id) && !off.columns.includes(c.id)).map((c) => c.label);
    assert.deepEqual(rows[0], want, 'exactly the ticked columns, in the existing order');
    assert.ok(!want.some((l) => off.columns.map((id) => EXCEL_COLUMNS.find((c) => c.id === id).label).includes(l)));
    const xml = await sheetXml(save.content_base64);
    assert.match(xml, /HYPERLINK\(&quot;[^"]*#\/review\/42\/N01-U01&quot;/, 'row 1 ID cell links to #/review/<run>/<use case id>');
  } finally { await ui.close(); }
});

const UCS = [
  { No: 'N01-U01', Name: 'Predict delay risk', Statement: 's', Solution: 'x', Subdomain: 'Ops', inspire_score: '9.1', domain: 'Ops' },
  { No: 'N02-U01', Name: 'Win back members', Statement: 's2', Solution: 'x', Subdomain: 'CRM', inspire_score: '8.0', domain: 'CRM' },
];
test('(d) buildXlsx: the ID cell of every row is a hyperlink to that use case, the id is URL-encoded; without an App address it stays plain text', async () => {
  const model = { ...buildDocModel({ businessName: 'A', useCases: UCS, values: {}, options: defaultDocOptions('English') }), appUrl: 'https://app.example.com', sessionId: '42' };
  const blob = await buildXlsx(model, ['id', 'name']);
  const buf = Buffer.from(await blob.arrayBuffer());
  const xml = await sheetXml(buf.toString('base64'));
  assert.match(xml, /HYPERLINK\(&quot;https:\/\/app\.example\.com\/#\/review\/42\/N01-U01&quot;/);
  assert.match(xml, /HYPERLINK\(&quot;https:\/\/app\.example\.com\/#\/review\/42\/N02-U01&quot;/);
  const rows = (await readXlsx(buf))[0].data;
  assert.deepEqual(rows[0], ['ID', 'Use case']);
  const plain = Buffer.from(await (await buildXlsx({ ...model, appUrl: '' }, ['id', 'name'])).arrayBuffer());
  assert.doesNotMatch(await sheetXml(plain.toString('base64')), /HYPERLINK/);
  assert.equal((await readXlsx(plain))[0].data[1][0], 'N01-U01');
});
