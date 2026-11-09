export const TOUR_GAP = 14;
export const TOUR_PAD = 6;
export const TOUR_EDGE = 8;
export const TOUR_WAIT_MS = 4000;
const SENTENCE = /[^]*?(?:[.!?](?=\s|$)|[。！？؟।]|$)\s*/gu;
const TOKEN = /\{([^{}]*)\}/g;

export function sentencesOf(text) {
  return (String(text || '').match(SENTENCE) || []).filter(Boolean);
}

export function factOf(name, facts) {
  if (!facts) return '';
  if (name.startsWith('kpi:')) return facts.kpis?.[name.slice(4)] || '';
  const value = facts[name];
  return value == null ? '' : String(value);
}

export function fillTourText(text, facts) {
  return sentencesOf(text).map((s) => {
    let missing = false;
    const filled = s.replace(TOKEN, (_, name) => {
      const value = factOf(name, facts).trim();
      if (!value) missing = true;
      return value;
    });
    return missing ? '' : filled;
  }).join('').trim();
}

export function pickTourLanguage(languages, wanted = []) {
  const shown = (languages || []).filter((l) => l.steps?.length);
  if (!shown.length) return null;
  for (const tag of wanted || []) {
    const lower = String(tag || '').toLowerCase();
    const hit = shown.find((l) => l.code === lower) || shown.find((l) => lower.split('-')[0] === l.code);
    if (hit) return hit;
  }
  return shown[0];
}

export function tourSection(anchor, tour, queue) {
  if ((tour?.rail || []).includes(anchor)) return null;
  return queue && (tour?.records || []).includes(anchor) ? 'work' : 'dashboard';
}

export function holeOf(rect, view, pad = TOUR_PAD) {
  const left = Math.max(rect.left - pad, 2);
  const top = Math.max(rect.top - pad, 2);
  const right = Math.min(rect.right + pad, view.width - 2);
  const bottom = Math.min(rect.bottom + pad, view.height - 2);
  return { left, top, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
}

export function placeTour(hole, pop, view, dir = 'ltr') {
  const clampX = (x) => Math.min(Math.max(x, TOUR_EDGE), Math.max(view.width - pop.width - TOUR_EDGE, TOUR_EDGE));
  const clampY = (y) => Math.min(Math.max(y, TOUR_EDGE), Math.max(view.height - pop.height - TOUR_EDGE, TOUR_EDGE));
  const across = dir === 'rtl' ? hole.left + hole.width - pop.width : hole.left;
  const below = hole.top + hole.height + TOUR_GAP;
  if (below + pop.height <= view.height - TOUR_EDGE) return { left: clampX(across), top: below, side: 'below' };
  const above = hole.top - TOUR_GAP - pop.height;
  if (above >= TOUR_EDGE) return { left: clampX(across), top: above, side: 'above' };
  const after = dir === 'rtl' ? hole.left - TOUR_GAP - pop.width : hole.left + hole.width + TOUR_GAP;
  if (after >= TOUR_EDGE && after + pop.width <= view.width - TOUR_EDGE) return { left: after, top: clampY(hole.top), side: 'beside' };
  const before = dir === 'rtl' ? hole.left + hole.width + TOUR_GAP : hole.left - TOUR_GAP - pop.width;
  if (before >= TOUR_EDGE && before + pop.width <= view.width - TOUR_EDGE) return { left: before, top: clampY(hole.top), side: 'beside' };
  return { left: dir === 'rtl' ? TOUR_EDGE : clampX(view.width), top: clampY(view.height), side: 'over' };
}
