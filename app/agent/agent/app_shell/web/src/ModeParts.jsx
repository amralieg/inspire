import { Icon } from './icons.jsx';

export function ModeEmpty({ icon = 'info', children }) {
  return <p className="mode-empty" role="status"><Icon name={icon} size={14} /><span>{children}</span></p>;
}
