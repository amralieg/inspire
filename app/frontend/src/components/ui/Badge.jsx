const TONES = {
  neutral: 'bg-neutral-bg text-neutral-fg',
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
  info: 'bg-info-bg text-info-fg',
};

/** A small status label. The tone picks the background and text tokens. */
export default function Badge({ tone = 'neutral', className = '', children, ...rest }) {
  return (
    <span {...rest} className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium ${TONES[tone] || TONES.neutral} ${className}`.trim()}>
      {children}
    </span>
  );
}
