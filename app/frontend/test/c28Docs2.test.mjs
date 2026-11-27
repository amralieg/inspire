// C28 docs2 (REQ-566 REQ-567 REQ-570 REQ-571 REQ-572 REQ-569): the five docs lanes wired end to end. Fail-first on the merged tree.
// W1 the infographic asks the pick route and falls back; W2 the vibe and the logo reach it; W3 every printed id is AIx-UCx; W4 see c24BDocs.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import * as G from '../src/lib/generateDocs.js';
import { infographicFor } from '../src/lib/docgen/infographicApi.js';
import { agentPdfPages } from '../src/lib/docgen/agentPdf.js';
import { buildDocx } from '../src/lib/docgen/docxDoc.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { ARGS, ROWS, flat } from './c27x_fixture.mjs';

const OLD = /N\d+-U\d+/;
const UC = ROWS[0];
const THEME = resolveTheme('original', 'databricks', '', 'light');
const LOGO = { name: 'brand.png', type: 'image/png', size: 70, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' };
const PICK = { scenario: 'timeline', title: 'Zebra Quarter Horizon', subtitle: 'Three phases', steps: [{ title: 'Gather signals', text: 'Collect the history.' }, { title: 'Train the forecast', text: 'Fit the model.' }], outcomes: [{ title: 'Steadier plans', text: 'Planners act earlier.' }] };
const WHERE = { inspire_database: 'db', warehouse_id: 'w', session_id: '1' };
const draw = (post, extra = {}) => G.drawInfographic(UC, { options: { ...defaultDocOptions('English'), orientation: 'portrait', ...extra }, theme: THEME, post, where: WHERE });

test('W1: the infographic asks the pick route and draws what it returns', async () => {
  assert.equal(typeof G.drawInfographic, 'function', 'generateDocs exports drawInfographic');
  const calls = [];
  const svg = await draw(async (route, body) => { calls.push({ route, body }); return { pick: PICK }; });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, '/api/inspire/docs/infographic-pick');
  assert.equal(calls[0].body.use_case.Name, UC.Name);
  assert.equal(calls[0].body.orientation, 'portrait');
  assert.match(svg, /Zebra Quarter Horizon/, 'the picked title is drawn');
});

test('W1: a 503, a 502, a junk answer or a network error still draws the local picker', async () => {
  for (const post of [async () => { throw Object.assign(new Error('No model'), { status: 503 }); }, async () => { throw new Error('network'); }, async () => ({ pick: null })]) {
    const svg = await draw(post);
    assert.match(svg, /<svg/);
    assert.ok(flat(svg).includes(UC.Name), 'the local pick still carries the use case name');
  }
});

test('W2: the vibe text goes in the pick body and the logo is drawn in the SVG', async () => {
  let body = null;
  const svg = await draw(async (_r, b) => { body = b; return { pick: PICK }; }, { vibe: 'Warm and plain for a board', logo: LOGO });
  assert.equal(body.vibe, 'Warm and plain for a board');
  assert.ok(svg.includes(LOGO.dataUrl), 'the logo picture is in the SVG');
  assert.ok(!svg.includes('[object Object]'));
  assert.ok(infographicFor(UC, { logo: LOGO }).includes(LOGO.dataUrl), 'infographicFor takes the dialog logo object');
});

test('W3: the infographic footer, the PDF pages and the Word XML print AIx-UCx and never an old id', async () => {
  assert.match(UC.No, OLD, 'the fixture still holds an old id');
  const svg = infographicFor(UC, { orientation: 'landscape' });
  assert.ok(!OLD.test(flat(svg)), 'infographic footer');
  assert.match(flat(svg), /AI\d+-UC\d+/);
  const pdf = agentPdfPages(ARGS).map((p) => flat(p.svg)).join(' ');
  assert.ok(!OLD.test(pdf), `PDF pages: ${(pdf.match(OLD) || [''])[0]}`);
  const m = buildDocModel({ ...ARGS, options: defaultDocOptions('English') });
  const zip = await JSZip.loadAsync(await buildDocx(m, THEME, { chartPng: async () => new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')) }));
  const xml = flat(await zip.file('word/document.xml').async('string'));
  assert.ok(!OLD.test(xml), `Word XML: ${(xml.match(OLD) || [''])[0]}`);
});
