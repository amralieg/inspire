import { wholeMoney } from './format.js';

// REQ-506: the board. The viewer sees their own name; the server names everyone else User 1, User 2.
export default function Leaders({ data, onClose }) {
  const rows = data && data.shown ? data.leaders || [] : [];
  return (
    <div className="value-board" role="dialog" aria-label="Value leaders">
      <button type="button" className="value-board-close" aria-label="Close" onClick={onClose}>x</button>
      {rows.length === 0 && <p className="value-board-empty">No resolved records yet</p>}
      {rows.map((r) => (
        <div key={r.rank} className="value-leader" data-leader="" {...(r.me ? { 'data-me': '' } : {})}>
          <span className="value-leader-rank">{r.rank}</span>
          <span className="value-leader-name">{r.name}</span>
          <span className="value-leader-value">{wholeMoney(r.value, data.currency)}</span>
        </div>
      ))}
    </div>
  );
}
