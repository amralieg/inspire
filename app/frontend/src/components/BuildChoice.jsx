import Recommended from './Recommended';
import { BUILD_ADVANCED, BUILD_QUESTION, BUILD_STANDARD } from '../lib/implementWizard';

// REQ-457 REQ-457a: the first step of the Build wizard. Standard is pre-selected and recommended.
export const BUILD_CHOICES = [
  { id: BUILD_STANDARD, label: 'Standard MVP build settings',
    blurb: 'Answer 3 short steps, What, Look and Build. Inspire uses the recommended settings for the rest, and you can change any of them before you build.' },
  { id: BUILD_ADVANCED, label: 'Advanced MVP build settings',
    blurb: 'Choose every setting yourself: data and results, data groups, first run and where the App lives.' },
];

export default function BuildChoice({ build, onChange, best = null }) {
  return (
    <section className="space-y-3" aria-label={BUILD_QUESTION}>
      <h3 className="text-sm font-semibold text-text-primary">{BUILD_QUESTION}</h3>
      <div role="radiogroup" aria-label={BUILD_QUESTION} data-choice="build" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {BUILD_CHOICES.map((choice) => {
          const checked = build === choice.id;
          return (
            <label key={choice.id} data-build-choice={choice.id}
              className={`flex items-start gap-3 border rounded-lg p-4 glow-focus cursor-pointer ${checked ? 'border-db-red bg-db-red-50' : 'border-border hover:border-border-strong'}`}>
              <input type="radio" name="build-choice" value={choice.id} checked={checked} onChange={() => onChange(choice.id)} className="mt-1" />
              <span className="space-y-1.5">
                <span className="block text-sm font-semibold text-text-primary">{choice.label}</span>
                <span className="block text-[12px] text-text-secondary">{choice.blurb}</span>
                <Recommended best={best} id={choice.id} />
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
