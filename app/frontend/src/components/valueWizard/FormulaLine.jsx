import { formulaOf } from '../../lib/valueFormula.js';
import FormulaDiagram from './FormulaDiagram.jsx';
import { moneyText, partOf } from '../../lib/valueWizard.js';

// REQ-475/476: how the amount is made, as one line from the driver's own inputs. After "=" the server's amount; an error or no answer yet shows "Not set", never an old amount.
export default function FormulaLine({ driver, answers, yearly, status }) {
  const part = partOf(yearly, driver.id);
  const { text, longer } = formulaOf(driver, answers.drivers[driver.id]?.inputs, part, answers.currency || yearly?.currency);
  if (!text) return null;
  const amount = status === 'error' || !part ? 'Not set' : moneyText(yearly?.total?.unit, part.amount);
  const currency = answers.currency || yearly?.currency;
  return (
    <div className="min-w-0 space-y-1.5">
      {amount !== 'Not set' && <FormulaDiagram driver={driver} inputs={answers.drivers[driver.id]?.inputs} part={part} currency={currency} amount={amount} />}
    <p data-formula-line="" className="rounded-md border border-border bg-bg-subtle px-3 py-1.5 text-[13px] tabular-nums text-text-primary">
      {longer ? <span className="text-warning-fg">{text}</span> : `${text} = ${amount}${amount === 'Not set' ? '' : ' a year'}`}
    </p>
    </div>
  );
}
