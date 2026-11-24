const VARIANTS = {
  primary: 'bg-primary-solid hover:bg-primary-hover dark:hover:bg-primary-solid-hover text-primary-fg disabled:bg-neutral-bg disabled:text-neutral-fg',
  secondary: 'border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:bg-neutral-bg disabled:text-neutral-fg',
  ghost: 'bg-transparent text-text-secondary hover:bg-bg-subtle hover:text-text-primary disabled:text-neutral-fg',
  danger: 'border border-danger-fg bg-surface text-danger-fg hover:bg-danger-bg disabled:border-border disabled:bg-neutral-bg disabled:text-neutral-fg',
};
const SIZES = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-3.5 py-2 text-sm gap-2',
};

/** The one button. A disabled button turns neutral grey; it is never a faded colour. */
export default function Button({ variant = 'primary', size = 'md', type = 'button', className = '', children, ...rest }) {
  return (
    <button type={type} {...rest}
      className={`inline-flex items-center justify-center rounded-md font-semibold transition-colors disabled:cursor-not-allowed glow-focus ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${className}`.trim()}>
      {children}
    </button>
  );
}
