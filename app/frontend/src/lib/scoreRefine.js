// REQ-433: when a lower-scored use case is worth at least 1.5x a higher-scored one (same currency or unit, same run), its score is
// raised to just above the higher one (higher score + 0.05, 2 decimals, capped at 10) so the order follows the value.
export const REFINE_RATIO = 1.5;
const STEP = 0.05;
const round2 = (n) => Math.round(n * 100) / 100;
const keyOf = (e) => `${e.kind || ''}|${e.unit || ''}`;

function valuesOf(entries) {
  const map = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    const amount = Number(e?.amount);
    if (Number.isFinite(amount) && amount > 0) map.set(keyOf(e), (map.get(keyOf(e)) || 0) + amount);
  }
  return map;
}

// The ratio of x to y on the first shared currency or unit, or 0 when they share none.
function ratioOf(x, y) {
  let best = { ratio: 0, key: '', lower: 0, higher: 0 };
  for (const [k, v] of x) if (y.has(k) && v / y.get(k) > best.ratio) best = { ratio: v / y.get(k), key: k, lower: v, higher: y.get(k) };
  return best;
}

// Only pairs with the same `tier` are compared: the Results order puts the quality bar and Best of Best before the score.
export function refineScores(items) {
  const rows = (Array.isArray(items) ? items : [])
    .map((it) => ({ ...it, values: valuesOf(it.entries), start: Number(it.score), now: Number(it.score) }))
    .filter((r) => r.values.size && Number.isFinite(r.start));
  const total = (r) => Math.max(...r.values.values());
  const order = [...rows].sort((a, b) => total(a) - total(b));
  const pairs = [];
  for (const x of order) {
    let target = x.now;
    let beat = null;
    for (const y of rows) {
      if (y === x || y.now < x.now) continue;
      if ((x.tier ?? '') !== (y.tier ?? '')) continue; // different sort tiers: the score never decides their order
      const found = ratioOf(x.values, y.values);
      if (found.ratio >= REFINE_RATIO - 1e-9 && y.now + STEP > target) { target = y.now + STEP; beat = { y, ...found }; }
    }
    if (beat && round2(target) > x.now) {
      x.now = Math.min(10, round2(target));
      if (x.now > x.start) { const [kind, unit] = beat.key.split('|'); pairs.push({ lower: x, higher: beat.y, ratio: beat.ratio, kind, unit, lowerAmount: beat.lower, higherAmount: beat.higher }); }
    }
  }
  const changes = rows.filter((r) => r.now !== r.start).map((r) => ({ id: r.id, from: r.start, to: r.now }));
  return { changes, pairs: pairs.filter((p) => p.lower.now !== p.lower.start) };
}

// REQ-433: the scores shown for the cards: a refined score replaces the first one and remembers it for the tooltip.
export function withRefinedScores(useCases, refined, idOf) {
  const keys = Object.keys(refined || {});
  if (!keys.length) return useCases;
  return useCases.map((uc) => {
    const entry = refined[idOf(uc)];
    if (!entry) return uc;
    if (entry.undone) return { ...uc, inspire_score: entry.from, refined_from: undefined };
    return { ...uc, inspire_score: entry.to, refined_from: entry.from };
  });
}

export const scoreText = (n) => { const r = Math.round(Number(n) * 100) / 100; return Number.isInteger(r) ? r.toFixed(1) : String(r); };
export const ratioText = (r) => `${Math.round(r * 10) / 10}x`;
export const refineReason = (pair, ratio) => `Refined so the order follows the value: ${pair.lower.name} is worth ${ratio} ${pair.higher.name}.`;
