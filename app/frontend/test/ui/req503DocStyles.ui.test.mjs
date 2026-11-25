// REQ-503 item 10 (Amr: "allow the user to choose a style, colours and see a preview"): StylePage (GenerateDocsPages.jsx:94-124) lets the
// person pick one of 8 styles, a palette or a brand colour, and generateDocs.js:54-69 passes that theme to every file. fx113DocGen checks
// the infographic per style; this checks the deck (pptx) and the brief pages (PDF source) also follow the chosen style and brand colour.
// Coverage for shipped code, passes on 0289c7e85. Must-fail probe: if buildPptx or briefPagesSvg ignored the theme, D1 and D2 fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolveTheme } from '../../src/lib/docgen/docStyles.js';
import { defaultDocOptions } from '../../src/lib/docgen/docOptions.js';
import { buildDocModel } from '../../src/lib/docgen/docModel.js';
import { briefPagesSvg } from '../../src/lib/docgen/docSvg.js';
import { buildPptx } from '../../src/lib/docgen/pptxDoc.js';

const JSZip = createRequire(import.meta.url)('jszip');
const UCS = [
  { No: 'N01-U01', Name: 'Predict delay risk per route', Statement: 'Cut payouts', Solution: 'Score routes', 'Business Value': 'Fewer payouts',
    'Tables Involved': 'main.ops.flights', Subdomain: 'Operations', inspire_score: '9.1', domain: 'Operations' },
];
const model = buildDocModel({ businessName: 'Acme Air', useCases: UCS, values: {}, options: defaultDocOptions('English') });
const slidesXml = async (theme) => {
  const zip = await JSZip.loadAsync(await buildPptx(model, theme));
  const files = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  return (await Promise.all(files.map((f) => zip.file(f).async('string')))).join('\n').toUpperCase();
};
const pages = (theme) => briefPagesSvg(model, theme).join('\n').toUpperCase();
const MIDNIGHT = resolveTheme('midnight', 'databricks');
const BLUEPRINT = resolveTheme('blueprint', 'databricks');

test('D1: the deck takes the chosen style background; another style gives another deck', async () => {
  const a = await slidesXml(MIDNIGHT);
  const b = await slidesXml(BLUEPRINT);
  assert.ok(a.includes('0F2027') && !a.includes('EAF2FB'), 'Midnight deck uses the Midnight background only');
  assert.ok(b.includes('EAF2FB') && !b.includes('0F2027'), 'Blueprint deck uses the Blueprint background only');
});

test('D2: the brief pages take the chosen style background', () => {
  const a = pages(MIDNIGHT);
  const b = pages(BLUEPRINT);
  assert.ok(a.includes('#0F2027') && !a.includes('#EAF2FB'), 'Midnight pages');
  assert.ok(b.includes('#EAF2FB') && !b.includes('#0F2027'), 'Blueprint pages');
});

test('D3: a brand colour reaches the deck and the brief pages; without it, it is absent', async () => {
  const brand = resolveTheme('executive', 'databricks', '#12AB34');
  const plain = resolveTheme('executive', 'databricks');
  assert.ok((await slidesXml(brand)).includes('12AB34'), 'brand colour in the deck');
  assert.ok(pages(brand).includes('#12AB34'), 'brand colour in the pages');
  assert.ok(!(await slidesXml(plain)).includes('12AB34') && !pages(plain).includes('#12AB34'), 'no brand colour, none drawn');
});
