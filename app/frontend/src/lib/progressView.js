import { useState } from 'react';

export function useProgressView(scope, active, openByDefault) {
  const [view, setView] = useState({ scope: null, active: null, open: null, large: false });
  const mine = view.scope === scope && view.active === active ? view : { open: null, large: false };
  const open = mine.open ?? openByDefault;
  const keep = (open, large) => setView({ scope, active, open, large });
  return {
    open,
    large: open && mine.large,
    toggle: () => keep(!open, mine.large),
    expand: () => keep(true, mine.large),
    enlarge: () => keep(mine.open, !mine.large),
  };
}
