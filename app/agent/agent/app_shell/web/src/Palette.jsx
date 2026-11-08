import { PALETTE_ORDER, paletteName, paletteSwatches } from './theme.js';

function Swatches({ palette, theme }) {
  return (
    <span className="swatches" aria-hidden="true">
      {paletteSwatches(palette, theme).map((color, i) => <i key={i} style={{ background: color }} />)}
    </span>
  );
}

export function paletteItems(palette, built, theme, onChoose) {
  return PALETTE_ORDER.map((p) => ({
    label: paletteName(p), note: p === built ? 'as built' : '', checked: p === palette, icon: <Swatches palette={p} theme={theme} />, run: () => onChoose(p),
  }));
}
