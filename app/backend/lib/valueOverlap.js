// REQ-454: the same pool of money is counted once. Each value carries one key per part it is made of; within a key one use case is counted.
// Keys are plain strings, so they work for one run and across runs. Pure: no SQL.
const RANK = { measured: 3, calculated: 2, estimated: 1 };

const tableName = (t) => String(t || '').replace(/`/g, '').trim().toLowerCase();
const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
};

// A saved shape-2 value: one key per part. [{ key, amount }] or null when the plan names no table.
function savedKeys(saved, currency) {
  const plan = saved && saved.answers && saved.answers.plan;
  const parts = saved && saved.yearly && Array.isArray(saved.yearly.parts) ? saved.yearly.parts : [];
  const table = tableName(plan && plan.table);
  if (!table || !parts.length) return null;
  const answers = saved.answers;
  const excluded = new Set(Array.isArray(answers.excluded_groups) ? answers.excluded_groups.map(String) : []);
  const groups = (Array.isArray(plan.groups) ? plan.groups : []).map((g) => String(g.g)).filter((g) => !excluded.has(g)).sort();
  const pct = Number(saved.yearly.attribution_pct ?? answers.attribution_pct ?? 100);
  const share = Number.isFinite(pct) ? pct / 100 : 1;
  return parts.filter((p) => Number.isFinite(Number(p.amount))).map((p) => ({
    key: [currency, table, canonical(plan.case_filter ?? null), canonical(groups), p.id].join('|'), amount: Number(p.amount) * share,
  }));
}

// A rule estimate: one whole key (the same rule over the same baseline is the same money).
const estimateKeys = (estimate, currency, amount) => (estimate && estimate.app !== undefined && estimate.per_record !== undefined && estimate.baseline !== undefined
  ? [{ key: `${currency}|rule:${estimate.app}|${estimate.per_record}|${estimate.baseline}`, amount }] : null);

// A whole value over a known table (measured, or a saved value without parts).
const wholeKeys = (table, verb, signature, currency, amount) => (tableName(table) ? [{ key: [currency, tableName(table), verb, signature].join('|'), amount }] : null);

// items: [{ id, status, currency, amount, keys: [{ key, amount }] | null }] -> Map item -> { counted: amount counted, wins: n of keys won,
// shared: [other ids], with: id of the winner of its first lost key }. An item with no keys is counted whole.
function dedupe(items) {
  const best = new Map();
  const better = (a, b) => {
    if (RANK[a.item.status] !== RANK[b.item.status]) return RANK[a.item.status] > RANK[b.item.status];
    if (a.amount !== b.amount) return a.amount > b.amount;
    return String(a.item.id) < String(b.item.id);
  };
  const members = new Map();
  for (const item of items) {
    for (const k of item.keys || []) {
      const mine = { item, amount: k.amount };
      const cur = best.get(k.key);
      if (!cur || better(mine, cur)) best.set(k.key, mine);
      if (!members.has(k.key)) members.set(k.key, []);
      members.get(k.key).push(item);
    }
  }
  const out = new Map();
  for (const item of items) {
    if (!item.keys || !item.keys.length) { out.set(item, { counted: item.amount, shared: [], with: null, keyed: false }); continue; }
    let counted = 0;
    const shared = new Set();
    let withId = null;
    for (const k of item.keys) {
      const win = best.get(k.key);
      if (win.item === item) {
        counted += k.amount;
        for (const other of members.get(k.key)) if (other !== item) shared.add(other.id);
      } else if (!withId) withId = win.item.id;
    }
    out.set(item, { counted, shared: [...shared].sort(), with: withId, keyed: true });
  }
  return out;
}

module.exports = { savedKeys, estimateKeys, wholeKeys, dedupe, tableName };
