const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

export const renderedTexts = (svg) => [...String(svg).matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)]
  .map((m) => m[1].replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]).trim()).filter(Boolean);

export function cutLabels(svg, names) {
  const texts = renderedTexts(svg);
  return names.filter((name) => !texts.includes(name));
}

export function rendererEntry(src) {
  return `import echarts from ${JSON.stringify(`${src}/echarts.js`)};\n`
    + `import ${JSON.stringify(`${src}/echartsKinds.js`)};\nimport ${JSON.stringify(`${src}/echartsFlow.js`)};\n`
    + `import { chartOption } from ${JSON.stringify(`${src}/charts.js`)};\n`
    + 'const draw = (option, width, height) => { const e = echarts.init(null, null, { renderer: "svg", ssr: true, width, height });'
    + ' e.setOption({ ...option, animation: false }); const svg = e.renderToSVGString(); e.dispose(); return svg; };\n'
    + 'const plain = (axis) => [].concat(axis || []).map((a) => ({ type: a.type, data: a.data, label: Object.fromEntries(Object.entries(a.axisLabel || {}).filter(([, v]) => typeof v !== "function")),'
    + ' formatted: typeof a.axisLabel?.formatter === "function" }));\n'
    + 'window.drawChart = (chart, rows, P, width, height = 360) => { const option = chartOption(chart, rows, P, { reduced: true, width });'
    + ' return { svg: draw(option, width, height), x: plain(option.xAxis), y: plain(option.yAxis), grid: option.grid, tooltip: option.tooltip?.trigger }; };\n'
    + 'window.drawOption = (option, width, height = 360) => draw(option, width, height);\n';
}
