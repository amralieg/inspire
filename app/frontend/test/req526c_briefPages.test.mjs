// REQ-526 part C: the brief use case pages (page 2 and later) are drawn by the chosen design, not by the legacy card.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { briefPagesSvg } from '../src/lib/docgen/docSvg.js';
import { LOG, contrast } from '../src/lib/docgen/designs/core.js';
import { UCS, ALL_BLOCKS, mkValues, model } from './req526c_fixture.mjs';

const IDS = ['original', 'editorial_ink', 'bold', 'consulting'];
const MODES = ['light', 'dark'];
const page2 = (m, id, mode) => briefPagesSvg(m, resolveTheme(id, 'databricks', '', mode))[1];
const without = (id) => ALL_BLOCKS.filter((b) => b !== id);

// Every text with its start x, end x and baseline y, from the SVG itself (width estimate 0.5 em per character, never wider than the wrapper's).
function texts(svg) {
  const out = [];
  for (const m of svg.matchAll(/<text ([^>]*)>(.*?)<\/text>/gs)) {
    const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const size = Number(a['font-size']); const anchor = a['text-anchor'] || 'start';
    for (const s of m[2].matchAll(/<tspan x="([-\d.]+)"(?: dy="([-\d.]+)")?>(.*?)<\/tspan>/gs)) {
      const w = s[3].length * size * 0.5; const x = Number(s[1]);
      out.push({ x0: anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x, x1: anchor === 'end' ? x : anchor === 'middle' ? x + w / 2 : x + w, text: s[3] });
    }
    const ys = [Number(a.y)]; let y = Number(a.y);
    for (const s of m[2].matchAll(/dy="([-\d.]+)"/g)) { y += Number(s[1]); ys.push(y); }
    out.push({ ys, text: a.y });
  }
  return out;
}
const outside = (svg) => {
  const bad = [];
  for (const e of texts(svg)) {
    if (e.ys && e.ys.some((y) => y < 0 || y > 1123)) bad.push(`y ${e.ys}`);
    if (e.x0 !== undefined && (e.x0 < 0 || e.x1 > 794)) bad.push(`x ${e.x0.toFixed(0)}-${e.x1.toFixed(0)} ${e.text.slice(0, 30)}`);
  }
  return bad;
};

for (const id of IDS) for (const mode of MODES) {
  test(`C1: ${id} ${mode} page 2 is the design's own page with the name, value and the right blocks`, () => {
    const m = model(); const u = m.useCases[0];
    const p = page2(m, id, mode);
    assert.match(p, /<g data-design="[a-z_]+" data-page="usecase">/, 'design marker');
    assert.ok(p.includes(u.id), 'the id kicker');
    assert.ok(p.includes(u.name.replace(/&/g, '&amp;').slice(0, 20)), 'the use case name');
    assert.ok(p.includes(`>${u.value.text}<`), 'the value');
    assert.match(p, /data-block="value_projection"/); assert.match(p, /data-block="use_case_story"/);
    assert.match(p, /data-block="value_story"/); assert.match(p, /data-block="data_used"/);
    assert.match(p, /Inspire score/);
    const legacy = briefPagesSvg(m, resolveTheme('midnight', 'databricks', '', mode))[1];
    assert.doesNotMatch(legacy, /data-design=/, 'the legacy card has no design marker');
  });

  test(`C2: ${id} ${mode} page 2 omits every block that is off, and the projection needs yearly data`, () => {
    assert.doesNotMatch(page2(model({ blocks: without('value_projection') }), id, mode), /data-block="value_projection"/);
    assert.doesNotMatch(page2(model({ values: mkValues({ yearly: false }) }), id, mode), /data-block="value_projection"/, 'no yearly rows, no chart');
    assert.doesNotMatch(page2(model({ blocks: without('value_story') }), id, mode), /data-block="value_story"/);
    assert.doesNotMatch(page2(model({ blocks: without('data_used') }), id, mode), /data-block="data_used"/);
    assert.doesNotMatch(page2(model({ blocks: without('use_case_story') }), id, mode), /data-block="use_case_story"/);
    assert.doesNotMatch(page2(model({ blocks: without('inspire_score') }), id, mode), /Inspire score/);
    const withChart = page2(model(), id, mode);
    assert.ok((withChart.match(/<(rect|circle|path|line) /g) || []).length > 60, 'a real small chart, not text');
    assert.match(withChart, /data-chart="projection"/);
  });

  test(`C3: ${id} ${mode} every page 2+ keeps all text in the A4 box, passes the 4.5:1 and 12px log, and a 3000-char statement does not overflow`, () => {
    const th = resolveTheme(id, 'databricks', '', mode);
    const long = 'The business wants a single view of every order across all stores and channels so that planners can react the same day. '.repeat(26).slice(0, 3000);
    const ucs = UCS.map((u, i) => (i < 3 ? { ...u, Statement: long, Solution: long, 'Business Value': long } : u));
    const pages = briefPagesSvg(model({ ucs }), th);
    assert.equal(pages.length, 1 + UCS.length);
    const bad = LOG.filter((e) => contrast(e.fill, e.bg) < 4.5 || e.size < 12).map((e) => `${e.ctx} ${e.fill}/${e.bg} ${e.size}`);
    assert.deepEqual(bad, []);
    pages.slice(1).forEach((p, i) => { assert.match(p, /data-design=/, `page ${i + 2}`); assert.deepEqual(outside(p), [], `page ${i + 2}`); });
    assert.match(pages[1], /…/, 'the long text is shortened with an ellipsis');
  });

  test(`C4: ${id} ${mode} an unvalued use case says "not calculated yet" and shows no projection`, () => {
    const p = briefPagesSvg(model(), resolveTheme(id, 'databricks', '', mode))[1 + 25];
    assert.match(p, /data-design=/); assert.match(p, /not calculated yet/);
    assert.doesNotMatch(p, /data-block="value_projection"/);
  });
}

test('C5: RTL pages keep direction="rtl" on every design page', () => {
  for (const id of IDS) for (const mode of MODES) {
    const pages = briefPagesSvg(model({ language: 'Arabic' }), resolveTheme(id, 'databricks', '', mode));
    assert.ok(pages.every((p) => /^<svg [^>]*direction="rtl"/.test(p)), `${id} ${mode}`);
    assert.match(pages[1], /data-design=/);
  }
});

test('C6: must-keep, the old midnight style pages 2+ are byte-identical to the base output', () => {
  const snap = JSON.parse(fs.readFileSync(new URL('./req526c_midnight.snapshot.json', import.meta.url), 'utf8'));
  for (const mode of MODES) for (const rtl of [false, true]) {
    const pages = briefPagesSvg(model({ language: rtl ? 'Arabic' : 'English' }), resolveTheme('midnight', 'databricks', '', mode));
    assert.deepEqual(pages.slice(1).map((p) => crypto.createHash('sha256').update(p).digest('hex')), snap[`${mode}|${rtl ? 'rtl' : 'ltr'}`], `${mode} ${rtl}`);
  }
});
