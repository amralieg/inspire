import { stakeShort } from './targetKpi.js';

export const VALUE_CHIP_LIMIT = 3;
// REQ-480: a money value at stake of 20,000,000 or more reads "<symbol>20M+" in every currency. The stored number does not change. Every value
// component shows money through valueChips (moneyText included), so this is the one place the cap lives.
export const VALUE_DISPLAY_CAP = 20000000;
const chipText = (chip) => (chip.kind === 'money' && chip.amount >= VALUE_DISPLAY_CAP ? `${stakeShort(VALUE_DISPLAY_CAP, chip)}+` : stakeShort(chip.amount, chip));

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
    .map((chip) => ({ ...chip, text: chipText(chip) }));
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

export function valueQuery(db, warehouseId, extra = {}) {
  return new URLSearchParams({ inspire_database: db, warehouse_id: warehouseId, ...extra }).toString();
}
