// C24 (RC7-B-13, REQ-121): the run's strategy document, built by the App when Results opens a finished run that lists none.
// One PDF with every use case, grouped by strategy objective (no objective: "Other use cases"), made with the same docgen code as Generate docs
// and saved once through the docs save route. There is no agent writer and no button (the FX-116 guards stay).
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildDocModel } from './docgen/docModel.js';
import { briefPagesSvg, esc } from './docgen/docSvg.js';
import { resolveTheme } from './docgen/docStyles.js';
import { defaultDocOptions } from './docgen/docOptions.js';
import { svgToPng, toBase64 } from './generateDocs.js';
import { hasStrategyDocument, artifactTreeFiles } from './artifactFiles.js';
import { sessionFailed, sessionFinished } from './monitorState.js';
import { strategyGoals, v130View } from './v130UseCase.js';
import { trackingIdOf } from './useCaseFields.js';

export const OTHER_USE_CASES = 'Other use cases';
const W = 794;
const H = 1123;

// The objective of a use case: the last segment of the first strategy path it is aligned to ('' when it has none).
export const objectiveOf = (uc) => strategyGoals(v130View(uc))[0]?.name || '';

// Use cases grouped by objective in first-seen order; those with no objective come last.
export function groupByObjective(useCases) {
  const groups = new Map();
  const none = [];
  for (const uc of useCases || []) {
    const name = objectiveOf(uc);
    if (!name) { none.push(uc); continue; }
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(uc);
  }
  const out = [...groups].map(([name, items]) => ({ name, items }));
  if (none.length) out.push({ name: OTHER_USE_CASES, items: none });
  return out;
}

// The heading page lists the objective's use cases by id and name (an index of the pages that follow).
const headingPage = (theme, name, items) => {
  const count = items.length;
  const label = `${count} use case${count === 1 ? '' : 's'}`;
  // Two columns of 28 rows; ids and names are cut to fit, the pages that follow carry each use case in full.
  const rows = items.slice(0, 56).map((uc, i) => `<text x="${60 + Math.floor(i / 28) * 340}" y="${630 + (i % 28) * 16}" font-size="11" fill="${theme.ink}">${esc([trackingIdOf(uc), uc.name || uc.Name || ''].filter(Boolean).join('  ').slice(0, 52))}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(theme.font)}">`
    + `<rect width="${W}" height="${H}" fill="${theme.bg}"/><rect x="60" y="470" width="120" height="8" fill="${theme.accents[0]}"/>`
    + `<text x="60" y="540" font-size="40" font-weight="700" fill="${theme.ink}">${esc(name)}</text>`
    + `<text x="60" y="584" font-size="18" fill="${theme.muted}">${esc(label)}</text>${rows}</svg>`;
};

// Every page of the strategy document as an SVG string: per objective one heading page, then the brief pages of its use cases.
export function strategyPagesSvg({ businessName, useCases, values, summary, foundations, options = defaultDocOptions() }) {
  const theme = resolveTheme(options.style, options.palette, options.customColor, options.theme);
  return groupByObjective(useCases).flatMap(({ name, items }) => {
    const m = buildDocModel({ businessName, useCases: items, values, options, summary, foundations });
    return [headingPage(theme, name, items), ...briefPagesSvg(m, theme)];
  });
}

export const strategyFileName = (businessName) => `${String(businessName || 'inspire').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'inspire'}_strategy.pdf`;

// True when the run is finished and well, has use cases, and every listing is read and shows no strategy PDF.
export function strategyDocNeeded({ session, useCases, rootFiles, tree }) {
  if (!sessionFinished(session) || sessionFailed(session)) return false;
  if (!Array.isArray(useCases) || useCases.length === 0) return false;
  if (!Array.isArray(rootFiles)) return false;
  const loaded = (dir) => tree?.[dir.path] && !tree[dir.path].loading;
  const folders = [];
  const walk = (files) => { for (const f of files || []) if (f?.is_directory) { folders.push(f); if (loaded(f)) walk(tree[f.path].files); } };
  walk(rootFiles);
  if (!folders.every(loaded)) return false;
  return !hasStrategyDocument(artifactTreeFiles(rootFiles, tree));
}

export async function saveStrategyDoc({ post, folder, businessName, useCases, values, summary, foundations, inspireDatabase, warehouseId, sessionId }) {
  const svgs = strategyPagesSvg({ businessName, useCases, values, summary, foundations });
  const pages = await Promise.all(svgs.map((s) => svgToPng(s, 2)));
  const { pdfFromImages } = await import('./docgen/pdfDoc.js');
  const bytes = await pdfFromImages(pages);
  // No use_case_ids: this document does not mark any use case as documented.
  await post('/api/inspire/docs/save', {
    inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId), folder, name: strategyFileName(businessName), content_base64: toBase64(bytes),
  });
}

// One build per run folder at a time and one save per run folder for the page's life, across re-renders and tabs of this page.
const inFlight = new Set();
const saved = new Set();

// Returns { state: 'idle' | 'building' | 'failed', retry }.
export function useStrategyDocument({ enabled, session, sessionId, folder, useCases, values, businessName, summary, foundations, rootFiles, tree, post, inspireDatabase, warehouseId, onSaved }) {
  const [state, setState] = useState('idle');
  const latest = useRef({});
  latest.current = { post, folder, businessName, useCases, values, summary, foundations, inspireDatabase, warehouseId, sessionId, onSaved };
  const key = `${sessionId}|${folder}`;
  const needed = enabled && Boolean(folder) && Boolean(post) && strategyDocNeeded({ session, useCases, rootFiles, tree });

  const run = useCallback(async () => {
    if (inFlight.has(key) || saved.has(key)) return;
    inFlight.add(key);
    setState('building');
    try {
      await saveStrategyDoc(latest.current);
      saved.add(key);
      setState('idle');
      latest.current.onSaved?.();
    } catch {
      setState('failed');
    } finally {
      inFlight.delete(key);
    }
  }, [key]);

  const failedOnce = useRef('');
  useEffect(() => {
    if (needed && failedOnce.current !== key) run();
  }, [needed, key, run]);
  useEffect(() => { if (state === 'failed') failedOnce.current = key; }, [state, key]);

  const retry = useCallback(() => { failedOnce.current = ''; run(); }, [run]);
  return { state: needed || state !== 'idle' ? state : 'idle', retry };
}
