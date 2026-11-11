import { IMPLEMENT_DONE_STATUSES } from './implementWizard.js';
import { fieldOf, inspireScoreFromUc, nameOfUseCase, trackingIdOf } from './useCaseFields.js';
import { parseJson, v130View } from './v130UseCase.js';

export const NEXT_LIST_COUNT = 3;
export const NEXT_STEP_COUNT = 2;

const normalTable = (name) => String(name || '').replace(/`/g, '').trim().toLowerCase();

export function estimateOf(uc) {
  const parsed = parseJson(fieldOf(uc, 'Value Estimate', 'value_estimate'));
  const estimate = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const high = Number(estimate.value_high);
  if (estimate.status !== 'measured' || !Number.isFinite(high) || high <= 0) return null;
  return { high, currency: String(estimate.currency || '').trim() };
}

function tablesOf(uc) {
  const tables = v130View(uc).dataEvidence?.tables || {};
  return Object.keys(tables).map(normalTable).filter(Boolean);
}

export function buildItems(useCases, statusById = {}) {
  return (useCases || [])
    .map((uc) => {
      const id = trackingIdOf(uc);
      return {
        id,
        uc,
        name: nameOfUseCase(uc),
        est: estimateOf(uc),
        score: inspireScoreFromUc(uc),
        starred: v130View(uc).bestOfBest != null,
        built: IMPLEMENT_DONE_STATUSES.includes(String(statusById[id] || '')),
        tables: tablesOf(uc),
      };
    })
    .filter((row) => row.id);
}

function primaryCurrency(rows) {
  const totals = {};
  for (const row of rows) if (row.est) totals[row.est.currency] = (totals[row.est.currency] || 0) + row.est.high;
  return Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const byValue = (primary) => (a, b) => {
  if (Boolean(a.est) !== Boolean(b.est)) return a.est ? -1 : 1;
  if (a.est && b.est) {
    const aPrimary = a.est.currency === primary;
    const bPrimary = b.est.currency === primary;
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
    if (a.est.high !== b.est.high) return b.est.high - a.est.high;
  }
  const aScore = a.score ?? -1;
  const bScore = b.score ?? -1;
  if (aScore !== bScore) return bScore - aScore;
  if (a.starred !== b.starred) return a.starred ? -1 : 1;
  return a.id.localeCompare(b.id, 'en', { numeric: true });
};

export function progressOf(rows) {
  const stake = {};
  let live = 0;
  for (const row of rows) {
    if (!row.built) continue;
    live += 1;
    if (row.est) stake[row.est.currency] = (stake[row.est.currency] || 0) + row.est.high;
  }
  const atStake = Object.entries(stake).map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount);
  return { total: rows.length, live, atStake };
}

export function buildNextOf(rows) {
  const ranked = rows.filter((row) => !row.built).sort(byValue(primaryCurrency(rows)));
  return { ...progressOf(rows), next: ranked.slice(0, NEXT_LIST_COUNT) };
}

export function nextSharingTables(rows, focusId, count = NEXT_STEP_COUNT) {
  const focus = rows.find((row) => row.id === focusId);
  if (!focus || !focus.tables.length) return [];
  const mine = new Set(focus.tables);
  return rows
    .filter((row) => !row.built && row.id !== focusId)
    .map((row) => ({ ...row, shared: row.tables.filter((table) => mine.has(table)) }))
    .filter((row) => row.shared.length)
    .sort(byValue(primaryCurrency(rows)))
    .slice(0, count);
}

export function moneyText({ currency, amount }) {
  const short = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(amount);
  return currency ? `${currency} ${short}` : short;
}
