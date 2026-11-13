/** Metric views are not tables: they are not listed, counted or read as a table. */

const METRIC_VIEW_TABLE_TYPES = ['METRIC_VIEW', 'METRIC VIEW'];

const isMetricViewType = (type) => METRIC_VIEW_TABLE_TYPES.includes(String(type || '').trim().toUpperCase());

/** Split listed tables into the ones kept and the metric views left out. */
function splitMetricViews(items, typeOf) {
  const kept = [];
  const skipped = [];
  for (const item of Array.isArray(items) ? items : []) {
    (isMetricViewType(typeOf(item)) ? skipped : kept).push(item);
  }
  return { kept, skipped };
}

/** The one log line a skip writes, so a run shows what it left out. */
function metricViewSkipLine(names) {
  return `[METRIC-VIEW SKIPPED] ${names.length} metric views left out: ${names.join(', ')}`;
}

/** The one plain line a Data Filters read returns for a metric view, instead of a SQL error. */
function metricViewRefusal(name) {
  return `${name} is a metric view, so Inspire leaves it out of Data Filters; pick its source table instead`;
}

module.exports = { METRIC_VIEW_TABLE_TYPES, isMetricViewType, splitMetricViews, metricViewSkipLine, metricViewRefusal };
