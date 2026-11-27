// C28 (REQ-567 REQ-570 REQ-572): the Generate docs dialog. Overall documents are Excel, PDF and PowerPoint only; the infographic is per use case,
// Landscape or Portrait, with a style picker; the last step "Vibe your docs" carries a text and a logo that reach the options, the LLM calls and the covers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { agentPdfPages } from '../src/lib/docgen/agentPdf.js';
import { buildAgentModel } from '../src/lib/docgen/agentModel.js';
import * as O from '../src/lib/docgen/docOptions.js';
import * as G from '../src/lib/generateDocs.js';
import * as I from '../src/lib/docgen/infographicApi.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const uc = (id, name) => ({ No: id, Name: name, usecase: name, 'Business Domain': 'Logistics', Subdomain: 'Delivery', type: 'Opportunity', Statement: 'Planners cannot see late deliveries early.',
  Solution: 'A model flags late deliveries.', 'Inspire Score': 8.7, Quality: 'Very High', 'Quality Score': 4.3, best_of_best: 'N' });
const ARGS = { businessName: 'Acme', useCases: [uc('P01-U01', 'Predict late deliveries'), uc('P01-U02', 'Cover a quiet depot')], values: {}, summary: ['Acme ships daily.'], foundations: [], language: 'English', date: '2026-11-27' };
const LOGO = { name: 'brand.png', type: 'image/png', size: 70, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' };

test('(a) overall documents are exactly Excel, PDF and PowerPoint; the infographic is per use case only', () => {
  assert.deepEqual([...O.kindsForLayout('one')].sort(), ['pdf', 'pptx', 'xlsx']);
  assert.ok(O.kindsForLayout('each').includes('infographic'), 'per use case offers the infographic');
  const d = O.defaultDocOptions('English');
  assert.ok(!d.kinds.includes('infographic'), 'the default overall run has no infographic');
  const all = O.planFiles({ ...d, layout: 'one', kinds: ['infographic', 'pdf', 'xlsx', 'pptx'], businessName: 'Acme' }, ARGS.useCases);
  assert.ok(!all.some((f) => f.kind === 'infographic'), 'no overall infographic file is planned');
  const each = O.planFiles({ ...d, layout: 'each', kinds: ['infographic'], businessName: 'Acme', orientation: 'portrait' }, ARGS.useCases);
  assert.equal(each.length, 2, 'one infographic per use case');
  assert.ok(each.every((f) => f.kind === 'infographic' && f.useCaseIds.length === 1 && f.orientation === 'portrait'));
  assert.equal(new Set(each.map((f) => f.name)).size, 2);
});

test('(b) orientation, style and vibe options have defaults that persist through the options object', () => {
  const d = O.defaultDocOptions('English');
  assert.equal(d.orientation, 'landscape');
  assert.deepEqual(O.ORIENTATIONS.map((o) => o.id), ['landscape', 'portrait']);
  assert.equal(d.vibe, ''); assert.equal(d.logo, null);
  assert.ok('infographicStyle' in d);
});

test('(c) the infographic interface: styles with id, name, thumbnail, and infographicFor(useCase, options)', () => {
  assert.ok(Array.isArray(I.INFOGRAPHIC_STYLES) && I.INFOGRAPHIC_STYLES.length >= 1);
  for (const s of I.INFOGRAPHIC_STYLES) for (const k of ['id', 'name', 'thumbnail']) assert.ok(k in s, `a style has ${k}`);
  const svg = I.infographicFor(ARGS.useCases[0], { orientation: 'portrait', scenario: 'likely', content: ['use_case_story'], theme: 'light', logo: LOGO, businessName: 'Acme', values: {} });
  assert.match(String(svg), /<svg/);
});

test('(d) "Vibe your docs": 3 to 4 industry-agnostic examples, a last step before Review, and the page source wires a text box, examples and a logo upload', () => {
  assert.ok(O.VIBE_EXAMPLES.length >= 3 && O.VIBE_EXAMPLES.length <= 4);
  assert.ok(O.VIBE_EXAMPLES.every((s) => typeof s === 'string' && s.length > 15 && s.length < 200));
  const dlg = read('../src/components/GenerateDocsDialog.jsx');
  assert.match(dlg, /'vibe', 'review'/, 'Vibe is the last step before Review');
  const pages = read('../src/components/GenerateDocsPages.jsx');
  assert.match(pages, /Vibe your docs/); assert.match(pages, /VIBE_EXAMPLES/); assert.match(pages, /type="file"/); assert.match(pages, /data-docs-vibe/);
});

test('(e) logo checks: PNG, SVG, JPEG only and size-limited', () => {
  assert.equal(O.checkLogo({ type: 'image/png', size: 1000 }), '');
  assert.equal(O.checkLogo({ type: 'image/svg+xml', size: 1000 }), '');
  assert.equal(O.checkLogo({ type: 'image/jpeg', size: 1000 }), '');
  assert.notEqual(O.checkLogo({ type: 'image/gif', size: 1000 }), '');
  assert.notEqual(O.checkLogo({ type: 'image/png', size: O.LOGO_MAX_BYTES + 1 }), '');
});

test('(f) the vibe and the logo reach every generate call and every LLM call', () => {
  const ctx = G.docContext({ vibe: '  Board tone  ', logo: LOGO });
  assert.equal(ctx.vibe, 'Board tone'); assert.equal(ctx.logo, LOGO);
  assert.deepEqual(G.docContext({}), { vibe: '', logo: null });
  const src = read('../src/lib/generateDocs.js');
  assert.match(src, /docs\/translate', \{[^}]*vibe/, 'the translate call carries vibe');
  const require = createRequire(import.meta.url);
  const DT = require('../../backend/lib/docTranslate.js');
  assert.equal(DT.vibeLine(''), '');
  assert.match(DT.vibeLine('Board tone'), /Board tone/);
  assert.ok(DT.vibeLine('x'.repeat(5000)).length < 1200, 'a long vibe is cut');
  const routes = fs.readFileSync(new URL('../../backend/implementRoutes.js', import.meta.url), 'utf8');
  assert.match(routes, /vibeLine\(req\.body\?\.vibe\)/);
});

test('(g) an uploaded logo appears in the PDF cover SVG and the agent model; no logo keeps the cover as before', () => {
  const m = buildAgentModel({ ...ARGS, logo: LOGO, vibe: 'Board tone' });
  assert.equal(m.logo, LOGO); assert.equal(m.vibe, 'Board tone');
  const cover = agentPdfPages({ ...ARGS, logo: LOGO })[0];
  assert.equal(cover.kind, 'cover');
  assert.ok(cover.svg.includes(LOGO.dataUrl), 'the cover svg holds the logo');
  const plain = agentPdfPages(ARGS)[0];
  assert.ok(!plain.svg.includes('data-doc-logo'));
});
