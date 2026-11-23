import { GenieMark, Icon } from './icons.jsx';

const STEPS = ['See what needs a decision', 'Decide each one in a click', 'Watch your value grow at the top'];

// REQ-506: the mission on first open, as a card on the list (not a modal). Remembered per person in prefs.
export default function Welcome({ page, onChoose }) {
  return (
    <section className="welcome" data-welcome="" aria-label="Your mission">
      <p className="welcome-k">Your mission</p>
      <h2 className="welcome-q">{page.question || page.title}</h2>
      <ol className="welcome-steps">
        {STEPS.map((text, i) => <li key={text} data-welcome-step=""><b>{i + 1}</b><span>{text}</span></li>)}
      </ol>
      <div className="welcome-go">
        <button type="button" className="btn btn--primary" data-welcome-choice="screen" onClick={() => onChoose('screen')}><Icon name="check" size={15} />Work the list</button>
        <button type="button" className="btn" data-welcome-choice="genie" onClick={() => onChoose('genie')}><GenieMark size={15} />Talk to Genie</button>
      </div>
    </section>
  );
}
