/**
 * The header every page mounts: the page's one h1, an optional icon tile, a subtitle and an actions slot.
 * The page width belongs to the page container, not to this header.
 */
export default function PageHeader({ title, icon: Icon, subtitle, actions, className = '', ...rest }) {
  return (
    <header data-page-header="" {...rest} className={`flex flex-wrap items-center gap-3 ${className}`.trim()}>
      {Icon && (
        <span data-page-icon="" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <Icon size={20} aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-h1 font-semibold text-text-primary">{title}</h1>
        {subtitle && <p className="text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
