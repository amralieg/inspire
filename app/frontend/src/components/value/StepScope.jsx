// REQ-507 L4: the Data step. Page scope:facts shows the records found and the date column; scope:choice offers All data, Last 12 months or
// My own filter. No money here.
import { PlainMessage } from '../TechnicalDetails';
import { useState } from 'react';
import { SCOPE_ROUTE, choiceDates, factsLine, scopeChoices, scopeOfChoice } from '../../lib/valueScope.js';

const card = 'rounded-lg border px-3 py-2 text-start text-sm';

export default function StepScope({ page, facts, scope, onScope, onFacts, post, useCase }) {
  const [error, setError] = useState('');
  if (!facts) return null;
  if (page === 'scope:facts') {
    const pick = async (date_column) => {
      setError('');
      try {
        const reply = await post(SCOPE_ROUTE, { date_column });
        if (reply?.facts) onFacts(reply.facts);
      } catch (e) { setError(e?.message || 'Could not read that date column.'); }
    };
    return (
      <div data-wizard-page="scope:facts" className="space-y-3">
        <p data-scope-facts="" dir="auto" className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm">{factsLine(facts, useCase?.noun || 'record')}</p>
        {facts.date_candidates?.length > 0 && (
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">Date column
            <select value={facts.date_column || ''} onChange={(e) => pick(e.target.value)} className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-text-primary">
              {facts.date_candidates.map((c) => <option key={c.column} value={c.column}>{c.column}</option>)}
            </select>
          </label>
        )}
        {error && <PlainMessage text={error} role="alert" className="text-[12px] text-error-fg" />}
      </div>
    );
  }
  const choices = scopeChoices(facts);
  const chosen = scope?.choice || null;
  return (
    <div data-wizard-page="scope:choice" className="space-y-2">
      <p className="text-sm text-text-secondary">Which rows should the value be worked out from?</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {choices.map((c) => (
          <button key={c.id} type="button" data-scope-choice={c.id} data-recommended={c.recommended ? 'true' : undefined} aria-pressed={chosen === c.id}
            onClick={() => onScope({ ...(scopeOfChoice(c.id, facts) || { phrase: c.label, filters: [], window: null }), choice: c.id })}
            className={`${card} ${chosen === c.id ? 'border-primary-solid bg-bg-subtle' : 'border-border bg-surface'}`}>
            <span className="block font-semibold">{c.label}{c.recommended ? ' (recommended)' : ''}</span>
            <span className="block text-[12px] text-text-secondary">
              {c.id === 'all' && factsLine(facts, useCase?.noun || 'record')}
              {c.id === 'last_12' && choiceDates(c)}
              {c.id === 'filter' && 'Describe the rows to keep in plain English.'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
