import { valuedLine } from './buildNext.js';

// REQ-481: a page shows a calculated dollar amount when a run value has a total or a use case is valued. "Not calculated" is no number.
export const hasRunTotals = (value) => Boolean(value?.totals?.length);
export const anyRunValue = (reply) => hasRunTotals(reply?.all) || (reply?.runs || []).some((r) => hasRunTotals(r.run_value));
export const anyValued = (byId) => Object.values(byId || {}).some(valuedLine);
