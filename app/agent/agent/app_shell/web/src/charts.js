import { addCounts, axisValue, dayLabel, formatValue, largestFirst, numberOf, shortMonth, sumOf } from './format.js';
import { TIERS } from './theme.js';
import { labelTilt } from './layout.js';

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

export function chartOption(chart, rows, P, { reduced = false } = {}) {
  const y0 = chart.y[0] || {};
  const fmt = (i) => chart.y[i] || y0;
  const valueFmt = (i = 0) => (v) => formatValue(v, fmt(i).format, fmt(i).currency);
  const axisFmt = (i = 0) => (v) => axisValue(v, fmt(i).format, fmt(i).currency);
  const time = chart.x?.kind === 'time';
  const xLabel = time ? timeLabeler(rows, chart.x) : (v) => keyOf(v);
  const additive = ['stacked_bar', 'stacked_area', 'pareto', 'donut'].includes(chart.type);
  const top = chart.series?.top || 5;

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
    return base(P, reduced, {
      grid: { left: 96, right: 16, top: 12, bottom: 54 },
      tooltip: { formatter: (p) => `${ys[p.data[1]]} · ${xLabel(xs[p.data[0]])}<br><b>${valueFmt(0)(p.data[2])}</b>` },
      xAxis: { type: 'category', data: xs.map(xLabel), axisLabel: label(P, { rotate: labelTilt(xs.map((v) => truncate(xLabel(v)))), formatter: (v) => truncate(v) }), axisLine: axisLine(P), axisTick: { show: false } },
      yAxis: { type: 'category', data: ys, axisLabel: label(P, { formatter: (v) => truncate(v, 16) }), axisLine: axisLine(P), axisTick: { show: false } },
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
      xAxis: { type: 'category', data: rows.map((r) => keyOf(r.x)), axisLabel: label(P, { rotate: labelTilt(rows.map((r) => truncate(keyOf(r.x), 12))), formatter: (v) => truncate(v, 12) }), axisLine: axisLine(P), axisTick: { show: false } },
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
  const categoryAxis = {
    type: 'category', data: xs.map(xLabel), boundaryGap: !line, axisLine: axisLine(P), axisTick: { show: false },
    axisLabel: label(P, horizontal ? { fontSize: 11, formatter: (v) => truncate(v, 18) } : { rotate: time ? 0 : labelTilt(xs.map((v) => truncate(xLabel(v), 12))), formatter: (v) => (time ? v : truncate(v, 12)) }),
  };
  const valueAxis = (i) => ({ type: 'value', scale: line && !stacked, axisLabel: label(P, { formatter: axisFmt(i) }), splitLine: i === 0 ? split(P) : { show: false } });
  return base(P, reduced, {
    grid: horizontal ? { left: 110, right: 24, top: names.length > 1 ? 30 : 12, bottom: 24 } : { left: 58, right: twoAxes ? 52 : line && time ? 34 : 16, top: names.length > 1 ? 34 : 16, bottom: !time && xs.length > 8 ? 64 : 30 },
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
