// C27 (REQ-561 business-only): a business line (statement, solution, business value, facts, value lines) never prints a column or
// table identifier such as on_hand, forecast_qty or orders.customer_id, in the shared model or in any document kind.
// Fixture: the recorded retail demo (its Business Value lines end with "from on_hand, forecast_qty, ...").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { agentPdfPages } from '../src/lib/docgen/agentPdf.js';
import { buildAgentPptx } from '../src/lib/docgen/agentPptx.js';
import { buildAgentModel } from '../src/lib/docgen/agentModel.js';
import { infographicSvg } from '../src/lib/docgen/docSvg.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';

const show = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(new URL('../../backend/showcase/kinds-retail.json.br', import.meta.url))));
const rows = show.inspire['GET /api/inspire/results?session_id=2001'].body.results.domains.flatMap((d) => d.use_cases);
const ARGS = { businessName: 'Retail', useCases: rows, values: {}, summary: ['Retail sells through stores.'], foundations: [], language: 'English', date: '2026-11-27' };
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const flat = (s) => decode(s.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const SNAKE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b|`[^`]*`|\b[a-z]+\.[a-z]+_[a-z_]+\b/g;
const found = (text) => [...new Set(text.match(SNAKE) || [])];
const theme = resolveTheme('original', 'databricks', '', 'light');

test('the recorded demo has identifiers in its source text (the fixture is meaningful)', () => {
  assert.ok(rows.length >= 10 && rows.some((r) => found(String(r['Business Value'])).length), 'some Business Value line carries a snake_case column');
});

test('the shared model: no business line of any use case carries an identifier', () => {
  const m = buildAgentModel(ARGS);
  assert.equal(m.ranked.length, rows.length);
  const bad = [];
  for (const v of m.ranked) {
    for (const [k, , value] of [...v.narrative, ...v.facts, ...v.metrics, ...v.valueFacts]) {
      const f = found([].concat(value).join(' '));
      if (f.length) bad.push(`${v.id} ${k}: ${f.join(', ')}`);
    }
    const sub = found(v.subtitle); if (sub.length) bad.push(`${v.id} subtitle: ${sub.join(', ')}`);
  }
  assert.deepEqual(bad, []);
});

test('the words stay readable: the stripped business value keeps the words of its columns', () => {
  const v = buildAgentModel(ARGS).ranked.find((x) => /on_hand/.test(String(x.uc['Business Value'])));
  assert.ok(v, 'a use case whose value line names on_hand');
  const text = v.narrative.find((n) => n[0] === 'business_value')[2];
  assert.ok(/on hand/.test(text) && /forecast qty/.test(text), `readable words kept: ${text}`);
});

test('every document kind built from the agent model (PDF, deck, infographic) prints no identifier in a use case line', async () => {
  const pdf = flat(agentPdfPages(ARGS).filter((p) => p.kind === 'cards' || p.kind === 'story').map((p) => p.svg).join(' '));
  assert.deepEqual(found(pdf), [], 'PDF use case pages');
  const zip = await JSZip.loadAsync(await buildAgentPptx(ARGS));
  const slides = [];
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) slides.push([...(await zip.file(f).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]).join(' '));
  assert.deepEqual(found(decode(slides.join(' '))), [], 'deck');
  const model = buildDocModel({ businessName: ARGS.businessName, useCases: rows, values: {}, options: { ...defaultDocOptions('English') }, summary: ARGS.summary, foundations: [] });
  assert.deepEqual(found(flat(infographicSvg(model, theme, buildAgentModel(ARGS).ranked))), [], 'infographic');
});

test('the Word and Excel model (buildDocModel) prints no identifier in a business line', () => {
  const m = buildDocModel({ businessName: 'Retail', useCases: rows, values: {}, summary: [], foundations: [], language: 'English' });
  const keys = ['name', 'statement', 'solution', 'businessValue', 'priorityAlignment', 'strategicAlignment', 'sponsor', 'beneficiary'];
  const bad = m.useCases.flatMap((u) => [...keys.map((k) => u[k]), ...u.kpis, ...u.keyResults, ...u.measures, ...u.financial, ...u.nonFinancial]
    .flatMap((t) => found(String(t ?? '')).map((x) => `${u.id}: ${x}`)));
  assert.deepEqual(bad.slice(0, 8), [], 'no snake_case or table.column in a Word business line');
});
