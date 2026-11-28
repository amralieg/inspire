// REQ-586a (T-VAL-DRY-04): closing grep for one value engine. The spec arithmetic and the typed-driver formulas live only in
// app/frontend/src/lib/valueFormula.js; app/backend and app/frontend/src carry no second copy, and the driver path and the
// preview route reach that file. Must-keep: valueFormula.js itself is allowed to hold every pattern.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readFileSync, readdirSync, existsSync } = require('node:fs');

const APP = path.join(__dirname, '../..');
const ENGINE = path.join(APP, 'frontend/src/lib/valueFormula.js');
const SKIP = new Set(['node_modules', 'test', 'dist', 'build']);
function files(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) files(p, out); } else if (/\.(c|m)?jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const SOURCES = [...files(path.join(APP, 'backend')), ...files(path.join(APP, 'frontend/src'))];
const INPUTS = 'events_per_year|people|hours_saved|cost_per_hour|headcount|cost_per_person_year|gain_pct|base_revenue_per_year|uplift_pct|spend_per_year|cut_pct|incidents_per_year|cost_per_incident|reduction_pct';
// Named value-arithmetic patterns: the driver formula table, a driver input multiplied, the legacy hours difference, spec outputs computed.
const PATTERNS = {
  driver_formula_table: /\bconst AMOUNTS\b/,
  driver_input_times: new RegExp(`\\.(${INPUTS})\\b\\s*\\*|\\*\\s*\\w+\\.(${INPUTS})\\b`),
  legacy_hours_difference: /hours_before\s*-\s*[\w.]*hours_after/,
  gross_computed: /gross_(annual|horizon)\s*[:=](?!=)[^,;\n]*[*/]/,
  horizon_times: /horizon_years\s*\*|\*\s*[\w.]*horizon_years/,
  break_even_computed: /break_even_effect\s*[:=](?!=)/,
};
const hits = (re, list) => list.flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => (re.test(l) ? `${path.relative(APP, f)}:${i + 1}: ${l.trim()}` : null)).filter(Boolean));

for (const [name, re] of Object.entries(PATTERNS)) {
  test(`no ${name} outside valueFormula.js`, () => {
    assert.deepEqual(hits(re, SOURCES.filter((f) => f !== ENGINE)), []);
  });
}

test('calculateValue is defined exactly once, in valueFormula.js', () => {
  assert.deepEqual(hits(/function calculateValue\b/, SOURCES).map((h) => h.split(':')[0]), ['frontend/src/lib/valueFormula.js']);
});

test('the driver path and the preview route reach valueFormula.js', () => {
  const calc = path.join(APP, 'backend/lib/valueDriversCalc.js');
  if (existsSync(calc)) assert.match(readFileSync(calc, 'utf8'), /require\([^)]*frontend\/src\/lib\/valueFormula\.js['"]\)/, 'valueDriversCalc.js does not delegate to valueFormula.js');
  assert.match(readFileSync(path.join(APP, 'backend/implementRoutes.js'), 'utf8'), /calculateValue\(/, 'implementRoutes.js never calls calculateValue');
});

test('must-keep: the patterns are real (they match a planted copy of the old driver table)', () => {
  const planted = ["const AMOUNTS = {", "  cost_cut: (i) => (i.spend_per_year * i.cut_pct) / 100,", "  x: (i) => Math.max(0, i.hours_before - i.hours_after),"];
  assert.ok(PATTERNS.driver_formula_table.test(planted[0]));
  assert.ok(PATTERNS.driver_input_times.test(planted[1]));
  assert.ok(PATTERNS.legacy_hours_difference.test(planted[2]));
  assert.ok(PATTERNS.horizon_times.test('const g = annual * spec.horizon_years;'));
  assert.ok(!PATTERNS.gross_computed.test('const g = out.scenarios.base.gross_annual;'), 'reading gross_annual is allowed');
});
