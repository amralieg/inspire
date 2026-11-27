// FX-114 (REQ-503): makes each planned document in the browser and saves it into the run's Assets folder through the App.
// The PowerPoint, Excel and PDF writers load here with import(), only when a person generates, so the main bundle does not carry them.
import { buildDocModel } from './docgen/docModel.js';
import { infographicSvg } from './docgen/docSvg.js';
import { infographicFor } from './docgen/infographicApi.js';
import { pickInfographic, SCENARIO_IDS } from './docgen/designs/infographicPick.js';
import { buildAgentPdf, PDF_RASTER } from './docgen/agentPdf.js';
import { rasterPage } from './docgen/pngIndexed.js';
import { splitInfographic } from './docgen/designs/panelTiles.js';
import { agentLabelTexts, buildAgentModel } from './docgen/agentModel.js';
import { resolveTheme } from './docgen/docStyles.js';
import { storyFrom, storyTexts } from './docgen/storyParts.js';
import { trackingIdOf } from './useCaseFields.js';
import { summaryOf } from './docgen/docModel.js';
import { orderedColumns } from './docgen/docOptions.js';
import { labelTexts, labelsFrom } from './docgen/docLabels.js';

const toBytes = async (v) => (v instanceof Blob ? new Uint8Array(await v.arrayBuffer()) : v instanceof ArrayBuffer ? new Uint8Array(v) : v);

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// An SVG string drawn to a PNG: the width and height are the SVG's own.
export async function svgToPng(svg, scale = 1, { type = 'image/png', quality } = {}) {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg) || [];
  const natural = { w: Number(w) || 1200, h: Number(h) || 800 };
  const width = Math.round(natural.w * scale); const height = Math.round(natural.h * scale);
  const img = new Image();
  const loaded = new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('The picture could not be drawn.')); });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (type !== 'image/png') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); } // JPEG has no transparency
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL(type, quality);
  return { dataUrl, type, width, height, bytes: Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0)) };
}

// C28 (REQ-566): the Word charts are 560 px SVGs printed 6.5 in (468 pt) wide; scale 3 gives 1680 px = 258 DPI (scale 2 was 172).
export const DOCX_RASTER_SCALE = 3;

// The texts a second language needs: per use case, its name, statement, solution and value story.
export const textsToTranslate = (useCases, values, summary = [], businessName = '') => {
  const texts = {};
  summaryOf(summary).forEach((p, i) => { texts[`summary|${i}`] = p; });
  Object.assign(texts, labelTexts()); // RC6-B-11: the fixed labels of every document are translated with the data, never printed in English
  Object.assign(texts, agentLabelTexts()); // C25 (REQ-559): the agent PDF's labels, under agent|<key>
  // C28 (REQ-564): the story pages (executive summary, purpose, domains list) are built from the data once and translated under story|<part>|<key>.
  Object.assign(texts, storyTexts(buildAgentModel({ businessName, useCases, values, summary })));
  for (const uc of useCases) {
    const id = trackingIdOf(uc);
    const m = buildDocModel({ useCases: [uc], values, options: {} }).useCases[0];
    for (const [k, v] of [['name', m.name], ['statement', m.statement], ['solution', m.solution], ['story', m.value?.story]]) if (v) texts[`${id}|${k}`] = v;
  }
  return texts;
};

// C28 (REQ-572): the keys a vibe rewrites in English: the story pages and the session summary. Fixed labels and use case fields stay as they are.
const storyOnly = (texts) => Object.fromEntries(Object.entries(texts).filter(([k]) => k.startsWith('story|') || k.startsWith('summary|')));

// C28 (REQ-572): the person's wording guide and logo, read from the options and handed to every document kind and every LLM call.
export const docContext = (options = {}) => ({ vibe: String(options.vibe ?? '').trim(), logo: options.logo || null });

// The logo drawn to PNG bytes for Word (which takes no SVG); null when it cannot be drawn.
export async function logoPng(logo) {
  try {
    if (!logo?.dataUrl) return null;
    const img = new Image();
    const loaded = new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    img.src = logo.dataUrl; await loaded;
    const w = img.naturalWidth || 300; const h = img.naturalHeight || 100;
    const k = Math.min(1, 600 / w); const canvas = document.createElement('canvas'); canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/png');
    return { bytes: Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0)), w: canvas.width, h: canvas.height };
  } catch { return null; }
}

export function modelFor({ businessName, useCases, values, options, language, ids, translated, summary, foundations }) {
  const picked = useCases.filter((uc) => ids.includes(trackingIdOf(uc)));
  const m = buildDocModel({ businessName, useCases: picked, values, options: { ...options, languages: [language] }, summary, foundations });
  if (!translated) return m;
  m.labels = labelsFrom(translated);
  m.story = storyFrom(translated);
  // REQ-526 part E: the executive summary is translated with the other texts, one entry per paragraph.
  if (m.summary.length) m.summary = m.summary.map((p, i) => translated[`summary|${i}`] || p);
  m.useCases.forEach((u) => {
    const t = (k) => translated[`${u.id}|${k}`];
    u.name = t('name') || u.name; u.statement = t('statement') || u.statement; u.solution = t('solution') || u.solution;
    if (u.value && t('story')) u.value = { ...u.value, story: t('story') };
  });
  return m;
}

// REQ-561: a tile per use case with the panel's business fields. C26: one PDF page per chunk of at most three A4 pages.
// C27: the pages are JPEG at the agent PDF's settings (PDF_RASTER), so the file stays small enough for /api/inspire/docs/save.
export async function infographicPdf(m, theme, agent, rasterize, drawn = null) {
  const pages = [];
  for (const svg of splitInfographic(drawn || infographicSvg(m, theme, buildAgentModel(agent).ranked))) pages.push(await rasterPage(rasterize, svg, PDF_RASTER.scale, PDF_RASTER));
  const { pdfFromImages } = await import('./docgen/pdfDoc.js');
  return pdfFromImages(pages, PDF_RASTER.scale);
}

// C28 (REQ-571): the SVG of one use case's infographic. The pick route chooses the scenario and writes the story (the vibe text guides it); any failure
// (503, 502, junk, network) falls back to the local picker, so the file is always drawn. An explicitly chosen layout is sent as the scenario.
export async function drawInfographic(useCase, { options = {}, theme = null, post = null, where = {} } = {}) {
  const forced = SCENARIO_IDS.includes(options.infographicStyle) ? options.infographicStyle : '';
  const orientation = options.orientation || 'landscape';
  const { pick } = await pickInfographic(useCase, { post, vibe: String(options.vibe ?? '').trim(), scenario: forced, orientation, where });
  return infographicFor(useCase, { orientation, scenario: pick.scenario, content: pick, theme: theme || resolveTheme(options.style, options.palette, options.customColor, options.theme), logo: options.logo || '' });
}

async function makeFile(file, m, theme, options, agent, net = {}) {
  if (file.kind === 'infographic') {
    // C28 (REQ-570): one infographic per use case, picked by the model (or the local picker), drawn with the dialog's orientation, style, theme, vibe and logo.
    const drawn = await drawInfographic(agent.useCases[0], { options: { ...options, vibe: agent.vibe, logo: agent.logo }, theme, post: net.post, where: net.where });
    return infographicPdf(m, theme, agent, svgToPng, drawn);
  }
  if (file.kind === 'pdf') {
    // C25 (REQ-559): the PDF is the agent's catalog PDF plus value, in every style (the style still shapes the other kinds).
    return buildAgentPdf(agent, svgToPng);
  }
  if (file.kind === 'docx') { const { buildDocx } = await import('./docgen/docxDoc.js'); return buildDocx(m, theme, { chartPng: async (svg) => (await svgToPng(svg, DOCX_RASTER_SCALE)).bytes, views: buildAgentModel(agent).ranked }); }
  if (file.kind === 'pptx') { const { buildAgentPptx } = await import('./docgen/agentPptx.js'); return buildAgentPptx(agent); } // C25 (REQ-559): the agent's deck plus value
  const { buildXlsx } = await import('./docgen/xlsxDoc.js');
  return toBytes(await buildXlsx(m, orderedColumns(options.columns), theme));
}

// onFile(name, state, message): state is working, done, failed or stopped. Returns the saved paths.
// REQ-525: once `signal` is aborted no new file starts (the one being made finishes) and each file not started ends as stopped.
export async function generateDocs({ plan, options, useCases, values, businessName, summary = [], foundations = [], folder, post, inspireDatabase, warehouseId, sessionId, onFile, signal = null }) {
  const theme = resolveTheme(options.style, options.palette, options.customColor, options.theme);
  const where = { inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) };
  const saved = [];
  const ctx = docContext(options);
  for (const language of options.languages) {
    const files = plan.filter((f) => f.language === language);
    const halt = () => { files.forEach((f) => onFile(f.name, 'stopped')); };
    if (signal?.aborted) { halt(); continue; }
    let translated = null;
    if (language !== 'English') {
      try {
        const res = await post('/api/inspire/docs/translate', { ...where, language, vibe: ctx.vibe, texts: textsToTranslate(useCases, values, summary, businessName) });
        translated = res?.texts || {};
      } catch (e) {
        files.forEach((f) => onFile(f.name, 'failed', e?.message || 'The translation failed.'));
        continue;
      }
    } else if (ctx.vibe) {
      // C28 (REQ-572): the vibe also shapes English: the story texts go through one rewrite call; if it fails the deterministic texts stand.
      try {
        const res = await post('/api/inspire/docs/translate', { ...where, language, vibe: ctx.vibe, texts: storyOnly(textsToTranslate(useCases, values, summary, businessName)) });
        translated = res?.texts || null;
      } catch { translated = null; }
    }
    for (const file of files) {
      if (signal?.aborted) { onFile(file.name, 'stopped'); continue; }
      onFile(file.name, 'working');
      try {
        const m = modelFor({ businessName, useCases, values, options, language, ids: file.useCaseIds, translated, summary, foundations });
        m.sessionId = String(sessionId ?? '');
        m.vibe = ctx.vibe; m.logo = ctx.logo ? { ...ctx.logo, png: file.kind === 'docx' ? await logoPng(ctx.logo) : null } : null;
        m.appUrl = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}`.replace(/\/+$/, '') : '';
        const agent = { businessName, useCases: useCases.filter((uc) => file.useCaseIds.includes(trackingIdOf(uc))), values, summary, foundations, language, translated, logo: ctx.logo, vibe: ctx.vibe };
        const bytes = await toBytes(await makeFile(file, m, theme, { ...options, orientation: file.orientation || options.orientation }, agent, { post, where }));
        await post('/api/inspire/docs/save', { ...where, folder, name: file.name, content_base64: toBase64(bytes), use_case_ids: file.useCaseIds });
        saved.push(`${folder}/${file.name}`);
        onFile(file.name, 'done');
      } catch (e) {
        onFile(file.name, 'failed', e?.message || 'The file could not be made.');
      }
    }
  }
  return saved;
}

// The saved paths are marked new for Assets: kept for the session, merged with earlier ones, and announced to the page.
export function markNewDocs(sessionId, paths) {
  if (!paths.length) return;
  const key = `inspire:new-docs:${sessionId}`;
  let before = [];
  try { before = JSON.parse(sessionStorage.getItem(key) || '[]'); } catch { before = []; }
  const merged = [...new Set([...(Array.isArray(before) ? before : []), ...paths])];
  try { sessionStorage.setItem(key, JSON.stringify(merged)); } catch { /* storage full or blocked: the event still tells the page */ }
  window.dispatchEvent(new CustomEvent('inspire:new-docs', { detail: { sessionId: String(sessionId), paths } }));
}
