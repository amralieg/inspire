export const COMPARE_MAX = 4;

export function toggleCompared(list, id) {
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length >= COMPARE_MAX ? list : [...list, id];
}

export function compareRows(scenario, picked, now = {}) {
  const live = (key) => picked.map((s) => now[s.id]?.outcome?.[key] ?? null);
  const label = scenario?.outcome?.label || 'Outcome';
  const rows = [
    { id: 'saved_p50', label: `${label} P50 when saved`, kind: 'outcome', live: false, values: picked.map((s) => s.outcome?.p50 ?? null) },
    { id: 'p10', label: `${label} P10 today`, kind: 'outcome', live: true, values: live('p10') },
    { id: 'p50', label: `${label} P50 today`, kind: 'outcome', live: true, values: live('p50') },
    { id: 'p90', label: `${label} P90 today`, kind: 'outcome', live: true, values: live('p90') },
  ];
  if (scenario?.outcome?.target != null || picked.some((s) => now[s.id]?.outcome?.prob_target != null)) {
    rows.push({ id: 'prob_target', label: 'Chance of reaching the target today', kind: 'share', live: true, values: live('prob_target') });
  }
  for (const lever of scenario?.levers || []) {
    rows.push({ id: `lever:${lever.lever}`, label: lever.label || lever.lever, kind: 'lever', live: false, format: lever.format, currency: lever.currency,
      values: picked.map((s) => s.levers?.[lever.lever] ?? null) });
  }
  return rows;
}

export function decisionCounts(data) {
  const saved = data?.scenarios || [];
  return { mine: data?.mine || 0, shared: saved.filter((s) => s.shared).length, decisions: (data?.decisions || []).length };
}
