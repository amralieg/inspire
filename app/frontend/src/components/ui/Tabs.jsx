export function tabPanel(idBase, id, current) {
  return { role: 'tabpanel', id: `${idBase}-panel-${id}`, 'aria-labelledby': `${idBase}-tab-${id}`, hidden: current !== id, className: 'tab-panel-enter' };
}

/**
 * The one tab style: a tablist with a 2px primary underline on the current tab, no fill, no box. Arrow keys, Home and End move
 * between tabs (flipped in right-to-left pages). Each tab is { id, label, icon, mark, count, ariaLabel }.
 * With `idBase`, tabs get ids and aria-controls that match `tabPanel(idBase, id, current)` on the panels.
 */
export default function Tabs({ label, idBase, tabs, current, onPick, tabAttrs, className = '', ...rest }) {
  const keys = (e) => {
    const i = tabs.findIndex((t) => t.id === current);
    const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    let next;
    if (dir) next = i + (rtl ? -dir : dir);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    const id = tabs[(next + tabs.length) % tabs.length].id;
    const list = e.currentTarget;
    onPick(id);
    requestAnimationFrame(() => list.querySelector(`[data-tab="${id}"]`)?.focus());
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={keys} {...rest} className={`flex flex-wrap gap-x-5 gap-y-1 border-b border-border ${className}`.trim()}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={idBase ? `${idBase}-tab-${t.id}` : undefined}
            data-tab={t.id}
            aria-selected={on}
            aria-controls={idBase ? `${idBase}-panel-${t.id}` : undefined}
            aria-label={t.ariaLabel}
            tabIndex={on ? 0 : -1}
            onClick={() => onPick(t.id)}
            {...(tabAttrs ? tabAttrs(t, on) : {})}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 bg-transparent px-0.5 pb-1.5 text-xs font-semibold transition-colors glow-focus ${on ? 'border-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
          >
            {Icon && <Icon size={14} aria-hidden="true" className="shrink-0" />}
            <span className="truncate">{t.label}</span>
            {t.count !== undefined && <span className="font-mono text-[10px] tabular-nums text-text-secondary">{t.count}</span>}
            {t.mark}
          </button>
        );
      })}
    </div>
  );
}
