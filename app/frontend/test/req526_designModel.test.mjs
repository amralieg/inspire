// REQ-526 step 1: toDesignModel maps buildDocModel() output onto the shape the four document designs read, using real fields only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { moneyText } from '../src/lib/valueWizard.js';
import { toDesignModel, DESIGNS, designOf } from '../src/lib/docgen/designs/model.js';

const FIXTURE = new URL('../../agent/demos/bakehouse/docs/Samples bakehouse-dbx_inspire.json', import.meta.url);
const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const UCS = raw.domains.flatMap((d) => d.use_cases.map((u) => ({ ...u, domain: d.domain_name })));
const VALUED = UCS.slice(0, 20);
const VERBS = ['GROW REVENUE', 'AVOID RISK', 'CUT COST'];
const values = Object.fromEntries(VALUED.map((u, i) => [u.No, { amount: 40000 + i * 12500, currency: 'USD', status: i % 2 ? 'calculated' : 'estimated', verb: VERBS[i % 3], story: '', yearly: [], factors: [] }]));
const options = { ...defaultDocOptions('English'), blocks: ['value_story', 'disclaimer'] };
const doc = () => buildDocModel({ businessName: 'Acme Bakes', useCases: UCS, values, options });
const sum = VALUED.reduce((s, u) => s + values[u.No].amount, 0);

test('M1: totals equal the sum of the real values and use the App money text', () => {
  const m = toDesignModel(doc());
  assert.equal(m.total.amount, sum);
  assert.equal(m.total.text, moneyText('USD', sum));
  assert.equal(m.total.n, UCS.length);
  assert.equal(m.total.nWithValue, VALUED.length);
  assert.equal(m.total.nDomains, m.domains.length);
  assert.equal(m.domains.reduce((s, d) => s + d.value, 0), sum);
  assert.equal(m.verbs.reduce((s, v) => s + v.value, 0), sum);
});

test('M2: a use case without a value is not counted and is left out of every value chart', () => {
  const m = toDesignModel(doc());
  const ids = new Set(m.useCases.map((u) => u.id));
  assert.equal(m.useCases.length, VALUED.length);
  for (const u of UCS.slice(20)) assert.ok(!ids.has(u.No), `${u.No} has no value`);
  assert.deepEqual(m.ranked.map((u) => u.value.amount), [...VALUED].map((u) => values[u.No].amount).sort((a, b) => b - a));
  const none = toDesignModel(buildDocModel({ businessName: 'Acme Bakes', useCases: UCS, values: {}, options }));
  assert.equal(none.useCases.length, 0); assert.equal(none.total.nWithValue, 0); assert.equal(none.total.amount, 0);
  assert.deepEqual(none.verbs, []); assert.deepEqual(none.domains, []);
});

test('M3: no field is invented (value, verb, quality, score, text all come from the input)', () => {
  const m = toDesignModel(doc());
  for (const u of m.useCases) {
    const src = UCS.find((x) => x.No === u.id);
    assert.equal(u.value.amount, values[u.id].amount);
    assert.equal(u.value.text, moneyText('USD', values[u.id].amount));
    assert.equal(u.verb, values[u.id].verb);
    assert.equal(u.quality, src.Quality);
    assert.equal(u.score, Number(src['Inspire Score']));
    assert.equal(u.sponsor, src.Sponsor);
    assert.equal(u.name, src.Name);
  }
  assert.deepEqual(new Set(m.verbs.map((v) => v.name)), new Set(VERBS));
  assert.equal(m.executiveSummary, ''); // the App has no executive summary field
  const noVerb = toDesignModel(buildDocModel({ businessName: 'A', useCases: UCS, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { ...v, verb: undefined }])), options }));
  assert.deepEqual(noVerb.verbs, []); assert.ok(noVerb.useCases.every((u) => u.verb === ''));
  for (const q of m.quality) assert.ok(UCS.some((u) => u.Quality === q.name));
  assert.equal(m.quality.reduce((s, q) => s + q.n, 0), m.useCases.filter((u) => u.quality).length);
});

test('M4: blocks, language and direction are carried through', () => {
  const m = toDesignModel(doc());
  assert.deepEqual(m.blocks, ['value_story', 'disclaimer']);
  assert.equal(m.businessName, 'Acme Bakes'); assert.equal(m.language, 'English'); assert.equal(m.rtl, false);
  const ar = toDesignModel(buildDocModel({ businessName: 'A', useCases: UCS, values, options: { ...options, languages: ['Arabic'] } }));
  assert.equal(ar.rtl, true);
});

test('M5: the registry holds the four designs under the App ids; old styles have none', () => {
  assert.deepEqual(Object.keys(DESIGNS), ['original', 'editorial_ink', 'bold', 'consulting']);
  assert.equal(designOf('bold').id, 'c_bold');
  assert.equal(designOf('editorial_ink').id, 'b_editorial');
  assert.equal(designOf('original').id, 'a_original');
  assert.equal(designOf('consulting').id, 'd_consulting');
  for (const old of ['midnight', 'editorial', 'gold', 'nope', undefined]) assert.equal(designOf(old), null);
});
