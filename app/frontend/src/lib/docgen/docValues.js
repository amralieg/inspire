// FX-114 (REQ-503): the App's value ledger and run totals mapped onto the doc model's `values` contract, and the wizard's default language.
// Pure. No invented growth: the projection stays empty until saved answers carry one (REQ-507), so a document shows the one-year value only.
import { moneyText } from '../valueWizard.js';
import { valueFromSaved } from './docModel.js';

const finite = (v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);

function fromLedger(entry) {
  const y = entry?.yearly;
  const amount = finite(y?.total?.amount);
  if (amount === null) return null;
  const currency = y.currency || y.total.unit || 'USD';
  const parts = (Array.isArray(y.parts) ? y.parts : []).map((p) => ({ name: String(p.label ?? p.id ?? ''), amount: finite(p.amount) })).filter((p) => p.name && p.amount !== null && p.amount > 0);
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  const factors = sum > 0 ? parts.map((p) => ({ name: p.name, share: p.amount / sum })) : [];
  const top = factors.length ? factors.reduce((a, b) => (b.share > a.share ? b : a)) : null;
  const story = top ? `${moneyText(currency, amount)} a year, mostly from ${top.name} (${Math.round(top.share * 100)}%).` : '';
  // REQ-507 L8: a saved story (approved or not; docModel shows only an approved one) and the saved projection win.
  const saved = valueFromSaved(entry);
  return { amount, currency, status: y.calculated === true ? 'calculated' : 'estimated', verb: y.verb || '', story: entry.answers?.story || story, yearly: saved?.yearly || [], factors };
}

function fromTotals(entry) {
  const amount = finite(entry?.amount);
  if (!entry || amount === null || entry.status === 'not_estimated' || entry.status === 'no_data') return null;
  return { amount, currency: entry.currency || 'USD', status: 'estimated', verb: entry.verb || '', story: '', yearly: [], factors: [] };
}

// byId: calculated.byId (wins). totals: valueTotals, whose use_cases hold the run's estimates.
export function docValuesOf({ byId, totals } = {}) {
  const out = {};
  for (const [id, e] of Object.entries(totals?.use_cases || {})) { const v = fromTotals(e); if (v) out[id] = v; }
  for (const [id, e] of Object.entries(byId || {})) { const v = fromLedger(e); if (v) out[id] = v; }
  return out;
}

export function docLanguageOf(session) {
  const raw = String(session?.output_language || '').trim() || String(session?.widget_values?.['12_documents_languages'] || '').trim();
  return raw.split(',')[0].trim() || 'English';
}
