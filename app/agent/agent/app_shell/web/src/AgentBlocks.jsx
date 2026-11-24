import { useState } from 'react';
import ChartCard from './ChartCard.jsx';
import Markdown from './Markdown.jsx';
import { Icon } from './icons.jsx';
import { ConfirmCard, Rate } from './AgentParts.jsx';
import { PlainNote } from './ui.jsx';
import { ACTION_FIELDS, askText, actionLabel, chartOf, columnHeads, copyText, kpiName, multiAsk, multiValid, stakeText, ticketKey, valuesFor } from './agentBlocks.js';

// Renders the typed blocks the server validated. ctx: { page, charts, ask(text), prepare(action, keys, values), confirm(c),
// cancel(c), undo(c), openRecord(key), rate(r), turnId }. Nothing here builds HTML from model text: every value is a React child.

function Money({ value, page }) {
  const text = stakeText(value, page);
  return text ? <b className="agp-stake">{text}</b> : null;
}

export function Ticket({ ticket, ctx, actions = [] }) {
  const key = ticketKey(ticket);
  return (
    <article className="agp-ticket" data-ticket={key} aria-label={ticket.label}>
      <header>
        <button type="button" className="agp-link" onClick={() => ctx.openRecord?.(key)}>{ticket.label}</button>
        <Money value={ticket.value_at_stake} page={ctx.page} />
      </header>
      {key && key !== ticket.label && <p className="agp-meta agp-key">{key}</p>}
      {(ticket.status || ticket.tier || ticket.due) && (
        <p className="agp-meta">{[ticket.status, ticket.tier, ticket.due && `due ${ticket.due}`].filter(Boolean).join(' · ')}</p>
      )}
      {ticket.why && <p className="agp-why">{ticket.why}</p>}
      {actions.length > 0 && <ActionRow keys={[key]} actions={actions} ctx={ctx} />}
    </article>
  );
}

// One write, through the confirm card. An action that needs a value opens a small form for it first; the server
// prepares the card, the person confirms, then the write goes to the route the card names (records/act, or an app route).
const FIELD_INPUT = {
  until: { label: 'Snooze until', type: 'date' }, owner: { label: 'Assign to', type: 'text' }, reason: { label: 'Reason', type: 'text' },
  note: { label: 'Note', type: 'text' }, value: { label: 'Target', type: 'number' },
  status: { label: 'Status', type: 'select' },
};
export function ActionRow({ keys, actions, ctx }) {
  const [open, setOpen] = useState('');
  const [input, setInput] = useState({});
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');
  const patchConfirm = (change) => setConfirm((prev) => ({ ...prev, ...change }));
  const start = async (action) => {
    setError('');
    const { values, error: missing } = valuesFor(action, input);
    if (missing) { setError(missing); setOpen(action); return; }
    try {
      const c = await ctx.prepare(action, keys, values);
      setConfirm({ ...c, state: 'ask' });
      setOpen('');
    } catch (e) {
      setError(e.message);
    }
  };
  const pick = (action) => {
    if (!(ACTION_FIELDS[action] || []).length) return start(action);
    return setOpen(open === action ? '' : action);
  };
  return (
    <div className="agp-actions" role="group" aria-label="Actions on these records">
      <div className="agp-buttons">
        {actions.map((a) => (
          <button key={a} type="button" className={`btn btn--sm${a === 'done' ? ' btn--pri' : ''}`} onClick={() => pick(a)} data-action={a}>
            {actionLabel(a)}
          </button>
        ))}
      </div>
      {open && (ACTION_FIELDS[open] || []).length > 0 && (
        <div className="agp-field" role="group" aria-label={actionLabel(open)}>
          {ACTION_FIELDS[open].map((f) => {
            // The status choices are the server's one list (shell_facts.ACTION_STATUSES), sent with the briefing.
            const spec = f === 'status' ? { ...FIELD_INPUT.status, options: ctx.statuses || [] } : FIELD_INPUT[f];
            return (
              <label key={f} className="agp-field">{spec.label}{spec.type === 'select' ? (
                <select value={input[f] || ''} onChange={(e) => setInput({ ...input, [f]: e.target.value })}>
                  <option value="">Choose</option>
                  {spec.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type={spec.type} dir="auto" value={input[f] || ''} onChange={(e) => setInput({ ...input, [f]: e.target.value })} />
              )}</label>
            );
          })}
          <button type="button" className="btn btn--sm" onClick={() => start(open)}>Prepare {actionLabel(open).toLowerCase()}</button>
        </div>
      )}
      {error && <PlainNote text={error} className="g-err" role="alert" />}
      {confirm && (
        <ConfirmCard confirm={confirm} write={`work:${confirm.action || 'agent'}`} onConfirm={() => ctx.confirm(confirm, patchConfirm)}
          onCancel={() => setConfirm(null)} onUndo={() => ctx.undo(confirm, patchConfirm)} />
      )}
    </div>
  );
}

function Carousel({ items, ctx, actions }) {
  const [at, setAt] = useState(0);
  const item = items[at];
  return (
    <div className="agp-carousel" role="region" aria-label="Records, one at a time">
      <div className="agp-carousel-bar">
        <button type="button" className="ibtn" onClick={() => setAt(Math.max(0, at - 1))} disabled={at === 0} aria-label="Previous record"><Icon name="left" size={14} /></button>
        <small>{at + 1} of {items.length}</small>
        <button type="button" className="ibtn" onClick={() => setAt(Math.min(items.length - 1, at + 1))} disabled={at >= items.length - 1} aria-label="Next record"><Icon name="right" size={14} /></button>
      </div>
      <Ticket ticket={item} ctx={ctx} actions={actions} />
    </div>
  );
}

function Choice({ block, ctx }) {
  const [pick, setPick] = useState('');
  const option = block.options.find((o) => o.id === pick);
  return (
    <div className="agp-choice" role="group" aria-label={block.prompt || 'Choose'}>
      {block.prompt && <p className="agp-prompt">{block.prompt}</p>}
      <div className="agp-field">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={block.prompt || 'Choose one'}>
          <option value="">Choose</option>
          {block.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button type="button" className="btn btn--sm btn--pri" disabled={!option} onClick={() => ctx.ask(askText(option))}>Continue</button>
      </div>
    </div>
  );
}

function MultiSelect({ block, ctx }) {
  const [picked, setPicked] = useState([]);
  const ok = multiValid(block, picked);
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);
  return (
    <div className="agp-multi" role="group" aria-label={block.prompt || 'Pick any'}>
      {block.prompt && <p className="agp-prompt">{block.prompt}</p>}
      <ul className="agp-cards">
        {block.options.map((o) => (
          <li key={o.id}>
            <label className={`agp-card${picked.includes(o.id) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} />
              <span><b>{o.label}</b>{o.detail && <small>{o.detail}</small>}</span>
            </label>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--sm btn--pri" disabled={!ok} onClick={() => ctx.ask(multiAsk(block, picked))}>
        {block.submit || 'Use these'} ({picked.length})
      </button>
    </div>
  );
}

function Table({ block, ctx }) {
  const heads = columnHeads(ctx.page, block.columns);
  const [shown, setShown] = useState(block.columns);
  const cols = heads.filter((h) => shown.includes(h.id));
  return (
    <div className="agp-table">
      <fieldset className="agp-colpick">
        <legend>Columns</legend>
        {heads.map((h) => (
          <label key={h.id}><input type="checkbox" checked={shown.includes(h.id)} onChange={() => setShown(shown.includes(h.id) ? shown.filter((x) => x !== h.id) : [...shown, h.id])} /> {h.label}</label>
        ))}
      </fieldset>
      <table>
        <thead><tr><th scope="col">Record</th>{cols.map((c) => <th scope="col" key={c.id}>{c.label}</th>)}</tr></thead>
        <tbody>
          {(block.rows || []).map((r) => (
            <tr key={r.record_key}>
              <td><button type="button" className="agp-link" onClick={() => ctx.openRecord?.(r.record_key)}>{r.record_key}</button></td>
              {cols.map((c) => <td key={c.id}>{r[c.id] ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartBlock({ block, ctx }) {
  const chart = chartOf(ctx.page, block.chart_id);
  const result = ctx.charts?.[block.chart_id];
  if (!chart) return null;
  return (
    <div className="agp-chart">
      {block.title && <p className="agp-prompt">{block.title}</p>}
      {result ? <ChartCard chart={chart} result={result} app={ctx.app} pageId={ctx.page.id} themeKey={ctx.themeKey} onPick={() => {}} />
        : <p className="agp-meta">Loading the chart</p>}
    </div>
  );
}

function Email({ block }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(copyText(block)); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <article className="agp-email" aria-label={`Draft to ${block.to_label}`}>
      <p className="agp-meta">To {block.to_label}</p>
      <p className="agp-subject">{block.subject}</p>
      <pre className="agp-body">{block.body}</pre>
      <button type="button" className="btn btn--sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </article>
  );
}

// compare: 2-4 options side by side; the button of an option sends its follow-up question.
function Compare({ block, ctx }) {
  return (
    <section className="agp-compare" aria-label={block.title || 'Compare'}>
      {block.title && <p className="agp-prompt">{block.title}</p>}
      <div className="agp-options">
        {block.options.map((o) => (
          <article key={o.id} className="agp-option" data-option={o.id}>
            <button type="button" className="btn btn--sm btn--pri" onClick={() => ctx.ask(askText(o))}>{o.label}</button>
            {o.detail && <p className="agp-why">{o.detail}</p>}
            {o.facts?.length > 0 && (
              <dl className="agp-facts">
                {o.facts.map((f, i) => <div key={`${f.label}-${i}`}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
              </dl>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

// resolve: one click prepares "done" for the record and writes the prepared change (ctx.resolve); then it shows what was gained.
function Resolve({ block, ctx }) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const stake = stakeText(block.value_at_stake, ctx.page);
  const gained = stake ? `+${stake.replace(/^\+/, '')}` : '';
  const click = async () => {
    setState('saving');
    setError('');
    try {
      await ctx.resolve(block.record_key);
      setState('done');
    } catch (e) {
      setError(e.message);
      setState('idle');
    }
  };
  return (
    <article className="agp-resolve" aria-label={block.label}>
      <header>
        <button type="button" className="agp-link" onClick={() => ctx.openRecord?.(block.record_key)}>{block.label}</button>
        {block.status && <small className="agp-meta">{block.status}</small>}
      </header>
      {state === 'done'
        ? <p className="agp-gained" data-gained>{gained || 'Resolved'}</p>
        : <button type="button" className="btn btn--sm btn--pri" disabled={state === 'saving'} onClick={click}>Resolve{gained && <> <b>{gained}</b></>}</button>}
      {error && <PlainNote text={error} className="g-err" role="alert" />}
    </article>
  );
}

export function Block({ block, ctx }) {
  switch (block.type) {
    case 'text': return <div className="agp-text"><Markdown text={block.markdown} /></div>;
    case 'ticket': return <Ticket ticket={block} ctx={ctx} actions={ctx.ticketActions || []} />;
    case 'carousel': return <Carousel items={block.items} ctx={ctx} actions={ctx.ticketActions || []} />;
    case 'actions': return <ActionRow keys={block.record_keys} actions={block.actions} ctx={ctx} />;
    case 'choice': return <Choice block={block} ctx={ctx} />;
    case 'multi_select': return <MultiSelect block={block} ctx={ctx} />;
    case 'table': return <Table block={block} ctx={ctx} />;
    case 'chart': return <ChartBlock block={block} ctx={ctx} />;
    case 'kpi': return (
      <div className="agp-kpi" data-kpi={block.kpi_id}>
        <small>{kpiName(ctx.page, block.kpi_id)}</small>
        <b>{block.value}</b>
        {block.value_at_stake && <Money value={block.value_at_stake} page={ctx.page} />}
        {block.note && <p className="agp-meta">{block.note}</p>}
      </div>
    );
    case 'compare': return <Compare block={block} ctx={ctx} />;
    case 'resolve': return <Resolve block={block} ctx={ctx} />;
    case 'email': return <Email block={block} />;
    case 'feedback': return <Rate message={{ turn_id: ctx.turnId, refused: false }} onRate={ctx.rate} />;
    default: return null;
  }
}

export default function Blocks({ blocks = [], ctx }) {
  return (
    <div className="agp-blocks">
      {blocks.map((b, i) => <div key={`${b.type}-${i}`} className="agp-block" data-block={b.type}><Block block={b} ctx={ctx} /></div>)}
    </div>
  );
}
