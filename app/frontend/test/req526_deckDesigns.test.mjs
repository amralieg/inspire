// REQ-526 part B: the PowerPoint deck in the 4 chosen designs, native and editable (text, shapes, charts), Light and Dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme, contrastRatio } from '../src/lib/docgen/docStyles.js';
import { DESIGNS } from '../src/lib/docgen/designs/model.js';
import { buildPptx } from '../src/lib/docgen/pptxDoc.js';

const FIXTURE = new URL('../../agent/demos/bakehouse/docs/Samples bakehouse-dbx_inspire.json', import.meta.url);
const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const UCS = raw.domains.flatMap((d) => d.use_cases.map((u) => ({ ...u, domain: d.domain_name })));
const VALUED = UCS.slice(0, 20);
const values = Object.fromEntries(VALUED.map((u, i) => [u.No, { amount: 40000 + i * 12500, currency: 'USD', status: i % 2 ? 'calculated' : 'estimated', verb: 'GROW REVENUE', story: '', yearly: [], factors: [] }]));
const options = { ...defaultDocOptions('English'), blocks: ['use_case_story', 'value_story', 'data_used', 'inspire_score', 'disclaimer'] };
const doc = () => buildDocModel({ businessName: 'Acme Bakes', useCases: UCS, values, options });
const COVER = { original: (t) => t.tealDark, editorial_ink: (t) => t.paper, bold: (t) => t.hero, consulting: (t) => t.page };
const themeOf = (id, mode) => ({ ...resolveTheme('executive', 'databricks', '', mode), design: id, tokens: DESIGNS[id].themes[mode], fonts: DESIGNS[id].fonts });
const slideXml = async (zip, n) => zip.file(`ppt/slides/slide${n}.xml`).async('string');
const texts = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
const open = async (id, mode) => JSZip.loadAsync(await buildPptx(doc(), themeOf(id, mode)));
// The use case slides come after the domain slides (grouped by domain): find one by its title.
const ucSlide = async (zip, name) => {
  const total = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length; // c23: continuation slides follow a use case slide
  for (let n = 2 + nDomains; n < total; n += 1) { const t = texts(await slideXml(zip, n)); if (t.includes(name)) return t.join(' '); }
  return '';
};
const nDomains = new Set(doc().useCases.map((u) => u.domain)).size;
const EXPECT = 1 + nDomains + UCS.length + 1;

for (const id of Object.keys(COVER)) for (const mode of ['light', 'dark']) {
  test(`D1 ${id}/${mode}: slide count, cover colour, charts, real text, no picture-only slide`, async () => {
    const zip = await open(id, mode);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    assert.ok(slides.length >= EXPECT, 'at least one slide per use case; long text continues on extra slides (c23)');
    const LAST = slides.length;
    const cover = await slideXml(zip, 1);
    assert.match(cover, new RegExp(`<p:bg>.*?srgbClr val="${COVER[id](DESIGNS[id].themes[mode]).replace('#', '')}"`, 'i'));
    const rels = async (n) => zip.file(`ppt/slides/_rels/slide${n}.xml.rels`).async('string');
    assert.match(await rels(2), /charts\/chart/, 'first domain slide has a native chart');
    assert.match(await rels(LAST), /charts\/chart/, 'portfolio slide has a native chart');
    for (let n = 1; n <= LAST; n += 1) assert.ok(texts(await slideXml(zip, n)).length > 0, `slide ${n} has text runs`);
    const u0 = doc().useCases[0];
    const ucText = await ucSlide(zip, u0.name);
    assert.ok(ucText.includes(u0.name), 'use case name');
    assert.ok(ucText.includes(u0.value.text), 'money text');
  });
}

test('D2: a use case without a value says not calculated yet and no number is invented', async () => {
  const zip = await open('original', 'light');
  const t = await ucSlide(zip, doc().useCases[UCS.length - 1].name);
  assert.ok(t.includes('not calculated yet'));
});

test('D3: every text/background pair the deck sets reads at 4.5:1 or more', async () => {
  const { DECK_LOG } = await import('../src/lib/docgen/designs/pptxDesign.js');
  for (const id of Object.keys(COVER)) for (const mode of ['light', 'dark']) {
    await open(id, mode);
    assert.ok(DECK_LOG.length > 50, `${id}/${mode} logged pairs`);
    for (const p of DECK_LOG) assert.ok(contrastRatio(`#${p.fg}`, `#${p.bg}`) >= 4.5, `${id}/${mode} ${p.fg} on ${p.bg}: ${p.text}`);
  }
});

test('D4 must-keep: an old style builds as before (summary, one slide per use case, roll-up)', async () => {
  const zip = await JSZip.loadAsync(await buildPptx(doc(), resolveTheme('executive', 'databricks', '', 'light')));
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  assert.ok(slides.length >= UCS.length + 3, 'one slide per use case, plus continuation slides (c23)');
  assert.ok(texts(await slideXml(zip, 2)).includes('Summary'));
  assert.ok(texts(await slideXml(zip, slides.length)).includes('Value roll-up'));
});

test('D5: empty values and null scores do not break any design', async () => {
  const m = buildDocModel({ businessName: 'Acme Bakes', useCases: UCS.slice(0, 3), values: {}, options });
  for (const id of Object.keys(COVER)) {
    const zip = await JSZip.loadAsync(await buildPptx(m, themeOf(id, 'light')));
    assert.ok(Object.keys(zip.files).some((f) => /slide\d+\.xml$/.test(f)));
  }
});
