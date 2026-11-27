// C27 (REQ-564, Amr 27 Nov: "MAKE THE PDF colorful, exciting, with tons of graph that are different per use case, or depends on the
// use case"; "execu summary very short, not in own page, no domains list, what it is for"). Fails on 49c0dc3b7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPdfPages } from '../src/lib/docgen/agentPdf.js';
import { ARGS, ROWS, DOMAINS, IDS, flat, words, charts } from './c27x_fixture.mjs';
import { sameUseCaseId } from '../../shared/useCaseId.mjs';

const pages = agentPdfPages(ARGS);
const all = pages.map((p) => p.svg).join('\n');

test('A1: the executive summary has its own page, at least 180 words, and a chart', () => {
  const exec = pages.filter((p) => /Executive Summary/i.test(flat(p.svg)));
  assert.ok(exec.length >= 1, 'an executive summary page');
  const p = exec.find((x) => !/Contents/.test(flat(x.svg).slice(0, 200))) || exec[0];
  assert.ok(!/How to read this catalog|Portfolio at a glance/.test(flat(p.svg)), 'no other section on the summary page');
  assert.ok(words(p.svg) >= 180, `summary words ${words(p.svg)} >= 180`);
  assert.ok(charts(p.svg).length >= 1, 'the summary page has a chart');
});

test('A2: a "What this catalog is for" page', () => {
  assert.ok(pages.some((p) => /data-section="purpose"/.test(p.svg) && /What this catalog is for/i.test(flat(p.svg))));
});

test('A3: a domains list page names every business domain', () => {
  const p = pages.find((x) => /data-section="domains-list"/.test(x.svg));
  assert.ok(p, 'a domains-list page');
  for (const d of DOMAINS) assert.ok(flat(p.svg).includes(d), `lists ${d}`);
});

test('A4: every use case has at least 2 charts, the chart types depend on the use case, 6+ types in all', () => {
  const list = charts(all);
  const byUc = new Map(IDS.map((id) => [id, list.filter((c) => sameUseCaseId(c.uc, id)).map((c) => c.type)]));
  for (const [id, types] of byUc) assert.ok(types.length >= 2, `${id} has ${types.length} charts`);
  const first = new Map(IDS.map((id) => [id, byUc.get(id)[0]]));
  const tech = new Map(ROWS.map((r) => [String(r.No), String(r['Analytics Technique'])]));
  for (const a of IDS) for (const b of IDS) if (tech.get(a) === tech.get(b)) assert.equal(first.get(a), first.get(b), `${a} and ${b} share a technique`);
  assert.ok(new Set(first.values()).size >= 6, `lead chart types: ${[...new Set(first.values())]}`);
  assert.ok(new Set(list.map((c) => c.type)).size >= 8, `chart types overall: ${[...new Set(list.map((c) => c.type))]}`);
});

test('A5: the PDF stays readable in length (at most 70 pages)', () => {
  assert.ok(pages.length <= 70, `${pages.length} pages`);
});
