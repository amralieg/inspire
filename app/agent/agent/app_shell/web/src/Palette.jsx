import { useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { Menu } from './ui.jsx';
import { PALETTE_ORDER, paletteName, paletteSwatches } from './theme.js';

function Swatches({ palette, theme }) {
  return (
    <span className="swatches" aria-hidden="true">
      {paletteSwatches(palette, theme).map((color, i) => <i key={i} style={{ background: color }} />)}
    </span>
  );
}

export default function PaletteButton({ palette, built, theme, onChoose }) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const items = PALETTE_ORDER.map((p) => ({
    label: paletteName(p), note: p === built ? 'as built' : '', checked: p === palette, icon: <Swatches palette={p} theme={theme} />, run: () => onChoose(p),
  }));
  return (
    <>
      <button ref={anchor} className="ibtn" onClick={() => setOpen(!open)} aria-label="Change the colors" title="Change the colors" aria-haspopup="menu" aria-expanded={open}>
        <Icon name="palette" size={17} />
      </button>
      {open && <Menu anchor={anchor.current} onClose={() => setOpen(false)} items={items} label="Colors" />}
    </>
  );
}
