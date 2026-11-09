export const DROPPED_GROUP_TITLE = 'Dropped by quality gates';
export const DROPPED_GROUP_NOTE = 'Inspire left these out of the catalog because each scored below 3 out of 10 on one quality check. They are not counted in the figures and are not in any download.';

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const scoreText = (value) => String(Math.round(value * 10) / 10);

export function qualityGateDropsOf(results) {
  const list = results && typeof results === 'object' && Array.isArray(results.quality_gate_drops) ? results.quality_gate_drops : [];
  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const name = String(item.name ?? '').trim();
    const gate = String(item.gate ?? '').trim();
    if (!name || !gate) return [];
    const gateName = String(item.gate_name ?? '').trim() || 'quality check';
    const gateScore = finite(item.gate_score);
    const where = [item.domain, item.subdomain].map((v) => String(v ?? '').trim()).filter(Boolean).join(' · ');
    const reason = gateScore == null
      ? `It failed the ${gateName}.`
      : `It scored ${scoreText(gateScore)} out of 10 on the ${gateName}, below the 3 every use case needs.`;
    return [{ key: String(item.no ?? '').trim() || name, no: String(item.no ?? '').trim(), name, where, gate, gateName, gateScore, reason }];
  });
}
