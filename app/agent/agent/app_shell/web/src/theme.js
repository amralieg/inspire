import PALETTES from './palettes.json';
import { HUES, SERIES_TOKENS, TIER_TOKENS, themeTokens } from './tokens.js';

export { HUES };
export const PALETTE_ORDER = ['default', 'muted', 'vivid', 'ocean', 'sunset', 'earth', 'jewel', 'nordic', 'berry', 'pop', 'neon', 'solid', 'mono'];
export const TIERS = ['Act now', 'Review', 'Monitor'];
export const PALETTE_KEY = 'inspire-app-palette';

export const paletteName = (palette) => (palette === 'default' ? 'Databricks' : palette.charAt(0).toUpperCase() + palette.slice(1));
export const paletteSwatches = (palette, theme) => { const t = themeTokens(PALETTES, palette, theme); return SERIES_TOKENS.map((k) => t[k]); };

export function storedPalette(built) {
  try {
    const saved = localStorage.getItem(PALETTE_KEY);
    return PALETTE_ORDER.includes(saved) ? saved : built;
  } catch {
    return built;
  }
}

export function rememberPalette(palette, built) {
  try {
    if (palette === built) localStorage.removeItem(PALETTE_KEY);
    else localStorage.setItem(PALETTE_KEY, palette);
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(palette, theme, look) {
  const doc = document.documentElement;
  Object.entries(themeTokens(PALETTES, palette, theme)).forEach(([k, v]) => doc.style.setProperty(`--${k}`, v));
  doc.dataset.theme = theme;
  doc.dataset.look = look;
  doc.style.colorScheme = theme;
}

export function chartPalette() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return {
    ink: g('--ink'), muted: g('--muted'), line: g('--line'), card: g('--card'), well: g('--well'),
    font: getComputedStyle(document.body).fontFamily,
    series: SERIES_TOKENS.map((t) => g(`--${t}`)),
    tier: Object.fromEntries(TIERS.map((t) => [t, g(`--${TIER_TOKENS[t]}`)])),
  };
}

export const hueVars = (hue) => ({ '--hue-line': `var(--${hue}-line)`, '--hue-bg': `var(--${hue}-bg)`, '--hue-tile': `var(--${hue}-tile)`, '--hue-ink': `var(--${hue}-ink)` });

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
