import { PlainMessage } from '../TechnicalDetails';
import { factorsOf, moneyText, partOf, totalText } from '../../lib/valueWizard.js';

// FX-97 (REQ-493, REQ-494): market and customer factors. Each factor changes the revenue part of the value only. Every amount comes from the
// server's preview; the bar of a card is drawn from the factor's own percent so it moves with the slider before the reply lands.
const partId = (f) => (f.id === 'economic_trend' ? f.id : `factor_${f.id}`);
const signed = (n) => `${n > 0 ? '+' : ''}${n}%`;

// A bar that grows to the right for an uplift and to the left for a downturn, scaled to the factor's widest bound.
function EffectBar({ pct, f, on }) {
  const widest = Math.max(Math.abs(Number(f.min_pct)), Math.abs(Number(f.max_pct)), 1);
  const width = Math.min(50, (Math.abs(pct) / widest) * 50);
  const tone = pct < 0 ? 'bg-error' : 'bg-ok';
  return (
    <div data-factor-bar="" role="img" aria-label={`Effect ${signed(pct)}`} className={`relative h-2.5 w-full rounded-full bg-bg-subtle ${on ? '' : 'grayscale'}`}>
      <span className="absolute inset-y-0 start-1/2 w-px bg-border" />
      <span className={`absolute inset-y-0 rounded-full ${tone}`} style={pct < 0 ? { right: '50%', width: `${width}%` } : { left: '50%', width: `${width}%` }} />
    </div>
  );
}

export default function StepFactors({ plan, answers, yearly, onFactor, status, error }) {
  const stale = status === 'error';
  const unit = yearly?.total?.unit;
  const factors = factorsOf(plan);
  const effects = factors.map((f) => (!stale && answers.economic_factors?.[f.id]?.on ? partOf(yearly, partId(f)) : null));
  const sum = effects.reduce((s, p) => s + (p ? p.amount : 0), 0);
  return (
    <div data-wizard-page="factors" className="space-y-2">
      <div>
        <h3 className="text-sm font-bold text-text-primary">Market and customer factors</h3>
        <p className="text-[12px] text-text-secondary">Outside signals can lift or lower the revenue this use case wins. Include the ones you believe in and move the slider to your own view. Costs and risks are not changed.</p>
      </div>
      {status === 'error' && <PlainMessage text={error} role="alert" dir="auto" className="rounded-md border border-error/30 bg-error-bg px-3 py-1.5 text-[12px] text-error-fg" />}
      <div className="grid grid-cols-2 gap-2">
        {factors.map((f, k) => {
          const mine = answers.economic_factors?.[f.id] || { on: false, pct: Number(f.likely_pct) };
          const pct = Number(mine.pct);
          return (
            <section key={f.id} data-factor={f.id} aria-label={f.label} className={`space-y-1.5 rounded-lg border px-3 py-2 ${mine.on ? 'border-primary-solid ring-1 ring-primary-solid' : 'border-border'}`}>
              <label className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                <input type="checkbox" aria-label={`Include ${f.label}`} checked={Boolean(mine.on)} onChange={() => onFactor(f.id, { on: !mine.on })} />
                <span className="min-w-0 flex-1">{f.label}</span>
                <span data-factor-pct="" className="tabular-nums">{signed(pct)}</span>
              </label>
              {f.why && <p className="text-[12px] text-text-secondary">{f.why}</p>}
              <input type="range" aria-label={`${f.label} slider`} min={Number(f.min_pct)} max={Number(f.max_pct)} step={1} value={pct}
                onChange={(e) => onFactor(f.id, { pct: Number(e.target.value) })} className="m-0 w-full accent-primary-solid" />
              <div className="flex justify-between text-caption text-text-secondary"><span>{signed(Number(f.min_pct))}</span><span>{signed(Number(f.max_pct))}</span></div>
              <EffectBar pct={pct} f={f} on={Boolean(mine.on)} />
              <p data-factor-amount="" className="text-[12px] tabular-nums text-text-secondary">
                {mine.on ? (effects[k] ? `${effects[k].amount >= 0 ? '+' : ''}${moneyText(unit, effects[k].amount)} per year` : stale ? 'Not set' : '...') : 'Not included'}
              </p>
            </section>
          );
        })}
      </div>
      <div data-factors-total="" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg-subtle px-3 py-2 text-[13px] text-text-primary">
        <span>Total effect of the factors: <b className="tabular-nums">{stale ? 'Not set' : `${sum >= 0 ? '+' : ''}${moneyText(unit, sum) || '...'}`} per year</b></span>
        <span>Running total: <b data-run-total="" className="tabular-nums">{stale ? 'Not set' : totalText(yearly) || '...'} per year</b></span>
      </div>
    </div>
  );
}
