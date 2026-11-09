import { ExternalLink, Loader2 } from 'lucide-react';

const CHOICE_BUTTON = 'inline-flex h-8 items-center justify-center gap-1.5 px-3 rounded-lg whitespace-nowrap text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';

export default function ChoiceList({ heading = null, choices, mark = 'data-choice', tone = 'text-error-fg', disabled = false, title = '', busy = '', onPick }) {
  if (!choices?.length) return null;
  return (
    <div aria-label={heading || undefined} className="space-y-1.5">
      {heading && <p className={`font-semibold ${tone}`}>{heading}</p>}
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {choices.map((choice) => (
          <li key={choice.id} {...{ [mark]: choice.id }} className="rounded-lg border border-border bg-bg-subtle px-2.5 py-2 space-y-1">
            {choice.url ? (
              <a className={CHOICE_BUTTON} href={choice.url} target="_blank" rel="noreferrer">{choice.label} <ExternalLink size={12} /></a>
            ) : (
              <button type="button" disabled={disabled} title={title || undefined} onClick={() => onPick(choice)} className={CHOICE_BUTTON}>
                {busy === choice.id ? <Loader2 size={12} className="animate-spin" /> : null} {choice.label}
              </button>
            )}
            {choice.detail && <p className="text-text-secondary">{choice.detail}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
