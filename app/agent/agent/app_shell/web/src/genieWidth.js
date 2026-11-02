export const GENIE_WIDTH_KEY = 'inspire-app-genie-width';
export const GENIE_MIN = 320;
export const GENIE_DEFAULT = 400;
export const GENIE_STEP = 32;
export const GENIE_MAX_SHARE = 0.6;
export const MAIN_MIN = 300;

export const genieMax = (viewport, room = Infinity) => Math.max(GENIE_MIN, Math.floor(Math.min(viewport * GENIE_MAX_SHARE + 1e-6, room - MAIN_MIN)));

export function clampGenie(width, viewport, room) {
  const n = Number(width);
  return Math.round(Math.min(genieMax(viewport, room), Math.max(GENIE_MIN, Number.isFinite(n) ? n : GENIE_DEFAULT)));
}

export function keyWidth(key, width, viewport, room) {
  const next = { ArrowLeft: width + GENIE_STEP, ArrowRight: width - GENIE_STEP, Home: GENIE_MIN, End: genieMax(viewport, room) }[key];
  return next === undefined ? null : clampGenie(next, viewport, room);
}

export function storedGenieWidth() {
  try {
    const saved = localStorage.getItem(GENIE_WIDTH_KEY);
    return /^\d+(\.\d+)?$/.test(saved || '') ? Number(saved) : GENIE_DEFAULT;
  } catch {
    return GENIE_DEFAULT;
  }
}

export function rememberGenieWidth(width) {
  try {
    localStorage.setItem(GENIE_WIDTH_KEY, String(width));
    return true;
  } catch {
    return false;
  }
}
