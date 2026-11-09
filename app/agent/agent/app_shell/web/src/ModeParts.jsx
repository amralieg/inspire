import { MODES } from './modes.js';
import { Icon } from './icons.jsx';

export function ModePending({ mode, onGo }) {
  const label = MODES[mode]?.work || 'Work';
  return (
    <section className="card mode-pending" data-mode-work={mode} data-mode-pending>
      <header className="card-h"><div><h2>{label}</h2><p>Everything this use case shows and decides is on its Dashboard for now.</p></div></header>
      <div className="mode-pending-b">
        <button type="button" className="btn btn--pri" onClick={() => onGo?.('dashboard')}><Icon name="grid" size={14} />Open the Dashboard</button>
      </div>
    </section>
  );
}

export function ModeEmpty({ icon = 'info', children }) {
  return <p className="mode-empty" role="status"><Icon name={icon} size={14} /><span>{children}</span></p>;
}
