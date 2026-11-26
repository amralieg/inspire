// RC7-B-08 remainder (T-DOC-03 / T-DOC-09 "never cut"): a 90-character use case name and a 700-character description show in full in the valued and
// the no-value infographic, the brief (page 1 and the use case pages) and the deck, in all four designs and both modes. The renderer adds no "..." or "…".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { infographicSvg, briefPagesSvg } from '../src/lib/docgen/docSvg.js';
import { buildPptx } from '../src/lib/docgen/pptxDoc.js';

const raw = JSON.parse(fs.readFileSync(new URL('../../agent/demos/bakehouse/docs/Samples bakehouse-dbx_inspire.json', import.meta.url), 'utf8'));
const word = (p, n) => Array.from({ length: n }, (_, i) => `${p}${String(i + 1).padStart(3, '0')}`);
const NAME = word('nm', 13).join(' ').padEnd(90, 'x').slice(0, 90); // 90 characters, no ellipsis in it
const DESC = word('ds', 100).join(' ').slice(0, 700).replace(/\s\S*$/, ''); // about 700 characters
const UCS = raw.domains.flatMap((d) => d.use_cases.map((u) => ({ ...u, domain: d.domain_name }))).slice(0, 3).map((u, i) => (i === 0 ? { ...u, 'Use Case Name': NAME, Name: NAME, usecase: NAME, Statement: DESC, Solution: DESC, 'Business Value': DESC } : u));
const IDS = ['original', 'editorial_ink', 'bold', 'consulting'];
const YEARLY = [1, 2, 3].map((year) => ({ year, low: 1000 * year, likely: 2000 * year, high: 3000 * year }));
const VALUES = Object.fromEntries(UCS.map((u, i) => [u.No, { amount: 90000 + i * 40000, currency: 'USD', status: 'estimated', verb: 'GROW REVENUE', story: 'It pays back.', yearly: YEARLY, factors: [] }]));
const options = { ...defaultDocOptions('English'), blocks: ['use_case_story', 'value_story', 'value_projection', 'data_used', 'inspire_score', 'disclaimer'] };
const docOf = (valued) => buildDocModel({ businessName: 'Acme Bakes', useCases: UCS, values: valued ? VALUES : {}, options });
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const svgText = (svg) => decode([...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].map((x) => [...x[1].matchAll(/<tspan[^>]*>(.*?)<\/tspan>/gs)].map((s) => s[1]).join(' ') || x[1]).join(' \n ')).replace(/\s+/g, ' ');
const check = (label, text) => {
  assert.ok(!/\.\.\.|…/.test(text), `${label}: no ellipsis`);
  assert.ok(text.includes(NAME), `${label}: the 90-character name is in full`);
  assert.ok(text.includes(DESC), `${label}: the 700-character description is in full`);
};

for (const id of IDS) for (const mode of ['light', 'dark']) {
  const theme = resolveTheme(id, 'databricks', '', mode);
  for (const valued of [false, true]) {
    test(`W1 ${id}/${mode} ${valued ? 'valued' : 'no value'}: the infographic shows the name and the description in full`, () => {
      const t = svgText(infographicSvg(docOf(valued), theme));
      assert.ok(!/\.\.\.|…/.test(t), 'no ellipsis');
      assert.ok(t.includes(DESC), 'description in full');
      assert.ok(t.includes(NAME), 'name in full');
    });
    test(`W2 ${id}/${mode} ${valued ? 'valued' : 'no value'}: the brief pages show every text in full`, () => {
      const pages = briefPagesSvg(docOf(valued), theme);
      check('brief', pages.map(svgText).join(' '));
    });
    test(`W3 ${id}/${mode} ${valued ? 'valued' : 'no value'}: the deck shows every text in full`, async () => {
      const zip = await JSZip.loadAsync(await buildPptx(docOf(valued), theme));
      const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
      let all = '';
      for (const f of slides) all += ` ${[...(await zip.file(f).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => decode(x[1])).join(' ')}`;
      all = all.replace(/\s+/g, ' ');
      check('deck', all);
    });
  }
}
