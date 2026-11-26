// FX-114 (REQ-503): makes each planned document in the browser and saves it into the run's Assets folder through the App.
// The PowerPoint, Excel and PDF writers load here with import(), only when a person generates, so the main bundle does not carry them.
import { buildDocModel } from './docgen/docModel.js';
import { infographicSvg, briefPagesSvg } from './docgen/docSvg.js';
import { resolveTheme } from './docgen/docStyles.js';
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
export async function svgToPng(svg, scale = 1) {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg) || [];
  const natural = { w: Number(w) || 1200, h: Number(h) || 800 };
  const width = Math.round(natural.w * scale); const height = Math.round(natural.h * scale);
  const img = new Image();
  const loaded = new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('The picture could not be drawn.')); });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/png');
  return { dataUrl, width, height, bytes: Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0)) };
}

// The texts a second language needs: per use case, its name, statement, solution and value story.
export const textsToTranslate = (useCases, values, summary = []) => {
  const texts = {};
  summaryOf(summary).forEach((p, i) => { texts[`summary|${i}`] = p; });
  Object.assign(texts, labelTexts()); // RC6-B-11: the fixed labels of every document are translated with the data, never printed in English
  for (const uc of useCases) {
    const id = trackingIdOf(uc);
    const m = buildDocModel({ useCases: [uc], values, options: {} }).useCases[0];
    for (const [k, v] of [['name', m.name], ['statement', m.statement], ['solution', m.solution], ['story', m.value?.story]]) if (v) texts[`${id}|${k}`] = v;
  }
  return texts;
};

export function modelFor({ businessName, useCases, values, options, language, ids, translated, summary }) {
  const picked = useCases.filter((uc) => ids.includes(trackingIdOf(uc)));
  const m = buildDocModel({ businessName, useCases: picked, values, options: { ...options, languages: [language] }, summary });
  if (!translated) return m;
  m.labels = labelsFrom(translated);
  // REQ-526 part E: the executive summary is translated with the other texts, one entry per paragraph.
  if (m.summary.length) m.summary = m.summary.map((p, i) => translated[`summary|${i}`] || p);
  m.useCases.forEach((u) => {
    const t = (k) => translated[`${u.id}|${k}`];
    u.name = t('name') || u.name; u.statement = t('statement') || u.statement; u.solution = t('solution') || u.solution;
    if (u.value && t('story')) u.value = { ...u.value, story: t('story') };
  });
  return m;
}

async function makeFile(file, m, theme, options) {
  const scale = theme.design ? 2 : 1; // REQ-526: the A4 design pages (794x1123) are drawn at twice the size so the PDF text stays sharp
  if (file.kind === 'infographic') {
    const svg = infographicSvg(m, theme);
    // One PDF of all selected, the picture at full size.
    const png = await svgToPng(svg, scale);
    const { pdfFromImages } = await import('./docgen/pdfDoc.js');
    return pdfFromImages([png]);
  }
  if (file.kind === 'pdf') {
    const pages = await Promise.all(briefPagesSvg(m, theme).map((s) => svgToPng(s, scale)));
    const { pdfFromImages } = await import('./docgen/pdfDoc.js');
    return pdfFromImages(pages);
  }
  if (file.kind === 'pptx') { const { buildPptx } = await import('./docgen/pptxDoc.js'); return buildPptx(m, theme); }
  const { buildXlsx } = await import('./docgen/xlsxDoc.js');
  return toBytes(await buildXlsx(m, orderedColumns(options.columns), theme));
}

// onFile(name, state, message): state is working, done, failed or stopped. Returns the saved paths.
// REQ-525: once `signal` is aborted no new file starts (the one being made finishes) and each file not started ends as stopped.
export async function generateDocs({ plan, options, useCases, values, businessName, summary = [], folder, post, inspireDatabase, warehouseId, sessionId, onFile, signal = null }) {
  const theme = resolveTheme(options.style, options.palette, options.customColor, options.theme);
  const where = { inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) };
  const saved = [];
  for (const language of options.languages) {
    const files = plan.filter((f) => f.language === language);
    const halt = () => { files.forEach((f) => onFile(f.name, 'stopped')); };
    if (signal?.aborted) { halt(); continue; }
    let translated = null;
    if (language !== 'English') {
      try {
        const res = await post('/api/inspire/docs/translate', { ...where, language, texts: textsToTranslate(useCases, values, summary) });
        translated = res?.texts || {};
      } catch (e) {
        files.forEach((f) => onFile(f.name, 'failed', e?.message || 'The translation failed.'));
        continue;
      }
    }
    for (const file of files) {
      if (signal?.aborted) { onFile(file.name, 'stopped'); continue; }
      onFile(file.name, 'working');
      try {
        const m = modelFor({ businessName, useCases, values, options, language, ids: file.useCaseIds, translated, summary });
        m.sessionId = String(sessionId ?? '');
        m.appUrl = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}`.replace(/\/+$/, '') : '';
        const bytes = await toBytes(await makeFile(file, m, theme, options));
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
