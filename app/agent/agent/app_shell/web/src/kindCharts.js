import { numberOf } from './format.js';
import { categoryLabels } from './layout.js';

export const WORLD = 'inspire_world';
export const FLOW_EDGE_LABELS = 24;
export const GRAPH_EDGES = 400;
export const GRAPH_LABELS = 40;
export const KIND_LAZY = { flow: 'flow', box: 'flow', graph: 'flow', map_points: 'geo', map_regions: 'geo' };

const SHAPES = new Map();
const keyOf = (v) => (v == null ? 'Unknown' : String(v));
const uniq = (a) => [...new Set(a)];
const truncate = (v, n = 16) => (String(v).length > n ? `${String(v).slice(0, n - 1)}…` : String(v));
const label = (P, extra = {}) => ({ color: P.muted, fontSize: 10, ...extra });
const split = (P) => ({ lineStyle: { color: P.line } });
const finite = (v) => v != null && v !== '' && Number.isFinite(Number(v));

function boxOf(geometry) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      box[0] = Math.min(box[0], c[0]); box[1] = Math.min(box[1], c[1]); box[2] = Math.max(box[2], c[0]); box[3] = Math.max(box[3], c[1]);
    } else c.forEach(walk);
  };
  walk(geometry?.coordinates || []);
  return box;
}

export function setShapes(features) {
  SHAPES.clear();
  (features || []).forEach((f) => {
    const p = f.properties || {};
    const shape = { name: p.name, box: boxOf(f.geometry) };
    [p.a2, p.a3, p.n, p.name].filter(Boolean).forEach((code) => SHAPES.set(String(code).trim().toUpperCase(), shape));
  });
  return SHAPES.size;
}

export const shapeOf = (code) => SHAPES.get(String(code ?? '').trim().toUpperCase()) || null;

function framed(boxes) {
  if (!boxes.length) return undefined;
  const [w, s, e, n] = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  if (e - w > 300) return undefined;
  const pad = Math.max(2, (e - w) * 0.12, (n - s) * 0.12);
  return [[Math.max(-180, w - pad), Math.min(85, n + pad)], [Math.min(180, e + pad), Math.max(-85, s - pad)]];
}

const note = (P, text) => ({ text, left: 8, bottom: 4, textStyle: { color: P.muted, fontSize: 10, fontWeight: 400 } });

export function flowLayout(rows) {
  const edges = rows.filter((r) => r.x != null && r.s != null)
    .map((r) => ({ from: keyOf(r.x), to: keyOf(r.s), cases: numberOf(r.y0), hours: finite(r.y1) ? numberOf(r.y1) : null }));
  const steps = uniq(edges.flatMap((e) => [e.from, e.to]));
  const into = new Map(steps.map((s) => [s, 0]));
  edges.forEach((e) => { if (e.from !== e.to) into.set(e.to, into.get(e.to) + 1); });
  const out = new Map(steps.map((s) => [s, edges.filter((e) => e.from === s)]));
  const state = new Map();
  const back = new Set();
  const visit = (s) => {
    state.set(s, 1);
    out.get(s).forEach((e) => {
      if (state.get(e.to) === 1) back.add(e);
      else if (!state.get(e.to)) visit(e.to);
    });
    state.set(s, 2);
  };
  [...steps].sort((a, b) => into.get(a) - into.get(b)).forEach((s) => { if (!state.get(s)) visit(s); });
  const before = new Map(steps.map((s) => [s, edges.filter((e) => e.to === s && !back.has(e)).map((e) => e.from)]));
  const layer = new Map();
  const depth = (s) => {
    if (!layer.has(s)) layer.set(s, before.get(s).reduce((m, p) => Math.max(m, depth(p) + 1), 0));
    return layer.get(s);
  };
  steps.forEach(depth);
  const rank = new Map();
  const nodes = steps.map((name) => {
    const at = layer.get(name);
    const row = rank.get(at) || 0;
    rank.set(at, row + 1);
    const cases = edges.filter((e) => e.to === name).reduce((sum, e) => sum + e.cases, 0);
    return { name, layer: at, row, cases };
  });
  return { nodes, edges: edges.map((e) => ({ ...e, rework: back.has(e) })) };
}

function flowOption({ chart, rows, P, valueFmt }) {
  const { nodes, edges } = flowLayout(rows);
  const names = chart.y.map((y) => y.label);
  const hours = edges.map((e) => e.hours).filter((h) => h != null).sort((a, b) => a - b);
  const slow = hours.length ? hours[Math.floor(hours.length * 0.75)] : Infinity;
  const most = Math.max(1, ...edges.map((e) => e.cases));
  const late = P.tier?.['Act now'] || P.series[5];
  const wait = new Map(nodes.map((n) => [n.name, Math.max(-Infinity, ...edges.filter((e) => e.to === n.name && !e.rework && e.hours != null).map((e) => e.hours))]));
  const longest = Math.max(...wait.values());
  const bottleneck = Number.isFinite(longest) ? nodes.find((n) => wait.get(n.name) === longest)?.name : null;
  const layerOf = new Map(nodes.map((n) => [n.name, n.layer]));
  return {
    grid: { left: 64, right: 64, top: 28, bottom: 28 },
    xAxis: { type: 'value', show: false, min: -0.5, max: Math.max(0, ...nodes.map((n) => n.layer)) + 0.5 },
    yAxis: { type: 'value', show: false, inverse: true, min: -0.7, max: Math.max(0, ...nodes.map((n) => n.row)) + 0.7 },
    tooltip: { trigger: 'item', formatter: (p) => (p.dataType === 'edge'
      ? `${p.data.source} → ${p.data.target}${p.data.rework ? ' (rework)' : ''}<br>${names[0]}: <b>${valueFmt(0)(p.data.value)}</b><br>${names[1]}: <b>${valueFmt(1)(p.data.hours)}</b>`
      : `<b>${p.name}</b>${p.name === bottleneck ? ' (longest wait)' : ''}<br>${names[0]} in: ${valueFmt(0)(p.data.cases)}`) },
    series: [{
      type: 'graph', coordinateSystem: 'cartesian2d', edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 8, symbol: 'roundRect', symbolSize: [104, 32],
      label: { show: true, position: 'inside', color: P.card, fontSize: 11, formatter: (p) => truncate(p.name, 14) },
      edgeLabel: { show: edges.length <= FLOW_EDGE_LABELS, color: P.muted, fontSize: 10, formatter: (p) => (p.data.hours == null ? '' : valueFmt(1)(p.data.hours)) },
      emphasis: { focus: 'adjacency' },
      data: nodes.map((n) => ({ name: n.name, value: [n.layer, n.row], cases: n.cases, pick: n.name,
        itemStyle: { color: n.name === bottleneck ? late : P.series[0] } })),
      links: edges.map((e) => ({ source: e.from, target: e.to, value: e.cases, hours: e.hours, rework: e.rework, pick: e.to,
        lineStyle: { width: 1 + 7 * (e.cases / most), curveness: e.rework ? 0.4 : Math.abs(layerOf.get(e.to) - layerOf.get(e.from)) > 1 ? 0.3 : 0, type: e.rework ? 'dashed' : 'solid',
          color: e.rework ? P.series[5] : e.hours != null && e.hours >= slow ? late : P.muted, opacity: 0.8 } })),
    }],
  };
}

function boxOption({ chart, rows, P, valueFmt, axisFmt, width }) {
  const names = chart.y.map((y) => y.label);
  const sorted = [...rows].sort((a, b) => numberOf(b.y2) - numberOf(a.y2));
  return {
    grid: { left: 58, right: 16, top: 16, bottom: 56 },
    tooltip: { trigger: 'item', formatter: (p) => [`<b>${keyOf(sorted[p.dataIndex]?.x)}</b>`, ...names.map((n, i) => `${n}: ${valueFmt(i)(sorted[p.dataIndex]?.[`y${i}`])}`)].join('<br>') },
    xAxis: { type: 'category', data: sorted.map((r) => keyOf(r.x)), axisLabel: label(P, categoryLabels(sorted.map((r) => keyOf(r.x)), { width }).axisLabel), axisLine: split(P), axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: label(P, { formatter: axisFmt(2) }), splitLine: split(P) },
    series: [{ type: 'boxplot', data: sorted.map((r) => [0, 1, 2, 3, 4].map((i) => numberOf(r[`y${i}`]))),
      itemStyle: { color: P.well, borderColor: P.series[0], borderWidth: 1.5 } }],
  };
}

function mapPointsOption({ chart, rows, P, valueFmt }) {
  const points = rows.filter((r) => finite(r.y1) && finite(r.y2) && Math.abs(numberOf(r.y1)) <= 90 && Math.abs(numberOf(r.y2)) <= 180)
    .map((r) => ({ name: keyOf(r.x), pick: keyOf(r.x), value: [numberOf(r.y2), numberOf(r.y1), numberOf(r.y0)] }));
  const top = Math.max(1e-9, ...points.map((p) => Math.abs(p.value[2])));
  const dropped = rows.length - points.length;
  return {
    tooltip: { trigger: 'item', formatter: (p) => (p.seriesType === 'scatter' ? `<b>${p.name}</b><br>${chart.y[0].label}: ${valueFmt(0)(p.value[2])}` : '') },
    title: dropped ? note(P, `${dropped} of ${rows.length} rows have no latitude and longitude, so the map leaves them out`) : undefined,
    geo: { map: WORLD, roam: true, silent: true, boundingCoords: framed(points.map((p) => [p.value[0], p.value[1], p.value[0], p.value[1]])),
      itemStyle: { areaColor: P.well, borderColor: P.line }, label: { show: false } },
    series: [{ type: 'scatter', coordinateSystem: 'geo', data: points, symbolSize: (v) => 6 + 18 * Math.sqrt(Math.abs(v[2]) / top),
      itemStyle: { color: P.series[0], opacity: 0.85, borderColor: P.card, borderWidth: 1 }, emphasis: { scale: 1.4 } }],
  };
}

function regionBars({ chart, rows, P, valueFmt, axisFmt, width }) {
  const sorted = [...rows].sort((a, b) => numberOf(b.y0) - numberOf(a.y0)).slice(0, 25);
  const cats = categoryLabels(sorted.map((r) => keyOf(r.x)), { width, fontSize: 11, side: true });
  return {
    title: note(P, 'No region code matches a bundled country shape, so the regions show ranked instead of on a map'),
    grid: { left: cats.left, right: 24, top: 12, bottom: 30 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: valueFmt(0) },
    xAxis: { type: 'value', axisLabel: label(P, { formatter: axisFmt(0) }), splitLine: split(P) },
    yAxis: { type: 'category', inverse: true, data: sorted.map((r) => keyOf(r.x)), axisLabel: label(P, cats.axisLabel), axisTick: { show: false } },
    series: [{ name: chart.y[0].label, type: 'bar', barMaxWidth: 22, itemStyle: { color: P.series[0], borderRadius: [0, 3, 3, 0] },
      data: sorted.map((r) => ({ value: r.y0, pick: keyOf(r.x) })) }],
  };
}

function mapRegionsOption(args) {
  const { chart, rows, P, valueFmt, axisFmt } = args;
  const matched = [];
  const missed = [];
  rows.forEach((r) => {
    const shape = shapeOf(r.x);
    if (shape) matched.push({ name: shape.name, value: numberOf(r.y0), pick: keyOf(r.x), box: shape.box });
    else missed.push(keyOf(r.x));
  });
  if (!matched.length) return regionBars(args);
  const values = matched.map((m) => m.value);
  return {
    tooltip: { trigger: 'item', formatter: (p) => (p.data ? `<b>${p.name}</b><br>${chart.y[0].label}: ${valueFmt(0)(p.data.value)}` : p.name) },
    title: missed.length ? note(P, `${missed.length} region${missed.length > 1 ? 's have' : ' has'} no bundled shape: ${missed.slice(0, 4).join(', ')}`) : undefined,
    visualMap: { min: Math.min(0, ...values), max: Math.max(1e-9, ...values), left: 8, top: 8, itemHeight: 90, calculable: false,
      textStyle: { color: P.muted, fontSize: 10 }, formatter: (v) => axisFmt(0)(v), inRange: { color: [P.well, P.series[0]] } },
    series: [{ type: 'map', map: WORLD, roam: true, boundingCoords: framed(matched.map((m) => m.box)), selectedMode: false,
      itemStyle: { areaColor: P.card, borderColor: P.line }, label: { show: false }, emphasis: { label: { show: false }, itemStyle: { areaColor: P.series[1] } },
      data: matched.map(({ box, ...m }) => m) }],
  };
}

function graphOption({ chart, rows, P, valueFmt }) {
  const edges = rows.filter((r) => r.x != null && r.s != null && keyOf(r.x) !== keyOf(r.s))
    .map((r) => ({ source: keyOf(r.x), target: keyOf(r.s), weight: Math.abs(numberOf(r.y0)), from: keyOf(r.y1), to: keyOf(r.y2) }))
    .sort((a, b) => b.weight - a.weight).slice(0, GRAPH_EDGES);
  const nodes = new Map();
  const add = (name, group, weight) => {
    const n = nodes.get(name) || { name, group, degree: 0 };
    n.degree += weight;
    nodes.set(name, n);
  };
  edges.forEach((e) => { add(e.source, e.from, e.weight); add(e.target, e.to, e.weight); });
  const groups = uniq([...nodes.values()].map((n) => n.group));
  const heaviest = Math.max(1e-9, ...[...nodes.values()].map((n) => n.degree));
  const widest = Math.max(1e-9, ...edges.map((e) => e.weight));
  return {
    legend: { top: 0, right: 0, type: 'scroll', data: groups, textStyle: { color: P.muted, fontSize: 11 }, pageTextStyle: { color: P.muted } },
    tooltip: { trigger: 'item', formatter: (p) => (p.dataType === 'edge' ? `${p.data.source} to ${p.data.target}<br>${chart.y[0].label}: <b>${valueFmt(0)(p.data.value)}</b>`
      : `<b>${p.name}</b><br>${chart.y[1]?.label || 'Community'}: ${groups[p.data.category]}`) },
    series: [{
      type: 'graph', layout: 'force', roam: true, top: 28, categories: groups.map((g, i) => ({ name: g, itemStyle: { color: P.series[i % P.series.length] } })),
      force: { repulsion: 140, edgeLength: [40, 120], gravity: 0.08, layoutAnimation: false },
      label: { show: nodes.size <= GRAPH_LABELS, position: 'right', color: P.ink, fontSize: 10, formatter: (p) => truncate(p.name, 14) },
      emphasis: { focus: 'adjacency' }, lineStyle: { color: 'source', opacity: 0.5, curveness: 0.08 },
      data: [...nodes.values()].map((n) => ({ name: n.name, category: groups.indexOf(n.group), value: n.degree, pick: n.name,
        symbolSize: 8 + 22 * Math.sqrt(n.degree / heaviest) })),
      links: edges.map((e) => ({ source: e.source, target: e.target, value: e.weight, pick: e.target, lineStyle: { width: 0.5 + 3 * (e.weight / widest) } })),
    }],
  };
}

export const KIND_CHARTS = { flow: flowOption, box: boxOption, map_points: mapPointsOption, map_regions: mapRegionsOption, graph: graphOption };
