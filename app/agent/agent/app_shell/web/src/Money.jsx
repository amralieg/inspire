import { useEffect, useRef, useState } from 'react';
import { changeAssumption, failureOf, getMoney } from './api.js';
import { dayLabel, kindOf, stakeWords, unitOf, wholeMoney } from './format.js';
import { Icon } from './icons.jsx';
import { Failure, useToast } from './ui.jsx';
import { amountText, assumptionLabel, columnWords } from './money.js';
import { settingProblem } from './settings.js';
import { FoldButton, useFold } from './MyView.jsx';

const NOTE_CHARS = 300;

function Rule({ model }) {
  const values = Object.fromEntries(model.assumptions.map((a) => [a.name, a.value]));
  return (
    <p className="rule">
      Each record: {model.parts.map((p, i) => (p.text != null ? <span key={i}>{p.text}</span>
        : p.column ? <i key={i}>{columnWords(p.column)}</i> : <b key={i}>{amountText(values[p.assumption], p.kind, model.currency)}</b>))}
      {' '}= its {stakeWords(unitOf(model), kindOf(model))}.
    </p>
  );
}

function tiersText(model, held) {
  let text = '';
  if (model.basis === 'measured' && model.act_now_amount != null && model.review_amount != null) {
    text = `Act now from ${wholeMoney(model.act_now_amount, unitOf(model), kindOf(model))} at stake, Review from ${wholeMoney(model.review_amount, unitOf(model), kindOf(model))}, `
      + `every other record Monitor.${model.assumptions?.length ? ' A changed assumption moves records between these tiers on the next update.' : ''}`;
  } else if (model.basis === 'predicted') {
    text = 'A record is called actionable only after a model passes this use case\u2019s acceptance check.';
  }
  return text && held ? `${text} ${held}` : text;
}

function parsed(text, kind) {
  const n = Number(String(text).trim());
  if (String(text).trim() === '' || !Number.isFinite(n)) return { problem: 'Enter a number' };
  if (kind === 'percent' && (n < 0 || n > 100)) return { problem: 'Enter a share from 0 to 100%' };
  return { value: kind === 'percent' ? Number((n / 100).toPrecision(12)) : n };
}

function shownInput(value, kind) {
  return value == null ? '' : String(kind === 'percent' ? Number((value * 100).toPrecision(12)) : value);
}

function Editor({ pageId, a, onSaved, onCancel }) {
  const [text, setText] = useState(shownInput(a.value, a.kind));
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  const read = parsed(text, a.kind);
  const value = read.value;
  const problem = read.problem || (a.setting && value != null ? settingProblem(a.setting, String(value)) : '');
  const save = async (e) => {
    e.preventDefault();
    if (problem) return;
    setSaving(true);
    setFailure(null);
    try {
      onSaved(await changeAssumption({ page: pageId, name: a.name, value, was: a.value, note: note.trim() }), value);
    } catch (err) {
      setFailure(failureOf(err));
    } finally {
      setSaving(false);
    }
  };
  const label = assumptionLabel(a.name);
  return (
    <form className="edit" onSubmit={save} noValidate>
      <label className="in"><span>{label}{a.kind === 'percent' ? ' (%)' : a.kind === 'money' ? ' (money)' : ''}</span>
        <input ref={input} name={`assumption_${a.name}`} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={problem ? true : undefined} />
      </label>
      <label className="in"><span>Why it changed</span>
        <input className="note" name="assumption_note" maxLength={NOTE_CHARS} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit" className="btn btn--pri" disabled={saving || !!problem}><Icon name="check" size={14} />{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
      {problem && text.trim() !== '' && <p className="err" role="alert">{problem}</p>}
      <Failure failure={failure} className="err">{failure?.text}</Failure>
    </form>
  );
}

function historyLines(history, currency) {
  return history.map((h, i) => {
    const older = history.slice(i + 1).find((x) => x.name === h.name);
    const from = older ? ` from ${amountText(older.value, h.kind, currency)}` : '';
    const when = h.changed_at ? dayLabel(String(h.changed_at).slice(0, 10)) : '';
    return `${when ? `${when}, ` : ''}${h.changed_by || 'someone'} set ${assumptionLabel(h.name)}${from} to ${amountText(h.value, h.kind, currency)}`
      + `${h.note ? `: ${h.note}` : ''}`;
  });
}

export default function MoneyCard({ pageId, nonce = 0, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState('');
  const toast = useToast();
  const fold = useFold('money');
  useEffect(() => {
    let live = true;
    getMoney(pageId).then((d) => { if (live) { setData(d); setError(''); } }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [pageId, nonce]);
  if (error) return <p className="tile-err" role="alert"><Icon name="info" size={14} />How the amount at stake is worked out could not load: {error}</p>;
  const model = data?.model;
  if (!model || (!model.parts.length && !model.assumptions.length)) return null;
  const saved = (next, value) => {
    const a = model.assumptions.find((x) => x.name === editing);
    setData(next);
    setEditing('');
    toast(`${assumptionLabel(a.name)} is ${amountText(value, a.kind, model.currency)} now. The ${stakeWords(unitOf(model), kindOf(model))} shown follows it.`);
    onChanged?.();
  };
  const tiers = tiersText(model, data.held);
  const lines = historyLines(data.history || [], model.currency);
  const title = `How the ${stakeWords(unitOf(model), kindOf(model))} is worked out`;
  if (fold.folded) {
    return (
      <section className="money money--folded" aria-label={title}>
        <div className="money-h"><h2>{title}</h2><FoldButton fold={fold} title={title} /></div>
      </section>
    );
  }
  return (
    <section className="money" aria-label={title}>
      <div className="money-h"><h2>{title}</h2><FoldButton fold={fold} title={title} /></div>
      {model.parts.length > 0 && <Rule model={model} />}
      {model.assumptions.length > 0 && (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Assumption</th><th>Value</th><th>Last change</th>{data.editable && <th><span className="sr">Change</span></th>}</tr></thead>
            <tbody>
              {model.assumptions.map((a) => (
                <tr key={a.name} data-assumption={a.name}>
                  <td>{assumptionLabel(a.name)}</td>
                  <td className="num">{editing === a.name
                    ? <Editor pageId={pageId} a={a} onSaved={saved} onCancel={() => setEditing('')} />
                    : amountText(a.value, a.kind, model.currency)}</td>
                  <td>{a.changed_by ? `${a.changed_by}${a.changed_at ? `, ${dayLabel(String(a.changed_at).slice(0, 10))}` : ''}` : 'As the notebook set it'}</td>
                  {data.editable && <td>{editing !== a.name && <button type="button" className="btn" onClick={() => setEditing(a.name)} aria-label={`Change ${assumptionLabel(a.name)}`}><Icon name="edit" size={14} />Change</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!data.editable && model.assumptions.length > 0 && data.why && <p className="why">You cannot change these assumptions here: {data.why.charAt(0).toLowerCase() + data.why.slice(1)}.</p>}
      {tiers && <p className="tiers">{tiers}</p>}
      {lines.length > 0 && (
        <div className="hist"><b>Changes</b><ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
      )}
    </section>
  );
}
