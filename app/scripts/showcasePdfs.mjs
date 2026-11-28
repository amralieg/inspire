// C33 (REQ-560): the PDFs a recorded demo lists. A live PDF is drawn pages, so its text is pixels: the recorder cannot clean the catalog, folder or
// person it shows. The demo PDFs are drawn again here, with the App's own PDF writer (buildAgentPdf), from the cleaned answers already in the bundle,
// the way the Review page builds them: the strategy PDF from every use case grouped by objective (strategyDoc.js), any other PDF from the use cases
// that have documents (generateDocs.js). Each is drawn at the resolution that fits its share of the bundle size the App allows.
// CLI: node scripts/showcasePdfs.mjs <bundle.json.gz> [banned words...]  rewrites the bundle with the PDFs it lists.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { showcaseLeaks, showcaseSizes, showcaseFile, SHOWCASE_MAX_BYTES } = require(path.join(APP, 'backend/lib/showcaseRecord.js'));
const lib = (p) => import(pathToFileURL(path.join(APP, 'frontend/src/lib', p)).href);

// The demo PDFs are read on screen, so they may be drawn at 70% of the screen resolution to fit the bundle (the App's own floor is 1).
export const DEMO_MIN_SCALE = 0.7;

// A PDF's bytes in the gzipped bundle: base64 text of compressed pages gzips back to about its own size, plus a few percent.
const GZ_BASE64 = 1.04;

const answer = (bundle, re) => Object.entries(bundle.inspire).find(([k, v]) => re.test(k) && v.status === 200)?.[1]?.body;

// The rasterizer the App uses (generateDocs.svgToPng), run in a page of a headless browser.
export const pageRasterize = (page) => async (svg, scale = 1, { type = 'image/png', quality } = {}) => {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg) || [];
  const dataUrl = await page.evaluate(async ([s, k, t, q]) => {
    const [, sw, sh] = /width="(\d+)" height="(\d+)"/.exec(s) || [];
    const img = new Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`; });
    const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(t, q);
  }, [svg, scale, type, quality]);
  return { dataUrl, width: Math.round(w * scale), height: Math.round(h * scale), type };
};

// The PDFs the bundle's folder listings name and has no answer for: [{ key, file, strategy }].
export function missingPdfs(bundle) {
  const out = [];
  for (const [k, v] of Object.entries(bundle.inspire)) {
    if (!k.startsWith('GET /api/workspace/list?') || v.status !== 200) continue;
    for (const file of v.body?.files || []) {
      if (file.is_directory || !/\.pdf$/i.test(file.name)) continue;
      const key = `GET /api/workspace/export?${new URLSearchParams({ path: file.path })}`;
      if (!bundle.inspire[key] && !out.some((x) => x.key === key)) out.push({ key, file, strategy: /_strategy\.pdf$/i.test(file.name) });
    }
  }
  return out;
}

// The arguments the Review page gives the PDF writer, from the bundle's answers.
export async function pdfArgs(bundle) {
  const sid = String(bundle.session_id);
  const { buildUseCaseList } = await lib('useCaseList.js');
  const { docValuesOf } = await lib('docgen/docValues.js');
  const { executiveSummaryOf } = await lib('reviewFigures.js');
  const results = answer(bundle, new RegExp(`^GET /api/inspire/results\\?session_id=${sid}$`))?.results;
  if (!results) throw new Error(`${bundle.id}: the bundle has no results answer for session ${sid}`);
  const usecases = answer(bundle, new RegExp(`^GET /api/inspire/usecases\\?session_id=${sid}$`))?.usecases || null;
  const totals = answer(bundle, new RegExp(`^GET /api/inspire/value/totals\\?session_id=${sid}$`)) || null;
  const useCases = buildUseCaseList(results, usecases?.length ? usecases : null);
  return {
    businessName: bundle.business, useCases, values: docValuesOf({ byId: {}, totals }),
    summary: executiveSummaryOf(results), foundations: results.foundations || [], date: String(bundle.recorded_at || '').slice(0, 10) || undefined,
  };
}

// Adds an export answer for each listed PDF, drawn to fit `room` bytes of the bundle in total, and sets each listing's file_size to the bytes kept.
// rasterize: (svg, scale, opts) => image, as svgToPng. Returns [{ name, bytes, use_cases }]. Throws when a page text names a banned word or a PDF does not fit.
export async function addShowcasePdfs(bundle, rasterize, { banned = [], room = Math.floor(SHOWCASE_MAX_BYTES * 0.97) - showcaseSizes(bundle).gzip, log = () => {} } = {}) {
  const todo = missingPdfs(bundle);
  if (!todo.length) return [];
  const { buildAgentPdf, agentPdfSvgs } = await lib('docgen/agentPdf.js');
  const { groupByObjective } = await lib('strategyDoc.js');
  const { trackingIdOf } = await lib('useCaseFields.js');
  const base = await pdfArgs(bundle);
  const documented = base.useCases.filter((u) => u.docs_generated_at);
  const made = [];
  for (const [i, { key, file, strategy }] of todo.entries()) {
    const args = strategy ? { ...base, groups: groupByObjective, groupLabelKey: 'objective_label' } : { ...base, useCases: documented.length ? documented : base.useCases };
    const text = agentPdfSvgs(args).join('\n');
    const leaks = showcaseLeaks({ inspire: { [key]: { status: 200, body: { text } } } }, banned);
    if (leaks.length) throw new Error(`${file.name}: the page text names private details: ${leaks.slice(0, 5).join('; ')}`);
    const share = Math.floor((room - made.reduce((n, m) => n + m.bytes, 0)) / (todo.length - i));
    const bytes = Buffer.from(await buildAgentPdf(args, rasterize, { maxBytes: Math.min(Math.floor(share / GZ_BASE64), 8 * 1024 * 1024), minScale: DEMO_MIN_SCALE }));
    bundle.inspire[key] = { status: 200, body: bytes.toString('base64'), base64: true, type: 'application/pdf' };
    for (const v of Object.values(bundle.inspire)) for (const f of v.body?.files || []) if (f.path === file.path) f.file_size = bytes.length;
    made.push({ name: file.name, bytes: bytes.length, use_cases: args.useCases.length, ids: args.useCases.slice(0, 3).map(trackingIdOf) });
    log(`${bundle.id}: ${file.name} ${bytes.length} bytes, ${args.useCases.length} use cases`);
  }
  return made;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [file, ...banned] = process.argv.slice(2);
  const zlib = await import('node:zlib');
  const bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  const { chromium } = require(path.join(APP, 'frontend/node_modules/playwright'));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const made = await addShowcasePdfs(bundle, pageRasterize(page), { banned, log: console.log });
    const leaks = showcaseLeaks(bundle, banned);
    if (leaks.length) throw new Error(`the bundle names private details, so nothing was written:\n${leaks.slice(0, 20).join('\n')}`);
    const { gzip } = showcaseSizes(bundle);
    if (gzip > SHOWCASE_MAX_BYTES) throw new Error(`the bundle is ${gzip} bytes compressed, over ${SHOWCASE_MAX_BYTES}, so nothing was written`);
    if (made.length) fs.writeFileSync(file, showcaseFile(bundle));
    console.log(JSON.stringify({ file: path.basename(file), made, gzip }));
  } finally { await browser.close(); }
}
