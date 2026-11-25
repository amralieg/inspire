// REQ-526 steps 2 and 3: the four document designs in docStyles (order, default, resolveTheme) and docSvg (infographic and brief render through the design).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { DOC_STYLES, resolveTheme, contrastRatio } from '../src/lib/docgen/docStyles.js';
import { infographicSvg, briefPagesSvg } from '../src/lib/docgen/docSvg.js';
import { LOG, resetLog, contrast } from '../src/lib/docgen/designs/core.js';
import { moneyText } from '../src/lib/valueWizard.js';

const FIXTURE = new URL('../../agent/demos/bakehouse/docs/Samples bakehouse-dbx_inspire.json', import.meta.url);
const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const UCS = raw.domains.flatMap((d) => d.use_cases.map((u) => ({ ...u, domain: d.domain_name })));
const VALUED = UCS.slice(0, 20);
const VERBS = ['GROW REVENUE', 'AVOID RISK', 'CUT COST'];
const mkValues = (verb = true) => Object.fromEntries(VALUED.map((u, i) => [u.No, { amount: 40000 + i * 12500, currency: 'USD', status: i % 2 ? 'calculated' : 'estimated', verb: verb ? VERBS[i % 3] : '', story: 'It pays back.', yearly: [], factors: [] }]));
const ALL_BLOCKS = ['use_case_story', 'value_story', 'value_projection', 'inspire_score', 'data_used', 'disclaimer'];
const model = (o = {}) => buildDocModel({ businessName: 'Acme Bakes', useCases: UCS, values: o.values || mkValues(), options: { ...defaultDocOptions(o.language || 'English'), blocks: o.blocks || ALL_BLOCKS } });
const sum = VALUED.reduce((s, u, i) => s + 40000 + i * 12500, 0);
const NEW_IDS = ['original', 'editorial_ink', 'bold', 'consulting'];
const OLD_IDS = ['midnight', 'executive', 'vivid', 'editorial', 'neon', 'organic', 'gold', 'blueprint'];

test('D1: DOC_STYLES lists the 4 new designs first with their labels, then the 8 old styles unchanged; the default style is original', () => {
  assert.deepEqual(DOC_STYLES.map((s) => s.id), [...NEW_IDS, ...OLD_IDS]);
  assert.deepEqual(DOC_STYLES.slice(0, 4).map((s) => s.label), ['Inspire original', 'Editorial ink', 'Bold data', 'Board pack']);
  assert.equal(defaultDocOptions().style, 'original');
  assert.equal(resolveTheme(undefined).design, 'original');
});

test('D2: every old style resolves exactly as on the base (light and dark, palettes, brand colour)', () => {
  const snap = JSON.parse(fs.readFileSync(new URL('./req526_oldThemes.snapshot.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(snap).length, 48);
  for (const [key, want] of Object.entries(snap)) {
    const [id, mode, palette, custom] = key.split('|');
    assert.deepEqual(resolveTheme(id, palette, custom, mode), want, key);
  }
});

test('D3: a design theme keeps today\'s fields and adds design, tokens and fonts', () => {
  for (const id of NEW_IDS) for (const mode of ['light', 'dark']) {
    const th = resolveTheme(id, 'databricks', '', mode);
    assert.equal(th.design, id); assert.equal(th.mode, mode);
    for (const k of ['bg', 'surface', 'ink', 'muted']) assert.match(th[k], /^#[0-9a-f]{6}$/i, `${id} ${mode} ${k}`);
    assert.ok(th.accents.length >= 3 && th.font && th.fonts && th.tokens && th.tokens.mode === mode);
    assert.ok(contrastRatio(th.ink, th.bg) >= 4.5);
  }
});

test('D4: a palette or brand colour replaces the primary accent of a design at 4.5:1 or more on its backgrounds', () => {
  for (const id of NEW_IDS) for (const mode of ['light', 'dark']) {
    const base = resolveTheme(id, 'databricks', '', mode);
    const brand = resolveTheme(id, 'databricks', '#FF3621', mode);
    const violet = resolveTheme(id, 'violet', '', mode);
    assert.notDeepEqual(brand.tokens, base.tokens, `${id} ${mode} brand changes tokens`);
    assert.notDeepEqual(violet.tokens, base.tokens, `${id} ${mode} palette changes tokens`);
    assert.equal(brand.design, id);
  }
  const bold = resolveTheme('bold', 'databricks', '#FF3621', 'light');
  assert.ok(contrastRatio(bold.tokens.accentText, bold.tokens.canvas) >= 4.5);
  assert.ok(contrastRatio(bold.tokens.heroAccent, bold.tokens.hero) >= 4.5);
  const orig = resolveTheme('original', 'databricks', '#FFEE00', 'light');
  assert.ok(contrastRatio(orig.tokens.teal, orig.tokens.page) >= 4.5, 'a pale brand colour is darkened on a light page');
});

for (const id of NEW_IDS) for (const mode of ['light', 'dark']) {
  test(`D5: ${id} ${mode} infographic has real chart marks, the real total and passes the contrast and size log`, () => {
    const th = resolveTheme(id, 'databricks', '', mode);
    resetLog();
    const svg = infographicSvg(model(), th);
    assert.match(svg, /^<svg /); assert.match(svg, /width="794"/); assert.match(svg, /height="1123"/);
    assert.ok((svg.match(/<circle /g) || []).length >= 20, 'one point per valued use case');
    assert.ok((svg.match(/<(path|rect) /g) || []).length > 40, 'bars, arcs, tiles');
    assert.ok(svg.includes(`>${moneyText('USD', sum)}<`), 'the App money text of the real total');
    const bad = LOG.filter((e) => contrast(e.fill, e.bg) < 4.5 || e.size < 12).map((e) => `${e.ctx} ${e.fill}/${e.bg} ${e.size}`);
    assert.deepEqual(bad, []);
    resetLog();
    const pages = briefPagesSvg(model(), th);
    assert.equal(pages.length, 1 + UCS.length);
    assert.ok(/acme bakes/i.test(pages[0]) && pages[0].includes('width="794"'));
    const bad1 = LOG.filter((e) => contrast(e.fill, e.bg) < 4.5 || e.size < 12).map((e) => `${e.ctx} ${e.fill}/${e.bg} ${e.size}`);
    assert.deepEqual(bad1, []);
    assert.ok(pages[1].includes(th.fonts.body.split(',')[0].replace(/'/g, '')), 'later pages use the design font');
  });
}

for (const id of NEW_IDS) {
  test(`D6: ${id} honours the blocks (disclaimer, Inspire score) and leaves nothing out of ticked ones`, () => {
    const th = resolveTheme(id, 'databricks', '', 'light');
    const on = infographicSvg(model(), th);
    const noDisc = infographicSvg(model({ blocks: ALL_BLOCKS.filter((b) => b !== 'disclaimer') }), th);
    const noScore = infographicSvg(model({ blocks: ALL_BLOCKS.filter((b) => b !== 'inspire_score') }), th);
    assert.match(on, /does not promise/); assert.doesNotMatch(noDisc, /does not promise/);
    assert.match(on, /(Top Inspire score|best Inspire score|top score|Inspire score)/);
    assert.doesNotMatch(noScore, /(Top Inspire score|best Inspire score|top score)/);
    assert.doesNotMatch(noScore, />\s*[Ss]core \d/);
    assert.match(on, />\s*[Ss]core \d|Inspire score|top score/);
  });
}

test('D7: a model without verbs, with an unknown verb, or with no value at all never crashes', () => {
  for (const id of NEW_IDS) {
    const th = resolveTheme(id, 'databricks', '', 'light');
    assert.match(infographicSvg(model({ values: mkValues(false) }), th), /^<svg /);
    const odd = Object.fromEntries(Object.entries(mkValues()).map(([k, v]) => [k, { ...v, verb: 'SOMETHING NEW' }]));
    assert.match(infographicSvg(model({ values: odd }), th), /^<svg /);
    assert.equal(briefPagesSvg(model({ values: mkValues(false) }), th).length, 1 + UCS.length);
    const none = infographicSvg(model({ values: {} }), th);
    assert.match(none, /not calculated yet/, 'no value anywhere falls back to the plain renderer');
    assert.equal(briefPagesSvg(model({ values: {} }), th).length, 1 + UCS.length);
  }
});

test('D8: RTL keeps direction="rtl" on every design page and does not crash', () => {
  const m = model({ language: 'Arabic' });
  for (const id of NEW_IDS) {
    const th = resolveTheme(id, 'databricks', '', 'dark');
    assert.match(infographicSvg(m, th), /^<svg [^>]*direction="rtl"/);
    assert.ok(briefPagesSvg(m, th).every((p) => /^<svg [^>]*direction="rtl"/.test(p)));
  }
});

test('D9: old styles still render the plain infographic', () => {
  const svg = infographicSvg(model(), resolveTheme('midnight', 'databricks', '', 'light'));
  assert.match(svg, /Three-year projection|Value per use case/);
  assert.match(svg, /width="1200"/);
});

test('D10: the theme contract part B reads: design id, tokens with mode, fonts with display and body; old styles leave them unset', () => {
  const th = resolveTheme('bold', 'databricks', '', 'dark');
  assert.equal(th.design, 'bold'); assert.equal(th.tokens.mode, 'dark');
  assert.ok(th.fonts.display && th.fonts.body);
  const old = resolveTheme('midnight', 'databricks', '', 'dark');
  assert.equal(old.design, undefined); assert.equal(old.tokens, undefined);
});
