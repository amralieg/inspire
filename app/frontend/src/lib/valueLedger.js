import { stakeShort } from './targetKpi.js';

export const VALUE_CHIP_LIMIT = 3;

export function valueChips(entries, limit = VALUE_CHIP_LIMIT) {
  const sums = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const amount = Number(entry?.amount);
    const unit = String(entry?.unit ?? '').trim();
    const kind = String(entry?.kind ?? '').trim();
    if (!Number.isFinite(amount) || !unit) continue;
    const key = `${kind}\u0000${unit}`;
    sums.set(key, { kind, unit, amount: (sums.get(key)?.amount ?? 0) + amount });
  }
  const all = [...sums.values()]
    .sort((a, b) => b.amount - a.amount || a.unit.localeCompare(b.unit))
    .map((chip) => ({ ...chip, text: stakeShort(chip.amount, { kind: chip.kind, unit: chip.unit }) }));
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

export function valueQuery(db, warehouseId, extra = {}) {
  return new URLSearchParams({ inspire_database: db, warehouse_id: warehouseId, ...extra }).toString();
}
