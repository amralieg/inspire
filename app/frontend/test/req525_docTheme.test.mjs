// REQ-525 (Amr: "you also need to add dark theme or light theme"): resolveTheme takes a fourth argument, the theme ('light' default, 'dark'),
// and every generator draws from it. Light is today's output (must-keep); Dark gives a dark page, light text, and 4.5:1 on every text pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, DOC_STYLES, DOC_PALETTES } from '../src/lib/docgen/docStyles.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { infographicSvg, briefPagesSvg } from '../src/lib/docgen/docSvg.js';
import { buildXlsx } from '../src/lib/docgen/xlsxDoc.js';

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const UCS = [{ No: 'N01-U01', Name: 'Predict delay risk', Statement: 'Cut payouts', Solution: 'Score routes', 'Tables Involved': 'main.ops.flights', inspire_score: '9.1', domain: 'Ops' }];
const model = buildDocModel({ businessName: 'Acme Air', useCases: UCS, values: {}, options: defaultDocOptions('English') });

test('T1: the default theme is light and leaves every style exactly as it is today', () => {
  for (const s of DOC_STYLES) {
    const a = resolveTheme(s.id, 'databricks'); const b = resolveTheme(s.id, 'databricks', '', 'light');
    assert.deepEqual(a, b);
    assert.equal(a.bg, s.bg); assert.equal(a.ink, s.ink); assert.deepEqual(a.accents, s.accents);
  }
  assert.equal(defaultDocOptions('English').theme, 'light');
});

test('T2: dark gives a dark page, light text and at least 4.5:1 on every text pair, for every style and palette', () => {
  for (const s of DOC_STYLES) for (const p of DOC_PALETTES) {
    const t = resolveTheme(s.id, p.id, '', 'dark');
    assert.ok(lum(t.bg) < 0.1 && lum(t.surface) < 0.15, `${s.id}: dark bg and surface`);
    assert.ok(lum(t.ink) > 0.6, `${s.id}: light text`);
    for (const bg of [t.bg, t.surface]) {
      assert.ok(ratio(t.ink, bg) >= 4.5, `${s.id}/${p.id} ink on ${bg}`);
      assert.ok(ratio(t.muted, bg) >= 4.5, `${s.id}/${p.id} muted on ${bg}: ${ratio(t.muted, bg).toFixed(2)}`);
      t.accents.forEach((c, i) => assert.ok(ratio(c, bg) >= 4.5, `${s.id}/${p.id} accent ${i} ${c} on ${bg}: ${ratio(c, bg).toFixed(2)}`));
    }
  }
  const brand = resolveTheme('executive', 'databricks', '#1A1A40', 'dark');
  assert.ok(ratio(brand.accents[0], brand.surface) >= 4.5, 'a dark brand colour is lifted to stay readable');
});

test('T3: the dark infographic and brief pages use the dark background; light output is unchanged', () => {
  const lightA = infographicSvg(model, resolveTheme('executive', 'databricks'));
  const lightB = infographicSvg(model, resolveTheme('executive', 'databricks', '', 'light'));
  assert.equal(lightA, lightB);
  assert.ok(lightA.includes('fill="#FFFFFF"'), 'light executive page is white');
  const dark = resolveTheme('executive', 'databricks', '', 'dark');
  const svg = infographicSvg(model, dark);
  assert.ok(svg.includes(`<rect width="1200" height="`) && svg.includes(`fill="${dark.bg}"`), 'dark page background');
  assert.ok(!svg.includes('fill="#FFFFFF"/><'), 'no white page');
  assert.ok(briefPagesSvg(model, dark).every((p) => p.includes(`fill="${dark.bg}"`)));
});

test('T4: the Excel header follows the theme, the cells stay on the plain white sheet', async () => {
  const JSZip = (await import('node:module')).createRequire(import.meta.url)('jszip');
  const styles = async (theme) => {
    const blob = await buildXlsx(model, ['name', 'value'], theme);
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    return (await zip.file('xl/styles.xml').async('string')).toUpperCase();
  };
  const light = await styles(resolveTheme('executive', 'databricks'));
  assert.ok(light.includes('1B3139'), 'light header fill is as today');
  const dark = resolveTheme('midnight', 'databricks', '', 'dark');
  const d = await styles(dark);
  assert.ok(d.includes(dark.headFill.replace('#', '').toUpperCase()), 'dark header fill comes from the theme');
  assert.ok(!d.includes(dark.bg.replace('#', '').toUpperCase()) || dark.headFill === dark.bg, 'no dark fill on the cells');
});
