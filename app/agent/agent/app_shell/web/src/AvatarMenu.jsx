import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { sectionTitle } from './modes.js';
import { ADMIN_ROUTE } from './admin.js';

const OWNER_SECTIONS = ['runs', 'alerts', 'performance', 'impact'];
const ICONS = { runs: 'history', alerts: 'bell', performance: 'trend', impact: 'trend', settings: 'sliders' };

export function initials(user) {
  const source = user?.name || user?.email || '';
  const parts = source.split(/[@.\s_-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();
}

// REQ-506: the one place for everything that is not the mission: theme, tour, Settings, and for owners the operator screens.
export default function AvatarMenu({ user, chrome, page, app, sections, onSection, onTour, canTour }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', away);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', away); };
  }, [open]);
  const owner = app?.is_owner === true || page?.is_owner === true;
  const pick = (run) => () => { setOpen(false); run(); };
  const place = (s) => (
    <button key={s} type="button" role="menuitem" className="av-i" onClick={pick(() => onSection(s))}><Icon name={ICONS[s]} size={15} />{sectionTitle(page, s)}</button>
  );
  const who = user?.name || user?.email || 'Menu';
  return (
    <div className="av" data-avatar-menu="" ref={box}>
      <button type="button" className="av-b" aria-haspopup="menu" aria-expanded={open} aria-label={`${who}, menu`} title={user?.email || user?.name || undefined} onClick={() => setOpen(!open)}>
        <span className="avatar">{initials(user)}</span>
        {user?.name && <span className="av-n">{user.name}</span>}
      </button>
      {open && (
        <div className="av-menu" role="menu" aria-label="Menu">
          <button type="button" role="menuitem" className="av-i" onClick={pick(chrome.onTheme)}>
            <Icon name={chrome.theme === 'dark' ? 'sun' : 'moon'} size={15} />Switch to {chrome.theme === 'dark' ? 'light' : 'dark'} theme
          </button>
          <button type="button" role="menuitem" className="av-i" disabled={!canTour} onClick={pick(onTour)}><Icon name="info" size={15} />Take the tour</button>
          {page && sections.includes('settings') && place('settings')}
          {owner && page && OWNER_SECTIONS.filter((s) => sections.includes(s) && !(s === 'alerts' && sections.includes('runs'))).map(place)}
          {owner && <a role="menuitem" className="av-i" href={`#/${ADMIN_ROUTE}`} onClick={() => setOpen(false)}><Icon name="sliders" size={15} />Admin</a>}
        </div>
      )}
    </div>
  );
}
