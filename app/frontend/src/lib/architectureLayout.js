// Lays out a solution architecture as a left-to-right diagram on a fixed 1000-wide canvas that the card scales, so it never scrolls.
// Columns are fixed stages: the use case's own tables, ingest and transform, intelligence, serve, use. Governance and the build tool
// sit outside the flow and are shown as strips under the diagram.

export const STAGES = [
  { id: 'sources', label: 'Your data', lanes: [], color: '#8a939b' },
  { id: 'ingest', label: 'Ingest & transform', lanes: ['ingest', 'transform'], color: '#2f9d9d' },
  { id: 'ai', label: 'Intelligence', lanes: ['ai'], color: '#c25a85' },
  { id: 'serve', label: 'Serve', lanes: ['serve'], color: '#d49a00' },
  { id: 'use', label: 'Use', lanes: ['use'], color: '#5f9a43' },
];

export const OUTSIDE_FLOW = new Set(['govern', 'build']);

// Official Databricks product icons, served from /icons/databricks/.
const ICONS = {
  lakeflow_connect: 'lakeflow-connect.svg',
  auto_loader: 'lakeflow-connect.svg',
  zerobus: 'data-streaming.svg',
  lakeflow_pipelines: 'lakeflow-pipelines.svg',
  lakeflow_jobs: 'lakeflow-jobs.svg',
  metric_views: 'unity-catalog.svg',
  genie_code: 'genie-code.svg',
  ai_functions: 'mosaic-ai.svg',
  mlflow: 'mlflow.svg',
  feature_store: 'mosaic-ai.svg',
  model_serving: 'model-serving.svg',
  vector_search: 'vector-search.svg',
  agent_bricks: 'agent-bricks.svg',
  delta_tables: 'delta-lake-mark.svg',
  lakebase: 'lakebase.svg',
  genie_agent: 'genie.svg',
  aibi_dashboard: 'ai-bi-dashboards.svg',
  databricks_app: 'apps.svg',
  sql_alerts: 'databricks-sql.svg',
  delta_sharing: 'delta-sharing.svg',
  unity_catalog: 'unity-catalog.svg',
};

export const iconUrl = (id) => `/icons/databricks/${ICONS[id] || 'delta-lake-mark.svg'}`;

/** The stage column of a lane; an unknown lane goes to the first stage after the sources. */
export const stageOf = (lane) => Math.max(1, STAGES.findIndex((s) => s.lanes.includes(lane)));

export const LANE_COLOR = Object.fromEntries([...STAGES.flatMap((st) => st.lanes.map((l) => [l, st.color])), ['govern', '#8a939b'], ['build', '#8a939b']]);

export const VB_W = 1000;
const PAD = 4;
const GAP = 46;
export const COL_W = (VB_W - PAD * 2 - GAP * (STAGES.length - 1)) / STAGES.length;
export const CARD_H = 46;
export const ROW_GAP = 16;
export const TOP = 30;
const MAX_SOURCES = 6;
export const colX = (k) => PAD + k * (COL_W + GAP);

/** The product name without its bracketed detail, as a box shows it: "AI Functions (ai_query, ...)" reads "AI Functions". */
export const shortName = (name) => String(name || '').replace(/\s*\(.*\)\s*$/, '');

/**
 * Places every flow component in its stage column and orders each column so a box sits level with what feeds it. Flows that point
 * backwards (results feeding a retrain) are not drawn; they are listed as feedback loops, so every drawn arrow goes left to right.
 */
export function layoutArchitecture(design) {
  const components = Array.isArray(design?.components) ? design.components : [];
  const flows = Array.isArray(design?.flows) ? design.flows : [];
  const drawn = components.filter((c) => !OUTSIDE_FLOW.has(c.lane));
  const ids = new Set(drawn.map((c) => c.id));
  const col = new Map(drawn.map((c) => [c.id, stageOf(c.lane)]));
  const edges = flows.filter((f) => ids.has(f.from) && ids.has(f.to) && f.from !== f.to);
  const forward = edges.filter((e) => col.get(e.to) > col.get(e.from));
  const same = edges.filter((e) => col.get(e.to) === col.get(e.from));
  const loops = edges.filter((e) => col.get(e.to) < col.get(e.from));

  const allSources = Array.isArray(design?.sources) ? design.sources : [];
  const sources = allSources.slice(0, MAX_SOURCES).map((t) => String(t).split('.').pop());
  const more = allSources.length - sources.length;
  const sourceRows = sources.length + (more > 0 ? 1 : 0);

  const counts = STAGES.map((_, k) => drawn.filter((c) => col.get(c.id) === k).length);
  const rows = Math.max(1, sourceRows, ...counts);
  const step = CARD_H + ROW_GAP;
  const yAt = (n, i) => TOP + ((rows - n) * step) / 2 + i * step;

  const pos = new Map();
  const srcBoxes = sources.map((name, i) => ({ name, x: colX(0), y: yAt(sourceRows, i) }));
  const srcMid = sourceRows ? yAt(sourceRows, 0) + ((sourceRows - 1) * step) / 2 : TOP;
  const firstCol = drawn.length ? Math.min(...drawn.map((c) => col.get(c.id))) : 1;

  for (let k = 1; k < STAGES.length; k += 1) {
    const inCol = drawn.filter((c) => col.get(c.id) === k);
    const score = (id) => {
      const ys = forward.filter((e) => e.to === id && pos.has(e.from)).map((e) => pos.get(e.from).y);
      if (ys.length) return ys.reduce((a, b) => a + b, 0) / ys.length;
      return k === firstCol ? srcMid : Infinity;
    };
    const order = [...inCol].sort((a, b) => score(a.id) - score(b.id)).map((c) => c.id);
    // Within a column, whatever feeds another box goes above it.
    for (let pass = 0; pass < order.length; pass += 1) {
      for (const e of same) {
        const a = order.indexOf(e.from);
        const b = order.indexOf(e.to);
        if (a > b) order.splice(b, 0, ...order.splice(a, 1));
      }
    }
    order.forEach((id, i) => pos.set(id, { x: colX(k), y: yAt(order.length, i), lane: drawn.find((c) => c.id === id).lane }));
  }

  // The use case's tables enter at the first-column boxes that nothing else in their column feeds.
  const entries = sources.length ? drawn.filter((c) => col.get(c.id) === firstCol && !same.some((e) => e.to === c.id)).map((c) => c.id) : [];
  return { pos, srcBoxes, more, srcMid, forward, same, loops, entries, height: TOP + rows * step - ROW_GAP + PAD + 2 };
}

export const usd = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
