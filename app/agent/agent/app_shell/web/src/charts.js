import { DATE_FORMATS, addCounts, axisValue, dayLabel, formatValue, largestFirst, numberOf, plainChart, shortMonth, sumOf } from './format.js';
import { TIERS } from './theme.js';
import { CHART_WIDTH, categoryLabels } from './layout.js';
import { KIND_CHARTS } from './kindCharts.js';

const BAR_MAX = 36;
const isMonthStart = (v) => /^\d{4}-\d{2}-01/.test(String(v ?? ''));

export function timeLabeler(rows, x) {
  if (x?.format === 'date') return dayLabel;
  if (x?.format === 'month') return shortMonth;
  return rows.length && rows.every((r) => isMonthStart(r.x)) ? shortMonth : dayLabel;
}

const uniq = (a) => [...new Set(a)];
const keyOf = (v) => (v == null ? 'Unknown' : String(v));

function legend(P, names) {
  return { top: 0, right: 0, data: names, type: 'scroll', icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: P.muted, fontSize: 11 }, pageTextStyle: { color: P.muted } };
}

function base(P, reduced, o) {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: P.font },
    animationDuration: reduced ? 0 : 450,
    ...o,
    tooltip: { confine: true, ...o.tooltip, backgroundColor: P.card, borderColor: P.line, textStyle: { color: P.ink, fontSize: 12 } },
  };
}

const axisLine = (P) => ({ lineStyle: { color: P.line } });
const split = (P) => ({ lineStyle: { color: P.line } });
const label = (P, extra = {}) => ({ color: P.muted, fontSize: 10, ...extra });
const truncate = (v, n = 14) => (String(v).length > n ? `${String(v).slice(0, n - 1)}…` : String(v));

function seriesColors(P, names) {
  const tierish = names.every((n) => TIERS.includes(n));
  return names.map((n, i) => (tierish ? P.tier[n] : P.series[i % P.series.length]));
}

export function topSeries(rows, top, additive) {
  const totals = new Map();
  rows.forEach((r) => totals.set(keyOf(r.s), addCounts([totals.get(keyOf(r.s)), Math.abs(numberOf(r.y0))])));
  const ranked = [...totals].sort((a, b) => largestFirst(a[1], b[1])).map((x) => x[0]);
  const keep = ranked.slice(0, top);
  const others = ranked.length > top;
  const names = others && additive ? [...keep, 'Other'] : keep;
  return { names, map: (s) => (keep.includes(keyOf(s)) ? keyOf(s) : others && additive ? 'Other' : null), hidden: Math.max(0, ranked.length - keep.length) };
}

function pivot(rows, xs, names, map) {
  const at = new Map();
  rows.forEach((r) => {
    const name = map(r.s);
    if (name == null) return;
    const k = `${keyOf(r.x)}|${name}`;
    at.set(k, addCounts([at.get(k), r.y0]));
  });
  return names.map((n) => xs.map((x) => (at.has(`${keyOf(x)}|${n}`) ? numberOf(at.get(`${keyOf(x)}|${n}`)) : null)));
}

export const HORIZONS = [4, 8, 13];

export function withinHorizon(rows, horizon) {
  const last = rows.reduce((at, r, i) => (r.y0 != null ? i : at), -1);
  return horizon ? rows.slice(0, last + 1 + horizon) : rows;
}

const bandSeries = (rows, lowKey, highKey, color, name) => [
  { name: `${name} low`, type: 'line', stack: name, data: rows.map((r) => r[lowKey]), lineStyle: { opacity: 0 }, symbol: 'none', silent: true,
    tooltip: { show: false } },
  { name, type: 'line', stack: name, data: rows.map((r) => (r[lowKey] == null || r[highKey] == null ? null : numberOf(r[highKey]) - numberOf(r[lowKey]))),
    lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color, opacity: 0.22 }, itemStyle: { color }, silent: true, tooltip: { show: false } },
];

const rowTip = (rows, names, valueFmt, xLabel) => (ps) => {
  const r = rows[ps?.[0]?.dataIndex];
  if (!r) return '';
  return [`<b>${xLabel(r.x)}</b>`, ...names.map((n, i) => (r[`y${i}`] == null ? '' : `${n}: ${valueFmt(i)(r[`y${i}`])}`)).filter(Boolean)].join('<br>');
};

function timeAxes(P, xs, xLabel, axisFmt) {
  return {
    grid: { left: 58, right: 24, top: 34, bottom: 30 },
    xAxis: { type: 'category', data: xs.map(xLabel), boundaryGap: false, axisLine: axisLine(P), axisTick: { show: false }, axisLabel: label(P) },
    yAxis: { type: 'value', scale: true, axisLabel: label(P, { formatter: axisFmt(0) }), splitLine: split(P) },
  };
}

function bandOption({ chart, rows: all, P, valueFmt, axisFmt, xLabel }) {
  const rows = withinHorizon(all, chart.horizon);
  const names = chart.y.map((y) => y.label);
  return {
    ...timeAxes(P, rows.map((r) => r.x), xLabel, axisFmt),
    tooltip: { trigger: 'axis', formatter: rowTip(rows, names, valueFmt, xLabel) },
    legend: legend(P, [names[0], names[1], names[3] ? `${names[2]} to ${names[3]}` : names[2]]),
    series: [
      ...bandSeries(rows, 'y2', 'y3', P.series[1], names[3] ? `${names[2]} to ${names[3]}` : names[2]),
      { name: names[0], type: 'line', data: rows.map((r) => r.y0), symbolSize: 4, lineStyle: { width: 2.2, color: P.ink }, itemStyle: { color: P.ink } },
      { name: names[1], type: 'line', data: rows.map((r) => r.y1), symbol: 'none', lineStyle: { width: 2.2, type: 'dashed', color: P.series[0] },
        itemStyle: { color: P.series[0] } },
    ],
  };
}

function controlOption({ chart, rows, P, valueFmt, axisFmt, xLabel }) {
  const names = chart.y.map((y) => y.label);
  const outside = rows.map((r) => (r.y0 != null && ((r.y3 != null && numberOf(r.y0) > numberOf(r.y3)) || (r.y2 != null && numberOf(r.y0) < numberOf(r.y2))) ? r.y0 : null));
  return {
    ...timeAxes(P, rows.map((r) => r.x), xLabel, axisFmt),
    tooltip: { trigger: 'axis', formatter: rowTip(rows, names, valueFmt, xLabel) },
    legend: legend(P, [names[0], names[1], `${names[2]} to ${names[3]}`, 'Outside the limits']),
    series: [
      ...bandSeries(rows, 'y2', 'y3', P.series[1], `${names[2]} to ${names[3]}`),
      { name: names[1], type: 'line', data: rows.map((r) => r.y1), symbol: 'none', lineStyle: { width: 1.5, type: 'dashed', color: P.muted }, itemStyle: { color: P.muted } },
      { name: names[0], type: 'line', data: rows.map((r) => r.y0), symbolSize: 4, lineStyle: { width: 2, color: P.series[0] }, itemStyle: { color: P.series[0] } },
      { name: 'Outside the limits', type: 'scatter', data: outside, symbolSize: 11, itemStyle: { color: P.tier['Act now'] || P.series[5] }, tooltip: { valueFormatter: valueFmt(0) } },
    ],
  };
}

function tornadoOption({ chart, rows, P, valueFmt, axisFmt, width }) {
  const sorted = [...rows].sort((a, b) => largestFirst(Math.abs(numberOf(a.y1) - numberOf(a.y0)), Math.abs(numberOf(b.y1) - numberOf(b.y0))));
  const names = chart.y.map((y) => y.label);
  const cats = categoryLabels(sorted.map((r) => keyOf(r.x)), { width, fontSize: 11, side: true });
  return {
    grid: { left: cats.left, right: 24, top: 30, bottom: 24 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: valueFmt(0) },
    legend: legend(P, names),
    xAxis: { type: 'value', axisLabel: label(P, { formatter: axisFmt(0) }), splitLine: split(P) },
    yAxis: { type: 'category', inverse: true, data: sorted.map((r) => keyOf(r.x)), axisLabel: label(P, cats.axisLabel), axisLine: axisLine(P), axisTick: { show: false } },
    series: names.map((name, i) => ({ name, type: 'bar', stack: 'swing', barMaxWidth: 22, data: sorted.map((r) => r[`y${i}`]),
      itemStyle: { color: i ? P.series[0] : P.series[5] } })),
  };
}

function bridgeOption({ chart, rows, P, valueFmt, axisFmt, width }) {
  let run = 0;
  const steps = rows.map((r, i) => {
    const value = numberOf(r.y0);
    const total = i === 0 || i === rows.length - 1;
    const start = total ? 0 : value >= 0 ? run : run + value;
    run = total ? value : run + value;
    return { name: keyOf(r.x), start, size: Math.abs(value), value, total };
  });
  return {
    grid: { left: 58, right: 16, top: 16, bottom: 64 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => { const s = steps[ps[0]?.dataIndex]; return s ? `${s.name}<br><b>${valueFmt(0)(s.value)}</b>` : ''; } },
    xAxis: { type: 'category', data: steps.map((s) => s.name), axisLabel: label(P, categoryLabels(steps.map((s) => s.name), { width }).axisLabel), axisLine: axisLine(P), axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: label(P, { formatter: axisFmt(0) }), splitLine: split(P) },
    series: [
      { name: 'base', type: 'bar', stack: 'bridge', silent: true, itemStyle: { color: 'transparent' }, data: steps.map((s) => s.start), tooltip: { show: false } },
      { name: chart.y[0].label, type: 'bar', stack: 'bridge', barMaxWidth: BAR_MAX,
        data: steps.map((s) => ({ value: s.size, itemStyle: { color: s.total ? P.series[0] : s.value >= 0 ? P.series[2] : P.series[5], borderRadius: 3 } })) },
    ],
  };
}

function bulletOption({ chart, rows, P, valueFmt, axisFmt, width }) {
  const cats = categoryLabels(rows.map((r) => keyOf(r.x)), { width, fontSize: 11, side: true });
  const names = chart.y.map((y) => y.label);
  const binding = (r) => numberOf(r.y1) > 0 && numberOf(r.y0) >= numberOf(r.y1) * 0.98;
  return {
    grid: { left: cats.left, right: 24, top: 30, bottom: 24 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: valueFmt(0) },
    legend: legend(P, names),
    xAxis: { type: 'value', axisLabel: label(P, { formatter: axisFmt(0) }), splitLine: split(P) },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => keyOf(r.x)), axisLabel: label(P, cats.axisLabel), axisLine: axisLine(P), axisTick: { show: false } },
    series: [
      { name: names[1], type: 'bar', barWidth: 18, barGap: '-100%', itemStyle: { color: P.well, borderColor: P.line, borderRadius: 3 }, data: rows.map((r) => r.y1), z: 1 },
      { name: names[0], type: 'bar', barWidth: 10, itemStyle: { borderRadius: 3 }, z: 2,
        data: rows.map((r) => ({ value: r.y0, itemStyle: { color: binding(r) ? P.tier['Act now'] || P.series[5] : P.series[0] } })) },
    ],
  };
}

function ganttOption({ chart, rows, P, valueFmt, axisFmt, width }) {
  const timed = DATE_FORMATS.includes(chart.y[0]?.format);
  const at = (v) => (v == null ? NaN : timed ? Date.parse(String(v)) : numberOf(v));
  const bars = rows.map((r) => ({ name: keyOf(r.x), start: at(r.y0), end: at(r.y1), from: r.y0, to: r.y1 }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));
  const cats = categoryLabels(bars.map((b) => b.name), { width, fontSize: 11, side: true });
  return {
    grid: { left: cats.left, right: 24, top: 16, bottom: 28 },
    tooltip: { trigger: 'item', formatter: (p) => { const b = bars[p.dataIndex]; return b ? `<b>${b.name}</b><br>${valueFmt(0)(b.from)} to ${valueFmt(1)(b.to)}` : ''; } },
    xAxis: { type: timed ? 'time' : 'value', scale: true, axisLabel: label(P, timed ? {} : { formatter: axisFmt(0) }), splitLine: split(P) },
    yAxis: { type: 'category', inverse: true, data: bars.map((b) => b.name), axisLabel: label(P, cats.axisLabel), axisLine: axisLine(P), axisTick: { show: false } },
    series: [{
      type: 'custom', name: chart.y[0].label, encode: { x: [1, 2], y: 0 }, data: bars.map((b, i) => [i, b.start, b.end]),
      renderItem: (params, api) => {
        const a = api.coord([api.value(1), api.value(0)]);
        const b = api.coord([api.value(2), api.value(0)]);
        const height = Math.min(18, api.size([0, 1])[1] * 0.6);
        return { type: 'rect', shape: { x: a[0], y: a[1] - height / 2, width: Math.max(2, b[0] - a[0]), height, r: 3 }, style: { fill: P.series[0] } };
      },
    }],
  };
}

const LAYOUT_CHARTS = { band: bandOption, control: controlOption, tornado: tornadoOption, bridge: bridgeOption, bullet: bulletOption,
  treemap: treemapOption, radar: radarOption, sankey: sankeyOption, gantt: ganttOption, ...KIND_CHARTS };

export function chartOption(given, rows, P, { reduced = false, width = CHART_WIDTH } = {}) {
  const chart = plainChart(given);
  const y0 = chart.y[0] || {};
  const fmt = (i) => chart.y[i] || y0;
  const valueFmt = (i = 0) => (v) => formatValue(v, fmt(i).format, fmt(i).currency);
  const axisFmt = (i = 0) => (v) => axisValue(v, fmt(i).format, fmt(i).currency);
  const time = chart.x?.kind === 'time';
  const xLabel = time ? timeLabeler(rows, chart.x) : (v) => keyOf(v);
  const additive = ['stacked_bar', 'stacked_area', 'pareto', 'donut'].includes(chart.type);
  const top = chart.series?.top || 5;

  if (LAYOUT_CHARTS[chart.type]) return base(P, reduced, LAYOUT_CHARTS[chart.type]({ chart, rows, P, valueFmt, axisFmt, xLabel, width }));

  if (chart.type === 'donut') {
    const total = sumOf(rows, (r) => r.y0);
    const names = rows.map((r) => keyOf(r.x));
    return base(P, reduced, {
      tooltip: { trigger: 'item', valueFormatter: valueFmt(0) },
      legend: { ...legend(P, names), orient: 'vertical', top: 'middle', right: 0 },
      color: seriesColors(P, names),
      title: { text: valueFmt(0)(total), subtext: 'Total', left: '34%', top: '40%', textAlign: 'center', textStyle: { color: P.ink, fontSize: 18, fontWeight: 650 }, subtextStyle: { color: P.muted, fontSize: 11 } },
      series: [{ type: 'pie', radius: ['52%', '76%'], center: ['35%', '52%'], avoidLabelOverlap: true, label: { show: false }, itemStyle: { borderColor: P.card, borderWidth: 2 },
        data: rows.map((r) => ({ name: keyOf(r.x), value: r.y0 })) }],
    });
  }

  if (chart.type === 'scatter') {
    return base(P, reduced, {
      grid: { left: 58, right: 20, top: 20, bottom: 40 },
      tooltip: { trigger: 'item', formatter: (p) => `<b>${p.data[2]}</b><br>${chart.x.label || 'x'}: ${formatValue(p.data[0], chart.x.format)}<br>${y0.label}: ${valueFmt(0)(p.data[1])}` },
      xAxis: { type: 'value', name: chart.x.label || '', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: P.muted, fontSize: 11 }, axisLabel: label(P, { formatter: (v) => axisValue(v, chart.x.format) }), splitLine: split(P), axisLine: axisLine(P) },
      yAxis: { type: 'value', name: y0.label || '', nameTextStyle: { color: P.muted, fontSize: 11 }, axisLabel: label(P, { formatter: axisFmt(0) }), splitLine: split(P) },
      series: [{ type: 'scatter', symbolSize: 9, itemStyle: { color: P.series[0], opacity: 0.8 }, data: rows.map((r) => [r.x, r.y0, keyOf(r.x_label)]) }],
    });
  }

  if (chart.type === 'heatmap') {
    const xs = uniq(rows.map((r) => keyOf(r.x)));
    const ys = uniq(rows.map((r) => keyOf(r.s)));
    const values = rows.map((r) => numberOf(r.y0));
    const rowsSide = categoryLabels(ys, { width, side: true });
    return base(P, reduced, {
      grid: { left: rowsSide.left, right: 16, top: 12, bottom: 54 },
      tooltip: { formatter: (p) => `${ys[p.data[1]]} · ${xLabel(xs[p.data[0]])}<br><b>${valueFmt(0)(p.data[2])}</b>` },
      xAxis: { type: 'category', data: xs.map(xLabel), axisLabel: label(P, categoryLabels(xs.map(xLabel), { width, left: rowsSide.left }).axisLabel), axisLine: axisLine(P), axisTick: { show: false } },
      yAxis: { type: 'category', data: ys, axisLabel: label(P, rowsSide.axisLabel), axisLine: axisLine(P), axisTick: { show: false } },
      visualMap: { show: false, min: Math.min(0, ...values), max: Math.max(1e-9, ...values), inRange: { color: [P.well, P.series[1]] } },
      series: [{ type: 'heatmap', data: rows.map((r) => [xs.indexOf(keyOf(r.x)), ys.indexOf(keyOf(r.s)), r.y0]), itemStyle: { borderColor: P.card, borderWidth: 2, borderRadius: 4 } }],
    });
  }

  if (chart.type === 'pareto') {
    const total = numberOf(rows[0]?.total) || numberOf(sumOf(rows, (r) => r.y0)) || 1;
    let run = 0;
    return base(P, reduced, {
      grid: { left: 58, right: 44, top: 28, bottom: 64 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: legend(P, [y0.label, 'Running share']),
      xAxis: { type: 'category', data: rows.map((r) => keyOf(r.x)), axisLabel: label(P, categoryLabels(rows.map((r) => keyOf(r.x)), { width, right: 44 }).axisLabel), axisLine: axisLine(P), axisTick: { show: false } },
      yAxis: [{ type: 'value', axisLabel: label(P, { formatter: axisFmt(0) }), splitLine: split(P) },
        { type: 'value', min: 0, max: (v) => Math.min(100, Math.ceil(v.max / 10) * 10), axisLabel: label(P, { formatter: '{value}%' }), splitLine: { show: false } }],
      series: [
        { name: y0.label, type: 'bar', barMaxWidth: BAR_MAX, itemStyle: { color: P.series[0], borderRadius: [3, 3, 0, 0] }, tooltip: { valueFormatter: valueFmt(0) }, data: rows.map((r) => r.y0) },
        { name: 'Running share', type: 'line', yAxisIndex: 1, symbolSize: 4, smooth: 0.2, lineStyle: { width: 2, color: P.series[5] }, itemStyle: { color: P.series[5] }, tooltip: { valueFormatter: (v) => `${v}%` },
          data: rows.map((r) => { run = addCounts([run, r.y0]); return +((numberOf(run) / total) * 100).toFixed(1); }) },
      ],
    });
  }

  const horizontal = chart.type === 'horizontal_bar';
  const area = chart.type === 'area' || chart.type === 'stacked_area';
  const line = chart.type === 'line' || area;
  const stacked = chart.type === 'stacked_bar' || chart.type === 'stacked_area';
  let xs;
  let series;
  if (chart.series) {
    const picked = topSeries(rows, top, additive);
    xs = uniq(rows.map((r) => r.x));
    if (!time) {
      const totals = new Map();
      rows.forEach((r) => totals.set(keyOf(r.x), addCounts([totals.get(keyOf(r.x)), Math.abs(numberOf(r.y0))])));
      xs = xs.sort((a, b) => (chart.sort === 'x_asc' ? keyOf(a).localeCompare(keyOf(b)) : largestFirst(totals.get(keyOf(a)), totals.get(keyOf(b))))).slice(0, chart.limit || 25);
    }
    const colors = seriesColors(P, picked.names);
    series = pivot(rows, xs, picked.names, picked.map).map((data, i) => ({
      name: picked.names[i], type: line ? 'line' : 'bar', stack: stacked ? 'total' : undefined, data,
      ...(line
        ? { smooth: 0.2, showSymbol: false, emphasis: { focus: 'series' }, lineStyle: { width: stacked ? 1.2 : 2.2, color: stacked ? P.card : colors[i] }, itemStyle: { color: colors[i] }, areaStyle: area ? { color: colors[i], opacity: stacked ? 0.85 : 0.18 } : undefined, connectNulls: false }
        : { barMaxWidth: BAR_MAX, itemStyle: { color: colors[i] } }),
      tooltip: { valueFormatter: valueFmt(0) },
    }));
  } else {
    xs = rows.map((r) => r.x);
    const primary = chart.y[0]?.format;
    series = chart.y.map((y, i) => {
      const color = P.series[i % P.series.length];
      const axis = i > 0 && y.format !== primary ? 1 : 0;
      return {
        name: y.label, type: line ? 'line' : 'bar', yAxisIndex: horizontal ? undefined : axis, data: rows.map((r) => r[`y${i}`]),
        ...(line
          ? { smooth: 0.2, showSymbol: rows.length < 24, symbolSize: 5, lineStyle: { width: 2.2, color }, itemStyle: { color }, areaStyle: area ? { color, opacity: 0.18 } : undefined }
          : { barMaxWidth: BAR_MAX, itemStyle: { color, borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] } }),
        tooltip: { valueFormatter: valueFmt(i) },
      };
    });
  }
  const twoAxes = !horizontal && !chart.series && chart.y.some((y, i) => i > 0 && y.format !== chart.y[0]?.format);
  const secondIndex = chart.y.findIndex((y, i) => i > 0 && y.format !== chart.y[0]?.format);
  const names = series.map((s) => s.name);
  const cats = categoryLabels(xs.map(xLabel), horizontal ? { width, fontSize: 11, side: true } : { width, right: twoAxes ? 52 : 16 });
  const categoryAxis = {
    type: 'category', data: xs.map(xLabel), boundaryGap: !line, axisLine: axisLine(P), axisTick: { show: false },
    axisLabel: label(P, time && !horizontal ? { rotate: 0 } : cats.axisLabel),
  };
  const valueAxis = (i) => ({ type: 'value', scale: line && !stacked, axisLabel: label(P, { formatter: axisFmt(i) }), splitLine: i === 0 ? split(P) : { show: false } });
  return base(P, reduced, {
    grid: horizontal ? { left: cats.left, right: 24, top: names.length > 1 ? 30 : 12, bottom: 24 } : { left: 58, right: twoAxes ? 52 : line && time ? 34 : 16, top: names.length > 1 ? 34 : 16, bottom: !time && xs.length > 8 ? 64 : 30 },
    tooltip: { trigger: 'axis', axisPointer: { type: line ? 'line' : 'shadow' } },
    legend: names.length > 1 ? legend(P, names) : undefined,
    xAxis: horizontal ? valueAxis(0) : categoryAxis,
    yAxis: horizontal ? { ...categoryAxis, inverse: true } : twoAxes ? [valueAxis(0), valueAxis(secondIndex)] : valueAxis(0),
    series,
  });
}

export function chartIsEmpty(chart, rows) {
  if (!rows?.length) return true;
  const keys = chart.type === 'scatter' ? ['y0'] : chart.y.map((_, i) => `y${i}`);
  return rows.every((r) => keys.every((k) => r[k] == null));
}

export function treemapOption({ chart, rows, P, valueFmt }) {
  const names = chart.y.map((y) => y.label);
  const values = rows.map((r) => numberOf(r.y1));
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const shade = (v) => P.series[Math.min(P.series.length - 1, Math.floor(((numberOf(v) - low) / span) * (P.series.length - 1)))];
  return {
    tooltip: { trigger: 'item', formatter: (p) => `<b>${p.name}</b><br>${names[0]}: ${valueFmt(0)(p.data.size)}<br>${names[1]}: ${valueFmt(1)(p.data.worth)}` },
    series: [{
      type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, top: 8, left: 8, right: 8, bottom: 8,
      label: { show: true, color: P.card, fontSize: 12, formatter: (p) => `${truncate(p.name, 18)}\n${valueFmt(1)(p.data.worth)}` },
      itemStyle: { borderColor: P.card, borderWidth: 2, gapWidth: 2, borderRadius: 4 },
      data: rows.map((r) => ({ name: keyOf(r.x), value: Math.max(0, numberOf(r.y0)), size: r.y0, worth: r.y1, itemStyle: { color: shade(r.y1) } })),
    }],
  };
}

export function radarOption({ chart, rows, P, valueFmt }) {
  const features = uniq(rows.map((r) => keyOf(r.x)));
  const picked = topSeries(rows, chart.series?.top || 5, false);
  const raw = pivot(rows, features, picked.names, picked.map);
  const peak = features.map((_, i) => Math.max(1e-9, ...raw.map((line) => Math.abs(numberOf(line[i])))));
  const colors = seriesColors(P, picked.names);
  return {
    legend: legend(P, picked.names),
    tooltip: { trigger: 'item', formatter: (p) => [`<b>${p.name}</b>`, ...features.map((f, i) => `${f}: ${valueFmt(0)(raw[p.dataIndex]?.[i])}`)].join('<br>') },
    radar: { indicator: features.map((name) => ({ name: truncate(name, 16), max: 1 })), radius: '62%', center: ['50%', '56%'],
      axisName: { color: P.muted, fontSize: 10 }, splitLine: split(P), axisLine: axisLine(P), splitArea: { show: false } },
    series: [{ type: 'radar', symbolSize: 4,
      data: raw.map((line, i) => ({ name: picked.names[i], value: line.map((v, j) => (v == null ? 0 : numberOf(v) / peak[j])),
        lineStyle: { color: colors[i], width: 2 }, itemStyle: { color: colors[i] }, areaStyle: { color: colors[i], opacity: 0.12 } })) }],
  };
}

export const SANKEY_SIDES = ['before', 'now'];

export function sankeyOption({ rows, P, valueFmt }) {
  const node = (side, v) => `${side}|${keyOf(v)}`;
  const shown = (name) => String(name).slice(String(name).indexOf('|') + 1);
  const links = rows.filter((r) => numberOf(r.y0) > 0).map((r) => ({ source: node(SANKEY_SIDES[0], r.x), target: node(SANKEY_SIDES[1], r.s), value: numberOf(r.y0) }));
  const names = uniq(links.flatMap((l) => [l.source, l.target]));
  const colorOf = (name) => P.series[uniq(names.map(shown)).indexOf(shown(name)) % P.series.length];
  return {
    tooltip: { trigger: 'item', formatter: (p) => (p.dataType === 'edge' ? `${shown(p.data.source)} → ${shown(p.data.target)}<br><b>${valueFmt(0)(p.data.value)}</b>`
      : `<b>${shown(p.name)}</b>`) },
    series: [{ type: 'sankey', animation: false, left: 8, right: 96, top: 12, bottom: 12, nodeAlign: 'justify', emphasis: { focus: 'adjacency' },
      label: { color: P.ink, fontSize: 11, formatter: (p) => truncate(shown(p.name), 18) },
      lineStyle: { color: 'gradient', opacity: 0.35 },
      data: names.map((name) => ({ name, itemStyle: { color: colorOf(name) } })), links }],
  };
}
