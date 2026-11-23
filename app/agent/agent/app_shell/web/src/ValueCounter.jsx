import { useEffect, useState } from 'react';
import { getValueCounter, getValueLeaders } from './api.js';
import { chipLines, counterLines, counterTitle } from './valueCounter.js';
import Leaders from './Leaders.jsx';

export default function ValueCounter({ page }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    getValueCounter(page.id).then((c) => { if (live) setData(c); }).catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [page.id]);
  return <CounterView data={data} />;
}

export function CounterView({ data }) {
  const lines = counterLines(data);
  if (!lines) return null;
  const title = counterTitle(data);
  const note = <> <span data-value-disclaimer="" className="value-note">{data.disclaimer.short}</span></>;
  return (
    <div className="value-counter" data-value-counter="" title={title}>
      {lines.mine && <p data-value-mine="">{lines.mine.text}{note}</p>}
      <p data-value-team="">{lines.team.text}{lines.mine ? null : note}</p>
      {(lines.streak || lines.badges.length > 0 || lines.next) && (
        <p className="value-play" data-value-play="">
          {lines.streak && <span data-value-streak="">{lines.streak}</span>}
          {lines.badges.map((label) => <span key={label} className="value-badge" data-value-badge="">{label}</span>)}
          {lines.next && <span data-value-next="">{lines.next}</span>}
        </p>
      )}
    </div>
  );
}

// REQ-506: the value chip next to the user's name; a click opens the board.
export function ValueChip({ page }) {
  const [counter, setCounter] = useState(null);
  const [leaders, setLeaders] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    getValueCounter(page.id).then((c) => {
      if (!live) return;
      setCounter(c);
      if (c && c.shown) getValueLeaders(page.id).then((l) => { if (live) setLeaders(l); }).catch(() => { if (live) setLeaders(null); });
    }).catch(() => { if (live) setCounter(null); });
    return () => { live = false; };
  }, [page.id]);
  const lines = chipLines(counter, leaders);
  return (
    <span className="value-chip-wrap">
      <button type="button" className={`value-chip${lines.set ? '' : ' is-unset'}`} data-value-chip="" aria-expanded={open}
        title={counter && counter.shown ? counterTitle(counter) : undefined} onClick={() => setOpen((o) => !o)}>
        <span data-chip-value="">{lines.value}</span>
        {lines.rank && <span className="value-chip-rank" data-chip-rank="">{lines.rank}</span>}
      </button>
      {open && <Leaders data={leaders} onClose={() => setOpen(false)} />}
    </span>
  );
}
