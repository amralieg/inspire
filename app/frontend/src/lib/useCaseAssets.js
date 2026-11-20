// REQ-427: the App, Dashboard, Lakebase and Genie cells of a use case row, and its total DBUs. The flags come from what Inspire recorded when
// it built; the DBU figure is a separate read, so the flags show first and a DBU read that fails never hides them.
import OUTPUT_LABELS from '../../../backend/lib/implementOutputLabels.json' with { type: 'json' };

export const ASSET_CELLS = [['app', OUTPUT_LABELS.app], ['dashboard', OUTPUT_LABELS.dashboard], ['lakebase', 'Lakebase'], ['genie', OUTPUT_LABELS.genie_space]];

export function assetCells(flags) {
  return ASSET_CELLS.map(([key, label]) => ({ key, label, value: flags && flags[key] === true ? 'Yes' : 'No' }));
}

const DBU_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

// `read` is the DBU read: null while it loads, else { state, use_cases, message, permissions }. A figure that was not read is never a 0.
export function dbuCell(read, useCaseId) {
  if (!read) return { text: 'DBUs loading', permissions: [] };
  const total = read.use_cases ? read.use_cases[useCaseId] : null;
  if (read.state === 'denied') return { text: 'DBUs: the App cannot read billing', permissions: Array.isArray(read.permissions) ? read.permissions : [] };
  if (read.state === 'error') return { text: 'DBUs unavailable', permissions: [] };
  if (typeof total !== 'number' || !Number.isFinite(total)) return { text: 'DBUs: none billed yet', permissions: [] };
  return { text: `${DBU_FORMAT.format(total)} DBUs`, permissions: [] };
}
