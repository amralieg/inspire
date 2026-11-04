import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.jsx';
import { Menu } from './ui.jsx';
import { topFit } from './topbar.js';

const TopContext = createContext({ slot: null, fit: 'full', pageMore: { current: [] } });

export function useTopFit() {
  const ref = useRef(null);
  const [fit, setFit] = useState('full');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setFit(topFit(el.getBoundingClientRect().width));
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, fit];
}

export function TopProvider({ slot, fit, pageMore, children }) {
  return <TopContext.Provider value={{ slot, fit, pageMore }}>{children}</TopContext.Provider>;
}

export function TopTools({ more = [], children }) {
  const { slot, pageMore } = useContext(TopContext);
  useLayoutEffect(() => { pageMore.current = more; });
  useEffect(() => () => { pageMore.current = []; }, [pageMore]);
  return slot ? createPortal(children, slot) : null;
}

export function TopMore({ fit, items, pageMore }) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(null);
  if (fit !== 'tight' && fit !== 'narrow') return null;
  const moved = pageMore.current.filter((item) => fit === 'narrow' || item.more === 'tight');
  const all = [...moved, ...items].map((item) => (item.sub ? { ...item, run: () => setSub(item.sub()) } : item));
  return (
    <>
      <button ref={anchor} className="ibtn top-more" onClick={() => setOpen(!open)} aria-label="More" title="More" aria-haspopup="menu" aria-expanded={open}>
        <Icon name="dots" size={17} />
      </button>
      {open && <Menu anchor={anchor.current} onClose={() => setOpen(false)} items={all} label="More" />}
      {sub && <Menu anchor={anchor.current} onClose={() => setSub(null)} items={sub.items} label={sub.label} />}
    </>
  );
}
