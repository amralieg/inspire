import { Children, Fragment, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.jsx';
import { COPIED_SEND_TEXT, COPY_SEND_LABEL, DETAILS_LABEL, RETRYING_LABEL, RETRY_LABEL, sendText, splitTechnical } from './plainText.js';
import { retryable, toneOf } from './api.js';

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

export const NO_ACCESS_LEAD = 'No access to ';
const SOME_DATA = "part of this App's data";
const NoAccessContext = createContext(null);

export function noAccessOf(text) {
  const said = String(text ?? '').trim();
  if (!said.startsWith(NO_ACCESS_LEAD)) return null;
  const named = said.slice(NO_ACCESS_LEAD.length);
  return named.startsWith(SOME_DATA) ? [] : named.split(', ').map((t) => t.trim()).filter(Boolean);
}

export function noAccessBanner(tables, owners, auth) {
  const who = [...new Set(tables.map((t) => owners?.[t]).filter(Boolean))];
  const reader = auth === 'user' ? 'You cannot' : 'This App cannot';
  const what = tables.length ? tables.join(', ') : SOME_DATA.replace("this App's", 'its');
  const grant = `${who.length ? who.join(', ') : 'The owner of that data'} can give ${auth === 'user' ? 'you' : 'the App'} read access in Unity Catalog`;
  return `${reader} read ${what} yet, so parts of this page show no data from ${tables.length === 1 ? 'it' : 'them'}. ${grant}. Then press Check again.`;
}

function useNoAccess(tables) {
  const scope = useContext(NoAccessContext);
  const key = tables ? JSON.stringify(tables) : '';
  useEffect(() => (key && scope ? scope.report(JSON.parse(key)) : undefined), [key, scope]);
  return Boolean(scope);
}

function NoAccessLine({ tables, as: Tag, icon, rest }) {
  return <Tag {...rest} data-no-access="">{icon}{tables.length ? `${NO_ACCESS_LEAD}${tables.join(', ')}` : `${NO_ACCESS_LEAD}this data`}</Tag>;
}

export function NoAccessScope({ app, children }) {
  const [seen, setSeen] = useState({});
  const [round, setRound] = useState(0);
  const report = useCallback((tables) => {
    const id = Symbol('no-access');
    setSeen((s) => ({ ...s, [id]: tables }));
    return () => setSeen((s) => { const next = { ...s }; delete next[id]; return next; });
  }, []);
  const scope = useMemo(() => ({ report }), [report]);
  const lists = Object.getOwnPropertySymbols(seen).map((id) => seen[id]);
  const tables = [...new Set(lists.flat())].sort();
  return (
    <NoAccessContext.Provider value={scope}>
      {lists.length > 0 && (
        <div className="note note--warn" role="alert" data-no-access-banner="">
          <Icon name="info" size={14} />
          <span>{noAccessBanner(tables, app?.no_access, app?.auth)}</span>
          <button type="button" className="btn" onClick={() => { setSeen({}); setRound((n) => n + 1); }}>Check again</button>
        </div>
      )}
      <Fragment key={round}>{children}</Fragment>
    </NoAccessContext.Provider>
  );
}

const RETRY_HOLD_MS = 800;
const RETRY_TOAST_MS = 9000;

export function toastFailure(toast, err, again, text = err?.message || '') {
  toast(text, toneOf(err), again && retryable(err) ? { actions: [{ label: RETRY_LABEL, run: again }], ms: RETRY_TOAST_MS } : {});
}
const RetryContext = createContext(null);
export const RetryProvider = RetryContext.Provider;
export const useRetry = () => useContext(RetryContext);

export function RetryButton({ onRetry, label = RETRY_LABEL }) {
  const [trying, setTrying] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  if (!onRetry) return null;
  const again = () => {
    setTrying(true);
    Promise.resolve().then(onRetry).catch(() => {}).finally(() => setTimeout(() => { if (live.current) setTrying(false); }, RETRY_HOLD_MS));
  };
  return (
    <button type="button" className="lnk retry" data-retry="" disabled={trying} onClick={again}>
      <Icon name="undo" size={13} />{trying ? RETRYING_LABEL : label}
    </button>
  );
}

function CopySend({ text }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(COPIED_SEND_TEXT);
    } catch {
      toast(`Select and copy this: ${text}`, 'info', { ms: 12000 });
    }
  };
  return <button type="button" className="lnk retry" data-copy-send="" onClick={copy}>{COPY_SEND_LABEL}</button>;
}

export function PlainNote({ text, as: Tag = 'p', icon = null, prefix = '', onRetry = null, children, ...rest }) {
  const tables = noAccessOf(text);
  const scoped = useNoAccess(tables);
  if (tables && scoped) return <NoAccessLine tables={tables} as={Tag} icon={icon} rest={rest} />;
  const { plain, details } = splitTechnical(`${prefix}${text ?? ''}`);
  if (!plain && !details.length) return null;
  const row = (onRetry || details.length > 0) && (
    <span className="retry-row" data-choices="">
      <RetryButton onRetry={onRetry} />
      {details.length > 0 && <CopySend text={sendText(plain, details)} />}
    </span>
  );
  const described = Boolean(rest.id);
  return (
    <>
      {plain && <Tag {...rest}>{icon}{plain}{children}{!described && row}</Tag>}
      {plain && described && row}
      <TechnicalDetails items={details} />
    </>
  );
}

export function Failure({ failure, className, as: Tag = 'p', onRetry = null, children }) {
  const tables = failure?.text ? noAccessOf(failure.text) : null;
  const scoped = useNoAccess(tables);
  if (!failure?.text) return null;
  if (tables && scoped) return <NoAccessLine tables={tables} as={Tag} icon={null} rest={{ className, role: 'status' }} />;
  const calm = !!failure.calm;
  const { plain, details } = splitTechnical(failure.text);
  const shown = Children.map(children, (child) => (child === failure.text ? plain : child));
  const again = calm ? null : onRetry;
  return (
    <>
      <Tag className={calm ? 'note note--flat' : className} role={calm ? 'status' : 'alert'} data-calm={calm ? '' : undefined}>{shown}
        {(again || (!calm && details.length > 0)) && (
          <span className="retry-row" data-choices="">
            <RetryButton onRetry={again} />
            {!calm && details.length > 0 && <CopySend text={sendText(plain, details)} />}
          </span>
        )}
      </Tag>
      <TechnicalDetails items={details} />
    </>
  );
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

const FOLLOW_SLACK_PX = 40;
const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);

export function useFollowBottom(ref, content, pin) {
  const follow = useRef(true);
  const seen = useRef(0);
  const pinned = useRef(pin);
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let top = el.scrollTop;
    const gap = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const onScroll = () => {
      if (gap() <= 1 || (el.scrollTop > top && gap() <= FOLLOW_SLACK_PX)) { follow.current = true; setUnread(false); }
      else if (el.scrollTop < top) follow.current = false;
      top = el.scrollTop;
    };
    const leave = () => { if (el.scrollHeight > el.clientHeight) follow.current = false; };
    const onWheel = (e) => { if (e.deltaY < 0) leave(); };
    const onKey = (e) => { if (UP_KEYS.has(e.key)) leave(); };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
    };
  }, [ref]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (pinned.current !== pin) { pinned.current = pin; follow.current = true; }
    if (follow.current) { el.scrollTop = el.scrollHeight; setUnread(false); }
    else if (el.scrollHeight > seen.current) setUnread(true);
    seen.current = el.scrollHeight;
  }, [ref, content, pin]);
  const jump = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    follow.current = true;
    el.scrollTop = el.scrollHeight;
    setUnread(false);
  }, [ref]);
  return { unread, jump };
}

export function NewMessages({ follow }) {
  if (!follow.unread) return null;
  return <button type="button" className="new-msgs" onClick={follow.jump}><Icon name="down" size={13} />New messages</button>;
}

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
