// C24 (RC7-B-11, RC7-B-12): the Generate docs wizard offers Word (a .docx brief with the PDF brief's content), and brief text reads as plain
// business text: bracket markers like [ESTIMATE: depends on `col`] become words, backticks go, and a bare foundation code (F1) becomes its name.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';
import { planFiles, defaultDocOptions, DOC_KINDS } from '../../src/lib/docgen/docOptions.js';
import { buildDocModel } from '../../src/lib/docgen/docModel.js';
import { briefPagesSvg } from '../../src/lib/docgen/docSvg.js';
import { resolveTheme } from '../../src/lib/docgen/docStyles.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED, output_language: 'English' } : s));
const PICKED = ['Predict churn', 'Score upsell'];

const DIRTY = [{
  No: 'N01-U01', Name: 'Predict churn', Statement: 'Find customers who leave, using `customer_id` and `last_order`.', Solution: 'A model on `orders`.',
  'Business Value': 'Cut churn [ESTIMATE: depends on `totalPrice`, `order_count`] each year [BASELINE: current churn rate].', Foundations: 'F1, F9',
  'Tables Involved': 'main.s.orders', 'Inspire Score': 7,
}];
const FOUNDATIONS = [{ id: 'F1', name: 'Orders and customers' }];
const modelOf = (extra = {}) => buildDocModel({ businessName: 'Acme', useCases: DIRTY, values: {}, options: { ...defaultDocOptions('English'), blocks: ['use_case_story', 'data_used', 'inspire_score', 'disclaimer'] }, foundations: FOUNDATIONS, ...extra });
const MARKERS = /\[[A-Z_]+[:\]]|`|\bF[0-9]+\b/;

test('B-12 the doc model prints plain words: no bracket markers, no backticks, a foundation code becomes its name', () => {
  const [u] = modelOf().useCases;
  for (const [field, text] of [['statement', u.statement], ['solution', u.solution], ['businessValue', u.businessValue], ['foundations', u.foundations.join(' | ')]]) {
    assert.ok(!MARKERS.test(text), `${field} is plain: ${text}`);
  }
  assert.match(u.businessValue, /depends on totalPrice, order_count/, 'the dependency stays as words');
  assert.match(u.businessValue, /baseline/i, 'another marker keeps its meaning as a word');
  assert.deepEqual(u.foundations, ['Orders and customers'], 'F1 is its name; F9 has no known name so it is left out, not printed as a code');
  assert.match(u.statement, /customer_id/, 'the column name stays, without backticks');
});

test('B-12 the PDF brief pages carry no marker text either', () => {
  const svg = briefPagesSvg(modelOf(), resolveTheme('original', 'databricks', '', 'light')).join('\n');
  assert.ok(!/\[ESTIMATE|\[BASELINE|`|>F1</.test(svg), 'no marker in the drawn pages');
  // REQ-561: no foundation names in any printed document, so the brief pages must not carry them either.
  assert.ok(!svg.includes('Orders and customers'), 'foundations are not printed');
});

test('B-12 the generation prompt asks for plain words in the text people read', () => {
  const prompts = JSON.parse(fs.readFileSync(new URL('../../../agent/agent/app_shell/prompts.json', import.meta.url), 'utf8'));
  assert.match(prompts.BASE_USE_CASE_GEN_PROMPT, /PLAIN WORDS FOR READERS/, 'the rule is in the use case prompt');
  assert.match(prompts.BASE_USE_CASE_GEN_PROMPT, /never (put )?(square )?brackets? (tags )?or backticks/i);
});

test('B-11 Word is a document kind and plans one .docx brief per language', () => {
  assert.ok(DOC_KINDS.includes('docx'));
  const plan = planFiles({ ...defaultDocOptions('English'), kinds: ['docx'], businessName: 'Acme' }, [{ No: 'N01-U01' }, { No: 'N01-U02' }]);
  assert.deepEqual(plan.map((f) => [f.kind, f.ext, f.name]), [['docx', 'docx', 'Acme_brief.docx']]);
});

test('B-11 the Word file has the brief content and the same plain text', async () => {
  const { buildDocx } = await import('../../src/lib/docgen/docxDoc.js');
  const bytes = await buildDocx(modelOf(), resolveTheme('original', 'databricks', '', 'light'));
  assert.deepEqual([...bytes.subarray(0, 2)], [0x50, 0x4b], 'a zip package');
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file('[Content_Types].xml') && zip.file('_rels/.rels') && zip.file('word/document.xml'), 'the parts Word needs');
  const xml = await zip.file('word/document.xml').async('string');
  const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const part of ['Acme', 'Predict churn', 'The use case', 'Business value']) assert.ok(text.includes(part), `the file says "${part}"`);
  // REQ-561: the Word brief is business only, so no foundation names and no table names.
  for (const part of ['Orders and customers', 'main.s.orders']) assert.ok(!text.includes(part), `the file does not say "${part}"`);
  assert.ok(!MARKERS.test(text), 'no marker text in the Word file');
});

test('B-11 the wizard offers Word and saves a real .docx into the Assets folder', async () => {
  const saves = [];
  const mount = (app) => {
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
    app.post('/api/inspire/docs/save', (req, res) => { saves.push(req.body); res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 }); });
    app.post('/api/inspire/docs/translate', (req, res) => res.json({ language: req.body.language, texts: req.body.texts }));
    app.get('/api/workspace/list', (_req, res) => res.json({ files: [] }));
  };
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
    for (const n of PICKED) await page.getByRole('checkbox', { name: `Select ${n}`, exact: true }).check();
    await page.locator('[data-value-bulk-bar]').getByRole('button', { name: /Generate docs/ }).click();
    const dialog = page.getByRole('dialog', { name: /Generate documents/ });
    await dialog.waitFor();
    const word = dialog.locator('[data-doc-kind="docx"]');
    assert.equal(await word.count(), 1, 'a Word option');
    assert.match(await word.innerText(), /Word/);
    for (const k of DOC_KINDS.filter((x) => x !== 'docx')) {
      const box = dialog.locator(`[data-doc-kind="${k}"]`);
      if ((await box.getAttribute('aria-checked')) === 'true') await box.click();
    }
    if ((await word.getAttribute('aria-checked')) !== 'true') await word.click();
    for (let i = 0; i < 6 && (await dialog.locator('[data-docs-page]:visible').first().getAttribute('data-docs-page')) !== 'review'; i += 1) await dialog.getByRole('button', { name: /^Next/ }).click();
    await dialog.getByRole('button', { name: /^✦?\s*Generate 1 file$/ }).click();
    // REQ-121: Results also auto-builds <business>_strategy.pdf App-side for a finished run and saves it through the same route; it is not the wizard's file.
    const wizardSaves = () => saves.filter((x) => !/_strategy\.pdf$/.test(x.name));
    const end = Date.now() + 90000;
    while (!wizardSaves().length && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    assert.equal(wizardSaves().length, 1);
    assert.match(wizardSaves()[0].name, /\.docx$/);
    const zip = await JSZip.loadAsync(Buffer.from(wizardSaves()[0].content_base64, 'base64'));
    const xml = await zip.file('word/document.xml').async('string');
    assert.match(xml, /Predict churn/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
