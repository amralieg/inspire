// C28 (REQ-564 follow-ups): the new charts and story pages speak the document's language, and the style preview draws the new infographic.
// Fails on 828887858.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { agentPdfPages } from '../src/lib/docgen/agentPdf.js';
import { labelKeys } from '../src/lib/docgen/docLabels.js';
import { textsToTranslate } from '../src/lib/generateDocs.js';
import { ARGS, ROWS, DOMAINS, flat } from './c27x_fixture.mjs';

// Every chart title the new charts print (ucCharts.js, scoreInfographic.js).
const TITLES = ['Forecast with its range', 'Survival with action', 'Risk: who to act on first', 'Readiness gauge', 'Today against optimized',
  'From today to the target', 'Segments in the data', 'Clusters by size', 'Ranked recommendations', 'Outliers to review', 'Hubs and their links',
  'Impact of the change', 'What drives the change', 'Against its peers', 'Location heat map', 'Where work drops off', 'Ask, reason, answer',
  'Score profile', 'Scores as rings', 'Value by year', 'The portfolio by business domain', 'Quality mix', 'Top opportunities by Inspire Score',
  'Priority against readiness', 'Analytics techniques', 'Every use case at a glance', 'Use cases by domain'];

// A stand-in translation: every text becomes Arabic with its {n} holes kept, so any English left in the PDF was never translated.
const AR_WORD = 'ترجمة';
const translatedOf = (texts) => Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, [AR_WORD, ...(String(v).match(/\{\d+\}/g) || [])].join(' ')]));
const AR = translatedOf(textsToTranslate(ROWS, {}, ARGS.summary));
const ar = agentPdfPages({ ...ARGS, language: 'Arabic', translated: AR });
const arAll = flat(ar.map((p) => p.svg).join('\n'));

test('F1: every new chart title is a translated document label', () => {
  const keys = new Set(labelKeys());
  const missing = TITLES.filter((t) => !keys.has(t));
  assert.deepEqual(missing, [], `not in DOC_LABELS: ${missing.join(' | ')}`);
});

test('F2: an Arabic PDF prints no chart title in English', () => {
  const left = TITLES.filter((t) => new RegExp(`(^|[^A-Za-z])${t.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`).test(arAll));
  assert.deepEqual(left, [], `English chart titles in the Arabic PDF: ${left.join(' | ')}`);
});

test('F3: an Arabic PDF keeps the purpose page, translated', () => {
  const p = ar.find((x) => /data-section="purpose"/.test(x.svg));
  assert.ok(p, 'a purpose page in the Arabic PDF');
  assert.ok(flat(p.svg).includes(AR_WORD), 'the purpose page is translated');
  assert.ok(!/What this catalog is for/.test(flat(p.svg)), 'no English purpose title');
});

test('F4: an Arabic PDF domains list gives every domain a translated description', () => {
  const p = ar.find((x) => /data-section="domains-list"/.test(x.svg));
  assert.ok(p, 'a domains-list page');
  const descs = [...p.svg.matchAll(/class="dd"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => flat(m[1]));
  assert.equal(descs.length, DOMAINS.length, `one row per domain (${descs.length} of ${DOMAINS.length})`);
  for (const d of descs) assert.ok(d.length > 0 && d.includes(AR_WORD), `a translated description, got "${d}"`);
});

test('F5: the style preview and its thumbnails draw the infographic with the use case views (the new layout)', () => {
  const src = fs.readFileSync(new URL('../src/components/GenerateDocsDialog.jsx', import.meta.url), 'utf8');
  const calls = [...src.matchAll(/infographicSvg\(m, resolveTheme\([^)]*\)([^)]*)\)/g)];
  assert.ok(calls.length >= 2, `preview + thumbnails call infographicSvg (${calls.length})`);
  for (const c of calls) assert.match(c[1], /^,\s*\S/, `a views argument: infographicSvg(m, resolveTheme(...)${c[1]})`);
});
