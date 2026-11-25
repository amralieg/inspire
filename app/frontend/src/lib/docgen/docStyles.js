// FX-113 (REQ-503): the 8 document styles and 4 colour palettes from the approved wireframe (frame 2b).
// `shape` and `deco` steer how docSvg draws each style (not only its colours).
export const DOC_STYLES = [
  { id: 'midnight', label: 'Midnight bold', bg: '#0F2027', surface: '#1B3139', ink: '#FFFFFF', muted: '#9FB3BA', accents: ['#FF3621', '#FF8A00', '#FFFFFF'], font: 'Helvetica, Arial, sans-serif', shape: 'bar', deco: 'band' },
  { id: 'executive', label: 'Clean executive', bg: '#FFFFFF', surface: '#F2F4F5', ink: '#1B3139', muted: '#6B7C83', accents: ['#1B3139', '#FF3621', '#DCE0E2'], font: 'Helvetica, Arial, sans-serif', shape: 'bar', deco: 'rule' },
  { id: 'vivid', label: 'Vivid playful', bg: '#FFF1E6', surface: '#FFFFFF', ink: '#2D2A4A', muted: '#7A6F8F', accents: ['#FF6F59', '#FFB347', '#6C5CE7'], font: 'Verdana, Helvetica, sans-serif', shape: 'round', deco: 'blobs' },
  { id: 'editorial', label: 'Calm editorial', bg: '#F4F1EA', surface: '#FBF9F4', ink: '#1F2D2A', muted: '#6F7A77', accents: ['#2F5D50', '#C9A227', '#7A8B8B'], font: 'Georgia, Times, serif', shape: 'line', deco: 'rule' },
  { id: 'neon', label: 'Neon data', bg: '#0B0B2B', surface: '#1C1850', ink: '#F4F2FF', muted: '#A9A4E0', accents: ['#F72585', '#4CC9F0', '#B5179E'], font: 'Helvetica, Arial, sans-serif', shape: 'glow', deco: 'grid' },
  { id: 'organic', label: 'Organic growth', bg: '#E8F5E9', surface: '#F7FCF7', ink: '#1B3A1F', muted: '#5D7A60', accents: ['#2E7D32', '#66BB6A', '#A5D6A7'], font: 'Verdana, Helvetica, sans-serif', shape: 'arch', deco: 'blobs' },
  { id: 'gold', label: 'Black and gold', bg: '#111111', surface: '#1E1E1E', ink: '#F3E9C6', muted: '#A39A7A', accents: ['#D4AF37', '#8C7323', '#444444'], font: 'Georgia, Times, serif', shape: 'line', deco: 'rule' },
  { id: 'blueprint', label: 'Blueprint', bg: '#EAF2FB', surface: '#F6FAFE', ink: '#0D2A4A', muted: '#4F6F91', accents: ['#1565C0', '#42A5F5', '#0D47A1'], font: 'Courier New, monospace', shape: 'bar', deco: 'grid' },
];

export const DOC_PALETTES = [
  { id: 'databricks', label: 'Databricks', colors: ['#FF3621', '#FF8A00', '#1B3139'] },
  { id: 'violet', label: 'Violet', colors: ['#6C5CE7', '#00B894', '#2D3436'] },
  { id: 'ocean', label: 'Ocean', colors: ['#0984E3', '#74B9FF', '#2C3E50'] },
  { id: 'rose', label: 'Rose', colors: ['#E84393', '#FDCB6E', '#2D3436'] },
];

const HEX = /^#[0-9a-f]{6}$/i;

// REQ-525: the Light / Dark theme choice. Light is the style as designed. Dark keeps the style's shapes, font and accents on a dark page.
export const DOC_THEMES = [{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }];
const DARK_BASE = { bg: '#121A1F', surface: '#1E2A30', ink: '#F2F5F6', muted: '#A9B8BE' };
const MIN_CONTRAST = 4.5;

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = channels(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastRatio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

// A colour mixed towards white in small steps until it reads at 4.5:1 on every background; unchanged when it already does.
function lift(hex, backgrounds) {
  const rgb = channels(hex);
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = toHex(rgb.map((v) => v + (255 - v) * t));
    if (backgrounds.every((bg) => contrastRatio(c, bg) >= MIN_CONTRAST)) return c;
  }
  return '#FFFFFF';
}
const isDarkStyle = (s) => luminance(s.bg) < 0.1 && luminance(s.surface) < 0.15 && luminance(s.ink) > 0.6;

// The style keeps its own look when the palette is "databricks" (the default); any other palette (or a custom brand colour) leads the accents.
// `mode` is 'light' (default, exactly the style) or 'dark' (REQ-525): a dark page, light text, and every accent and text colour at 4.5:1 or more.
export function resolveTheme(styleId, paletteId, customHex, mode = 'light') {
  const style = DOC_STYLES.find((s) => s.id === styleId) || DOC_STYLES[0];
  const palette = DOC_PALETTES.find((p) => p.id === paletteId) || DOC_PALETTES[0];
  let accents = paletteId && palette.id !== 'databricks' ? [...palette.colors] : [...style.accents];
  if (typeof customHex === 'string' && HEX.test(customHex.trim())) accents = [customHex.trim(), ...accents.slice(0, 2)];
  if (mode !== 'dark') return { ...style, paletteId: palette.id, accents, mode: 'light' };
  const base = isDarkStyle(style) ? { bg: style.bg, surface: style.surface, ink: style.ink, muted: style.muted } : DARK_BASE;
  const behind = [base.bg, base.surface];
  const muted = lift(base.muted, behind);
  return { ...style, ...base, muted, paletteId: palette.id, accents: accents.map((c) => lift(c, behind)), mode: 'dark', headFill: base.bg };
}
