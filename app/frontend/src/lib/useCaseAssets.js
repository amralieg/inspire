// REQ-427: the App, Dashboard, Lakebase and Genie cells of a use case row, from what Inspire recorded when it built (REQ-459: no DBU figure).
import OUTPUT_LABELS from '../../../backend/lib/implementOutputLabels.json' with { type: 'json' };

export const ASSET_CELLS = [['app', OUTPUT_LABELS.app], ['dashboard', OUTPUT_LABELS.dashboard], ['lakebase', 'Lakebase'], ['genie', OUTPUT_LABELS.genie_space]];

export function assetCells(flags) {
  return ASSET_CELLS.map(([key, label]) => ({ key, label, value: flags && flags[key] === true ? 'Yes' : 'No' }));
}
