import { useCallback, useEffect, useMemo, useState } from 'react';
import { PlainMessage } from './TechnicalDetails';
import ModalDialog from './ModalDialog';
import { StakeQuestions } from '../pages/ImplementWizard';
import { useGroupingProfile } from '../lib/groupingProfile';
import { defaultSpecFromUseCase, withMoneyRule } from '../lib/implementWizard';
import { defaultMoneyRule, DEFAULT_CURRENCY } from '../lib/moneyDefaults.js';
import { moneyPartsOf } from '../lib/moneyParts.js';
import { kpiTargetOptions, withKpiTarget } from '../lib/targetKpi';
import { answersOf } from '../lib/calculatedValue';
import { ATTRIBUTION, DATA_TAG, attributionOf, driverAnswersOf, valuesOfAnswers } from '../lib/valueDrivers';
import { VALUE_LABELS } from '../lib/valueLabels';
import ValueDisclaimer from './ValueDisclaimer';
import ValueDrivers from './ValueDrivers';
import ValueHistory from './ValueHistory';
import ValueSplit from './ValueSplit';

const specOf = (uc, saved, ctx) => {
  const base = defaultSpecFromUseCase(uc, ctx);
  const withMoney = saved?.money ? withMoneyRule(base, saved.money) : base;
  return saved?.kpi?.name ? withKpiTarget(withMoney, saved.kpi.name) : withMoney;
};
const messageOf = (err) => String(err?.message || err || 'The value could not be saved.');

// REQ-432: Calculate asks the same Value at stake questions as the build wizard (the shared StakeQuestions).
// REQ-435: and the five parts that are not in the data plus the share the use case earns. The box stays open after Calculate to show
// the split, lists the saved versions with Undo, and opens again with the saved answers. `values` saves, reads history and undoes on the server.
export default function CalculateValueDialog({ uc, table, apiPostJson, inspireDatabase, warehouseId, sessionId, saved = null, version = null, values, onClose }) {
  const [spec, setSpec] = useState(() => specOf(uc, saved, { warehouseId, inspireDatabase, sessionId }));
  const [dataOn, setDataOn] = useState(() => (saved ? Boolean(saved.money) : Boolean(table)));
  const [typed, setTyped] = useState(() => valuesOfAnswers(saved?.drivers));
  const [attribution, setAttribution] = useState(() => String(saved?.attribution_pct ?? ATTRIBUTION.default));
  const [pickedCurrency, setCurrency] = useState(() => saved?.currency || DEFAULT_CURRENCY);
  const [moneyPart, setMoneyPart] = useState(0);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const profile = useGroupingProfile({ apiPostJson, inspireDatabase, sessionId, useCaseId: spec.use_case_id, warehouseId, table });
  useEffect(() => {
    if (!dataOn || spec.money || profile.state === 'loading') return;
    setSpec((prev) => (prev.money ? prev : withMoneyRule(prev, defaultMoneyRule(profile.profile))));
  }, [dataOn, spec.money, profile.state, profile.profile]);
  const useCaseId = spec.use_case_id;
  const loadHistory = useCallback(() => values.history(useCaseId).then(setHistory, () => setHistory([])), [values, useCaseId]);
  useEffect(() => {
    if (version) loadHistory();
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const moneyApi = useMemo(() => {
    const withSession = (body) => ({ ...body, inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId), use_case_id: useCaseId });
    return {
      currencies: (body) => apiPostJson('/api/money/currency-rates', withSession(body)),
      preview: (body) => apiPostJson('/api/money/value-preview', withSession(body)),
      describe: (body) => apiPostJson('/api/money/describe-value', body),
    };
  }, [apiPostJson, inspireDatabase, warehouseId, sessionId, useCaseId]);
  const kpiOptions = useMemo(() => kpiTargetOptions(uc, []), [uc]);
  const moneyParts = spec.money?.off ? ['off'] : moneyPartsOf(spec.money?.rule);
  const moneyActive = Math.min(moneyPart, moneyParts.length - 1);

  const lockedCurrency = dataOn && spec.money?.value?.currency ? spec.money.value.currency : '';
  const currency = lockedCurrency || pickedCurrency;
  const built = driverAnswersOf(typed);
  const share = attributionOf(attribution);
  const hasDrivers = Object.keys(built.drivers).length > 0;
  const dataReady = dataOn && Boolean(spec.money?.value);
  const problem = built.incomplete || (share === null ? `${ATTRIBUTION.label}: use a number from ${ATTRIBUTION.min} to ${ATTRIBUTION.max}.` : '');
  const ready = !busy && !problem && (dataReady || hasDrivers);
  const answers = () => ({
    ...(dataOn ? Object.fromEntries(Object.entries(answersOf(spec, kpiOptions)).filter(([, v]) => v)) : {}),
    ...(hasDrivers ? { currency, drivers: built.drivers } : {}),
    attribution_pct: share,
  });

  const restore = (a) => {
    setSpec(specOf(uc, a, { warehouseId, inspireDatabase, sessionId }));
    setDataOn(Boolean(a?.money));
    setTyped(valuesOfAnswers(a?.drivers));
    setAttribution(String(a?.attribution_pct ?? ATTRIBUTION.default));
    if (a?.currency) setCurrency(a.currency);
  };
  const calculate = async () => {
    setBusy(true); setError('');
    try {
      const got = await values.run(useCaseId, dataOn ? table : '', answers());
      setResult(got.yearly);
      loadHistory();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    setBusy(true); setError('');
    try {
      const got = await values.undo(useCaseId);
      restore(got.answers);
      setResult(got.yearly);
      loadHistory();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog titleId="calculate-value-title" title={VALUE_LABELS.dialogTitle} onClose={onClose} widthClass="max-w-2xl"
      footer={(
        <>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle">{result ? 'Close' : 'Cancel'}</button>
          <button type="button" disabled={!ready} onClick={calculate}
            className="rounded-md bg-db-red-solid hover:bg-db-red-solid-hover px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{VALUE_LABELS.calculate}</button>
        </>
      )}>
      <p className="text-[12px] text-text-secondary">Value at stake: Inspire estimates the value on a sample of the main table and scales it to every record and to a year. Add your own numbers for value that is not in the data. No build runs.</p>
      {result ? <ValueSplit yearly={result} /> : <ValueDisclaimer />}
      {error && <PlainMessage text={error} role="alert" dir="auto" className="rounded-md border border-error/30 bg-error-bg px-3 py-2 text-[12px] text-error-fg" />}
      {problem && !error && <p role="status" className="text-[12px] text-text-secondary">{problem}</p>}
      <section aria-label="From your data" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-text-primary">From your data</h3>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-secondary">{DATA_TAG}</span>
          <span className="flex-1" />
          <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
            <input type="checkbox" checked={dataOn} disabled={!table} onChange={(e) => setDataOn(e.target.checked)} />
            Use the value from your data
          </label>
        </div>
        {dataOn && (
          <StakeQuestions spec={spec} setSpec={setSpec} moneyParts={moneyParts} moneyActive={moneyActive} setMoneyPart={setMoneyPart}
            profile={profile.profile} moneyApi={moneyApi} kpiOptions={kpiOptions} />
        )}
      </section>
      <ValueDrivers typed={typed} setTyped={setTyped} currency={currency} setCurrency={setCurrency} currencyLocked={Boolean(lockedCurrency)}
        attribution={attribution} setAttribution={setAttribution} />
      <ValueHistory history={history} busy={busy} onUndo={undo} />
    </ModalDialog>
  );
}
