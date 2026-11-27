// C27 (REQ-564): the infographic is colorful and graph-rich, carries the strategic title and every domain. Fails on 49c0dc3b7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { infographicPagesSvg } from '../src/lib/docgen/docSvg.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { buildAgentModel } from '../src/lib/docgen/agentModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { ARGS, DOMAINS, flat, charts, fills } from './c27x_fixture.mjs';

const m = buildDocModel({ ...ARGS, options: defaultDocOptions('English') });
const pages = infographicPagesSvg(m, resolveTheme('original', 'databricks', '', 'light'), buildAgentModel(ARGS).ranked);

test('C1: page 1 carries the strategic title', () => {
  assert.match(flat(pages[0]), /Strategic AI Use Cases/i);
  assert.match(flat(pages[0]), /Databricks/);
});
test('C2: at least 5 chart types across the infographic', () => {
  const t = new Set(pages.flatMap((p) => charts(p).map((c) => c.type)));
  assert.ok(t.size >= 5, `types: ${[...t]}`);
});
test('C3: every business domain is named', () => {
  const text = pages.map(flat).join(' ');
  for (const d of DOMAINS) assert.ok(text.includes(d), d);
});
test('C4: every infographic page carries at least 2 charts and stays colorful (10+ fills)', () => {
  pages.forEach((p, i) => { assert.ok(charts(p).length >= 2, `page ${i + 1}: ${charts(p).length} charts`); assert.ok(fills(p).size >= 10, `page ${i + 1} fills`); });
});
