import { useEffect, useMemo, useState } from 'react';
import ModalDialog from './ModalDialog';
import { StakeQuestions } from '../pages/ImplementWizard';
import { useGroupingProfile } from '../lib/groupingProfile';
import { defaultSpecFromUseCase, withMoneyRule } from '../lib/implementWizard';
import { defaultMoneyRule } from '../lib/moneyDefaults.js';
import { moneyPartsOf } from '../lib/moneyParts.js';
import { kpiTargetOptions, withKpiTarget } from '../lib/targetKpi';
import { answersOf } from '../lib/calculatedValue';
import { VALUE_LABELS } from '../lib/valueLabels';
import ValueDisclaimer from './ValueDisclaimer';

// REQ-432: Calculate asks the same Value at stake questions as the build wizard (the shared StakeQuestions), then hands the answers back.
export default function CalculateValueDialog({ uc, table, apiPostJson, inspireDatabase, warehouseId, sessionId, saved = null, onCancel, onCalculate }) {
  const [spec, setSpec] = useState(() => {
    const base = defaultSpecFromUseCase(uc, { warehouseId, inspireDatabase, sessionId });
    const withMoney = saved?.money ? withMoneyRule(base, saved.money) : base;
    return saved?.kpi?.name ? withKpiTarget(withMoney, saved.kpi.name) : withMoney;
  });
  const [moneyPart, setMoneyPart] = useState(0);
  const profile = useGroupingProfile({ apiPostJson, inspireDatabase, sessionId, useCaseId: spec.use_case_id, warehouseId, table });
  useEffect(() => {
    if (spec.money || profile.state === 'loading') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the default money rule arrives with the profile, the same default the build wizard sets
    setSpec((prev) => (prev.money ? prev : withMoneyRule(prev, defaultMoneyRule(profile.profile))));
  }, [spec.money, profile.state, profile.profile]);
  const useCaseId = spec.use_case_id;
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
  const ready = Boolean(spec.money?.value);
  return (
    <ModalDialog titleId="calculate-value-title" title={VALUE_LABELS.dialogTitle} onClose={onCancel} widthClass="max-w-2xl"
      footer={(
        <>
          <button type="button" onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle">Cancel</button>
          <button type="button" disabled={!ready} onClick={() => onCalculate(table, answersOf(spec, kpiOptions))}
            className="rounded-md bg-db-red-solid hover:bg-db-red-solid-hover px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{VALUE_LABELS.calculate}</button>
        </>
      )}>
      <p className="text-[12px] text-text-secondary">Value at stake: Inspire estimates the value on a sample of the main table and scales it to every record and to a year. No build runs.</p>
      <ValueDisclaimer />
      <StakeQuestions spec={spec} setSpec={setSpec} moneyParts={moneyParts} moneyActive={moneyActive} setMoneyPart={setMoneyPart}
        profile={profile.profile} moneyApi={moneyApi} kpiOptions={kpiOptions} />
    </ModalDialog>
  );
}
