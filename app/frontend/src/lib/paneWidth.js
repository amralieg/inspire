export const RAIL_WIDTH = { key: 'inspire.implement_rail_width', min: 240, max: 520, start: 320, step: 16 };
export const DRAWER_WIDTH = { key: 'inspire.drawer_width', min: 400, max: 1100, start: 640, step: 32 };

export function paneWidth(limits, value) {
  const n = value === null || value === undefined || value === '' ? NaN : Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(limits.max, Math.max(limits.min, n)) : limits.start;
}

export function loadPaneWidth(limits, storage = globalThis.localStorage) {
  try {
    return paneWidth(limits, storage?.getItem(limits.key));
  } catch {
    return limits.start;
  }
}

export function savePaneWidth(limits, width, storage = globalThis.localStorage) {
  try {
    storage.setItem(limits.key, String(paneWidth(limits, width)));
    return true;
  } catch {
    return false;
  }
}

export function resizeKeyWidth(limits, width, key, grows = 1) {
  const step = limits.step * grows;
  return { ArrowLeft: width - step, ArrowRight: width + step, Home: limits.min, End: limits.max }[key];
}
