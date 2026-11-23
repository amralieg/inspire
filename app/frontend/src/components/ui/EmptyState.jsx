/** What a list or page shows when there is nothing in it: an optional icon, a title, one line of help, and an optional action. */
export default function EmptyState({ icon: Icon, title, children, action, className = '', ...rest }) {
  return (
    <div {...rest} className={`flex flex-col items-center gap-2 px-4 py-8 text-center ${className}`.trim()}>
      {Icon && <Icon size={24} aria-hidden="true" className="text-text-tertiary" />}
      {title && <p className="text-sm font-semibold text-text-primary">{title}</p>}
      {children && <div className="text-xs text-text-secondary">{children}</div>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
