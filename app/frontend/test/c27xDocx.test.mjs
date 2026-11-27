// C27 (REQ-564): the Word document is an executive document: strategic cover, its own executive summary page, purpose, domains list,
// color and a chart picture per use case. buildDocx(m, theme, { chartPng }) takes an async SVG -> PNG bytes rasterizer. Fails on 49c0dc3b7.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildDocx } from '../src/lib/docgen/docxDoc.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { ARGS, DOMAINS, IDS, flat, charts } from './c27x_fixture.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const seen = [];
const chartPng = async (svg) => { seen.push(svg); return new Uint8Array(PNG); };
const m = buildDocModel({ ...ARGS, options: defaultDocOptions('English') });
const out = await buildDocx(m, resolveTheme('original', 'databricks', '', 'light'), { chartPng });
const zip = await JSZip.loadAsync(out instanceof Uint8Array || Buffer.isBuffer(out) ? out : await out.arrayBuffer());
const xml = await zip.file('word/document.xml').async('string');
const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((x) => x[0]);
const text = (p) => flat(p.replace(/<\/w:t>/g, ' </w:t>'));
const headingAt = (re) => paras.findIndex((p) => /w:pStyle w:val="Heading|w:val="Title"/.test(p) && re.test(text(p)));

test('B1: the cover reads Strategic AI Use Cases, Databricks', () => {
  const head = paras.slice(0, 15).map(text).join(' ');
  assert.match(head, /Strategic AI Use Cases/i); assert.match(head, /Databricks/);
});
test('B2: the executive summary is a heading, 180+ words, then a page break', () => {
  const i = headingAt(/Executive summary/i); assert.ok(i >= 0, 'heading');
  const j = paras.findIndex((p, k) => k > i && /w:pStyle w:val="Heading/.test(p));
  const body = paras.slice(i + 1, j);
  assert.ok(body.map(text).join(' ').split(' ').filter((w) => /[A-Za-z]{2,}/.test(w)).length >= 180, 'summary length');
  assert.ok(/w:type="page"|w:pageBreakBefore/.test([...body, paras[j]].join('')), 'own page');
});
test('B3: a purpose section', () => { assert.ok(headingAt(/What this (catalog|document) is for/i) >= 0); });
test('B4: a business domains list names every domain', () => {
  const i = headingAt(/Business domains/i); assert.ok(i >= 0, 'heading');
  const after = flat(xml.slice(xml.indexOf(paras[i])));
  for (const d of DOMAINS) assert.ok(after.includes(d), d);
});
test('B5: a chart picture per use case, 6+ chart types, from the shared chart contract', () => {
  const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'));
  assert.ok(media.length >= 1 && (xml.match(/<pic:pic/g) || []).length >= IDS.length, `pictures ${(xml.match(/<pic:pic/g) || []).length}`);
  const list = seen.flatMap(charts);
  for (const id of IDS) assert.ok(list.some((c) => c.uc === id), `${id} has a chart`);
  assert.ok(new Set(list.map((c) => c.type)).size >= 6, `types ${[...new Set(list.map((c) => c.type))]}`);
});
test('B6: colorful (5+ distinct cell shadings)', () => {
  const f = new Set([...xml.matchAll(/w:shd [^>]*w:fill="([0-9A-Fa-f]{6})"/g)].map((x) => x[1].toUpperCase()).filter((c) => c !== 'FFFFFF'));
  assert.ok(f.size >= 5, `${f.size} shadings`);
});
