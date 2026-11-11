import { createContext, useContext } from 'react';
import './styles/help.css';
import { helpLine } from './help.js';

export const HelpContext = createContext(null);

export function SectionHelp({ title, steps }) {
  const start = useContext(HelpContext);
  if (!start || !steps?.length) return null;
  return (
    <button type="button" className="help-q" aria-label={`Help: what to do in ${title}`} title="What to do here" data-section-help
      onClick={(event) => {
        const button = event.currentTarget;
        const el = button.closest('.card, .fold-s, .set-group') || button;
        start({ title, steps: steps.map((s) => ({ ...s, el })) });
      }}>?</button>
  );
}
