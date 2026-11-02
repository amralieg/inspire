import { AlertTriangle } from 'lucide-react';
import {
  NOT_RELIABLE, NOTHING_TO_ACT, amountText, assumptionLabel, capacityText, columnWords, historyLines, lastRunText, notReliableReason, nothingToActText,
  previewSampleText, tiersText,
} from '../lib/moneyReview';
import { liveImpact, stakeCurrency, stakeLabel, stakeWords } from '../lib/targetKpi';
import { RunScopeLine } from './RunScope';

export function NothingToActCard({ run }) {
  const text = nothingToActText(run);
  if (!text) return null;
  return (
    <section aria-label={notReliableReason(run) ? NOT_RELIABLE : NOTHING_TO_ACT} role="status"
      className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning-bg px-3.5 py-3 text-[13px] text-warning-fg">
      <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden />
      <p>{text}</p>
    </section>
  );
}

export default function MoneyReview({ money, error = '', impact = null, scope = null }) {
  const stake = liveImpact(money?.run, impact);
  const words = stakeWords(stake);
  if (error) return <p role="alert" className="text-[12px] text-error-fg">Inspire could not read the {words} of the last run: {error}</p>;
  if (!money) return <p className="text-[12px] text-text-secondary">Reading how the last run counted the {words}</p>;
  const { model, run } = money;
  const sample = previewSampleText(run);
  const capacity = capacityText(run);
  if (!model) {
    return (
      <>
        <p data-money-pending="" className="text-[12px] text-text-secondary">
          Genie proposes how the {words} on each row is counted, and its assumptions, when the notebook first runs. Say below how it should be counted, and Inspire checks it after the build.
        </p>
        {sample && <p data-preview-sample="" className="text-[12px] text-text-secondary">{sample}</p>}
        {capacity && <p data-capacity="" className="text-[12px] text-text-secondary">{capacity}</p>}
      </>
    );
  }
  const currency = stakeCurrency(stake);
  const values = Object.fromEntries(model.assumptions.map((a) => [a.name, a.value]));
  const tiers = tiersText(run, stake);
  const lines = historyLines(money.history, currency);
  const outcome = lastRunText(run, stake);
  return (
    <section aria-label={`${stakeLabel(stake)} review`} className="space-y-2.5 rounded-lg border border-border bg-bg-subtle/50 p-3 text-[12px]">
      <h5 className="text-[13px] font-semibold text-text-primary">How Genie counts the {words}</h5>
      <RunScopeLine facts={scope} />
      {model.parts.length > 0 && (
        <p data-formula="" className="text-[13px] text-text-primary">
          Each row: {model.parts.map((p, i) => (p.text != null ? <span key={i}>{p.text}</span>
            : p.column ? <i key={i}>{columnWords(p.column)}</i> : <b key={i}>{amountText(values[p.assumption], p.kind, currency)}</b>))} = its {words}.
        </p>
      )}
      {model.assumptions.length > 0 && (
        <table aria-label="Assumptions" className="w-full text-left">
          <thead><tr className="text-text-secondary"><th className="py-1 pr-3 font-semibold">Assumption</th><th className="py-1 pr-3 font-semibold">Value</th><th className="py-1 font-semibold">Set by</th></tr></thead>
          <tbody>
            {model.assumptions.map((a) => (
              <tr key={a.name} data-assumption={a.name} className="border-t border-border">
                <td className="py-1 pr-3 text-text-primary">{assumptionLabel(a.name)}</td>
                <td className="py-1 pr-3 font-mono text-text-primary">{amountText(a.value, a.kind, currency)}</td>
                <td className="py-1 text-text-secondary">{a.changed_by ? `${a.changed_by} in the App` : 'Genie, in the notebook'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {model.changed && <p className="text-text-primary">Owners changed an assumption in the App after the last run, so the next run uses the values above.</p>}
      {tiers && <p data-tiers="" className="text-text-secondary">{tiers}</p>}
      {sample && <p data-preview-sample="" className="text-text-secondary">{sample}</p>}
      {outcome && <p data-last-run="" className="text-text-secondary">{outcome}</p>}
      {capacity && <p data-capacity="" className="text-text-secondary">{capacity}</p>}
      {lines.length > 0 && <ul aria-label="Assumption changes" className="list-disc pl-5 text-text-secondary">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      <p data-change-how="" className="text-text-secondary">
        {model.assumptions.length > 0
          ? 'To change how it is counted, add a vibe in the box above the tabs and Edit MVP builds it. Owners of the App can change the assumption values there.'
          : 'This formula uses only each row\u2019s own numbers, so the App has no assumption to change. To change how it is counted, add a vibe in the box above the tabs and Edit MVP builds it.'}
      </p>
    </section>
  );
}
