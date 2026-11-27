import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// REQ-569 (UI side, showcase): the demo files keep the stored Nx-Ux ids (never rewritten); the demo answers print AIx-UCx in sentences.
// Stored ids (an id on its own, a URL or path) stay as recorded, because the shell sends them back as lookups.
const require = createRequire(import.meta.url);
const S = require('../../../backend/lib/showcase.js');
const OLD = /\bN\d+-U\d+\b/;

test('showcase answers show sentences with the new id form and keep stored ids and paths', () => {
  const shown = S.showcaseDisplay({
    id: 'N01-U02',
    reason: 'Duplicate of N03-U01 and N03-U02.',
    app_url: '/showcase/kinds-retail/mvp/N01-U02/',
    nested: [{ note: 'Built by N05-U01', use_case_id: 'N05-U01' }],
    count: 3,
  });
  assert.equal(shown.id, 'N01-U02');
  assert.equal(shown.reason, 'Duplicate of AI03-UC01 and AI03-UC02.');
  assert.equal(shown.app_url, '/showcase/kinds-retail/mvp/N01-U02/');
  assert.equal(shown.nested[0].note, 'Built by AI05-UC01');
  assert.equal(shown.nested[0].use_case_id, 'N05-U01');
  assert.equal(shown.count, 3);
});

test('every sentence a demo answers with has no old id in it', () => {
  for (const [id, bundle] of Object.entries(S.loadShowcases())) {
    const sentences = [];
    const walk = (v) => {
      if (typeof v === 'string') { if (OLD.test(v) && !/^N\d+-U\d+$/.test(v) && !/\/N\d+-U\d+/.test(v)) sentences.push(v.slice(0, 60)); }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(S.showcaseDisplay(bundle.inspire));
    assert.deepEqual(sentences, [], `${id} prints an old id in a sentence`);
  }
});

// The sweep after the first pass: fallback names and the demo page names print the new form.
import { readFileSync } from 'node:fs';
import { holderNames, mergeTargetText } from '../../src/lib/implementWizard.js';
import { demoRunPages } from '../../src/lib/runPages.js';

test('fallback names built from an old stored id print the new form', () => {
  assert.deepEqual(holderNames([{ use_case_id: 'N01-U02' }, { name: 'Forecast', use_case_id: 'N01-U03' }]), ['AI01-UC02', 'Forecast']);
  assert.ok(!OLD.test(mergeTargetText({ use_cases: [{ use_case_id: 'N02-U01' }] })));
  const [page] = demoRunPages({ business: 'b', mvps: [{ id: 'N01-U01', url: '/showcase/kinds-retail/mvp/N01-U01/' }] });
  assert.equal(page.name, 'AI01-UC01');
  assert.equal(page.use_case_id, 'N01-U01');
  assert.match(readFileSync(new URL('../../src/components/BuildNext.jsx', import.meta.url), 'utf8'), /\|\| displayId\(another\.next\[0\]\.id\)/);
});
