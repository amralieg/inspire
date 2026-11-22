import disclaimer from './valueDisclaimer.json' with { type: 'json' };
import { valueStripOf } from './valueStrip.js';

// REQ-481: the estimated-value text. One JSON copy here (equal to app/backend/lib/valueDisclaimer.json, a test fails when they differ).
export const VALUE_DISCLAIMER = disclaimer.full;
export const VALUE_DISCLAIMER_SHORT = disclaimer.short;

// True when the page shows a calculated currency figure ("Not recorded" and no data count as no number).
export const showsMoney = (page, data) => Boolean(valueStripOf(page, data, null)?.kpi?.now) && valueStripOf(page, data, null).kpi.now !== 'Not recorded';
