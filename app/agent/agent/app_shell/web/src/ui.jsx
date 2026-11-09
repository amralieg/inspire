import { Children, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.jsx';
import { DETAILS_LABEL, splitTechnical } from './plainText.js';

const ToastContext = createContext(() => {});

const openDialog = () => [...document.querySelectorAll('dialog[open]')].pop() || null;
const toastHost = () => {
  const open = openDialog();
  return open?.querySelector('[data-toast-host]') || open || document.body;
};

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [, setMoved] = useState(0);
  const timer = useRef(0);
  const host = useRef(null);
  const shown = !!toast;
  useEffect(() => {
    if (!shown) return undefined;
    const watch = new MutationObserver(() => { if (toastHost() !== host.current) setMoved((n) => n + 1); });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    return () => watch.disconnect();
  }, [shown]);
  const hide = useCallback(() => setToast((t) => (t ? { ...t, on: false } : t)), []);
  const show = useCallback((text, tone = 'info', { actions = [], ms } = {}) => {
    clearTimeout(timer.current);
    setToast({ text, tone, actions, on: true, key: Date.now() });
    timer.current = setTimeout(hide, ms || (tone === 'error' ? 5200 : 2600));
  }, [hide]);
  const run = (action) => () => {
    clearTimeout(timer.current);
    hide();
    action.run();
  };
  host.current = toast ? toastHost() : null;
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && createPortal(
        <div key={toast.key} className={`toast ${toast.on ? 'is-on' : ''} ${toast.tone === 'error' ? 'toast--error' : ''}`} role="status">
          <span className="toast-t">{toast.text}</span>
          {toast.actions.length > 0 && (
            <span className="toast-a">{toast.actions.map((a) => <button key={a.label} type="button" onClick={run(a)} disabled={!toast.on}>{a.label}</button>)}</span>
          )}
        </div>,
        host.current,
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function TechnicalDetails({ items, label = DETAILS_LABEL }) {
  const lines = (Array.isArray(items) ? items : [items]).map((item) => String(item ?? '').trim()).filter(Boolean);
  if (!lines.length) return null;
  return <details className="tech-details" data-technical-details=""><summary>{label}</summary><pre>{lines.join('\n')}</pre></details>;
}

export function PlainNote({ text, as: Tag = 'p', icon = null, prefix = '', children, ...rest }) {
  const { plain, details } = splitTechnical(`${prefix}${text ?? ''}`);
  if (!plain && !details.length) return null;
  return <>{plain && <Tag {...rest}>{icon}{plain}{children}</Tag>}<TechnicalDetails items={details} /></>;
}

export function Failure({ failure, className, as: Tag = 'p', children }) {
  if (!failure?.text) return null;
  const calm = !!failure.calm;
  const { plain, details } = splitTechnical(failure.text);
  const shown = Children.map(children, (child) => (child === failure.text ? plain : child));
  return <><Tag className={calm ? 'note note--flat' : className} role={calm ? 'status' : 'alert'} data-calm={calm ? '' : undefined}>{shown}</Tag><TechnicalDetails items={details} /></>;
}

export function Popover({ anchor, onClose, children, label, role = 'dialog', width }) {
  const ref = useRef(null);
  const [at, setAt] = useState({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = ref.current.offsetWidth;
      const h = ref.current.scrollHeight;
      const roomBelow = window.innerHeight - 8 - (a.bottom + 6);
      const roomAbove = a.top - 6 - 8;
      const below = h <= roomBelow || roomBelow >= roomAbove;
      const room = Math.max(below ? roomBelow : roomAbove, 120);
      setAt({
        top: below ? a.bottom + 6 : a.top - 6 - Math.min(h, room),
        left: Math.max(8, Math.min(window.innerWidth - w - 8, a.left)),
        room,
      });
    };
    const moved = (e) => { if (!ref.current?.contains(e.target)) place(); };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', moved, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', moved, true); };
  }, [anchor]);
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor?.contains(e.target)) onClose(); };
    const key = (e) => {
      if (e.key !== 'Escape') return;
      if (anchor?.closest('dialog[open]')) e.preventDefault();
      onClose();
      anchor?.focus();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="pop" role={role} aria-label={label} style={{ top: at.top, left: at.left, width, maxHeight: at.room }}>{children}</div>,
    anchor?.closest('dialog[open]') || document.body,
  );
}

const menuButtons = (list) => [...(list?.querySelectorAll('[role^="menuitem"]') || [])];

export function Menu({ anchor, onClose, items, label }) {
  const list = useRef(null);
  useEffect(() => {
    const buttons = menuButtons(list.current);
    buttons[Math.max(0, items.findIndex((item) => item.checked))]?.focus();
  }, []);
  const move = (e) => {
    const buttons = menuButtons(list.current);
    const at = buttons.indexOf(document.activeElement);
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (next === undefined || !buttons.length) return;
    e.preventDefault();
    buttons[(next + buttons.length) % buttons.length].focus();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} label={label} role="menu">
      <div className="menu-list" ref={list} onKeyDown={move}>
        {items.map((item) => (
          <button key={item.label} role={item.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={item.checked}
            onClick={() => { onClose(); anchor?.focus(); item.run(); }}>
            {item.icon}<span className="menu-t">{item.label}{item.note && <small>{item.note}</small>}</span>
            {item.checked && <Icon name="check" size={14} className="menu-on" />}
          </button>
        ))}
      </div>
    </Popover>
  );
}

export const SoWhat = ({ text }) => (text ? <p className="so-what" data-so-what><b>So what:</b> {text}</p> : null);

export function Skeleton({ height = 16, width = '100%', radius = 8 }) {
  return <span className="skel" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

export function useDebounced(value, ms) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function useDialog(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return undefined;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
    const cancel = (e) => { e.preventDefault(); onClose(); };
    dlg.addEventListener('cancel', cancel);
    return () => dlg.removeEventListener('cancel', cancel);
  }, [open, onClose]);
  return ref;
}

export function SaidNote({ text, at, size = 12 }) {
  if (!text) return null;
  return <p className="choice-done" role="status" data-said={at}><Icon name="check" size={size} />{text}</p>;
}
