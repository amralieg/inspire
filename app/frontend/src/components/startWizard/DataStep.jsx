// REQ-577, REQ-578: the Data step of the Start New Discovery wizard. Both paths show the production catalog advice.
// Discover path: find or choose cards. Find renders the Find suitable data step (lane B); choose renders the catalog and table picker
// that the shell's LaunchPage draws into `slot`. Match path: the picker only.
import { DATA_CHOOSE, DATA_FIND, DATA_TEXT, PATH_DISCOVER, PRODUCTION_CATALOG_ADVICE } from '../../lib/startWizard';
import DevWarnings, { scopePicks } from './DevWarnings';
import FindDataStep from './FindDataStep';

const CHOICE_HINT = {
  [DATA_FIND]: 'Inspire reads your catalogs and groups the right tables into runs for you.',
  [DATA_CHOOSE]: 'Pick the catalogs, schemas or tables yourself.',
};

export default function DataStep({ draft, setDraft, settings, apiFetch, onReady, registerStart, launchParams, onEditStep, setSlot }) {
  const discover = draft.path === PATH_DISCOVER;
  const choice = discover ? draft.dataChoice || DATA_FIND : DATA_CHOOSE;
  return (
    <section data-wiz-step="data" className="space-y-4">
      <h3 className="text-base font-bold text-text-primary">Which data should Inspire use?</h3>
      <p data-production-advice="" className="text-sm text-text-secondary">{PRODUCTION_CATALOG_ADVICE}</p>
      {discover && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[DATA_FIND, DATA_CHOOSE].map((id) => {
            const on = choice === id;
            return (
              <button key={id} type="button" data-wiz-data-choice={id} aria-pressed={on} onClick={() => setDraft({ dataChoice: id })}
                className={`rounded-lg border p-4 text-start transition-smooth glow-focus ${on ? 'border-db-red/40 bg-db-red-50' : 'border-border bg-surface hover:border-border-strong'}`}>
                <span className="block text-sm font-semibold text-text-primary">{DATA_TEXT[id]}</span>
                <span className="mt-1 block text-xs text-text-secondary">{CHOICE_HINT[id]}</span>
              </button>
            );
          })}
        </div>
      )}
      {choice === DATA_FIND
        ? <FindDataStep draft={draft} setDraft={setDraft} settings={settings} apiFetch={apiFetch} onReady={onReady}
          registerStart={registerStart} launchParams={launchParams} onEditStep={onEditStep} />
        : (
          <>
            <DevWarnings picks={scopePicks(launchParams?.()['01_uc_metadata'])} />
            <div ref={setSlot} data-wiz-picker="" />
          </>
        )}
    </section>
  );
}
