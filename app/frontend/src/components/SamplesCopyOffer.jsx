import { SAMPLES_DESCRIPTIONS_SENTENCE } from '../lib/samplesCopy.js';
import { PlainMessage } from './TechnicalDetails';

export default function SamplesCopyOffer({ names, target, onTarget, canCopy, copying, choice, error, onCopy, onDescriptions }) {
  return (
    <section data-samples-offer="" aria-label="Samples tables" className="mb-4 rounded-xl border border-warning/30 bg-warning-bg p-4 text-xs text-warning-fg">
      <p className="text-sm font-semibold">Samples cannot measure value</p>
      <p className="mt-1 break-words">
        {names} is in samples, a catalog Databricks owns, so nobody can grant the App access to it. Value cannot be measured on samples:
        copy it (CREATE TABLE AS SELECT) into a schema you own, and this run measures value on your copy.
      </p>
      <label className="mt-3 flex flex-col gap-1 text-text-secondary">
        <span>Copy into</span>
        <input
          value={target}
          onChange={(e) => onTarget(e.target.value)}
          placeholder="catalog.schema you own"
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-text-primary"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" data-samples-copy="" disabled={!canCopy || copying} onClick={onCopy}
          className="rounded-lg bg-db-red-solid px-3 py-2 font-semibold text-white disabled:opacity-50">
          {copying ? 'Copying…' : `Copy into ${target || 'a schema you own'}`}
        </button>
        <button type="button" data-samples-descriptions="" disabled={copying} onClick={onDescriptions}
          className="rounded-lg border border-border px-3 py-2 font-medium text-text-primary disabled:opacity-50">
          Use descriptions only
        </button>
      </div>
      {choice === 'descriptions' && <p data-samples-sentence="" className="mt-3 text-text-primary">{SAMPLES_DESCRIPTIONS_SENTENCE}</p>}
      {error && <PlainMessage text={error} role="alert" data-samples-error="" className="mt-3 break-words text-error-fg" />}
    </section>
  );
}
