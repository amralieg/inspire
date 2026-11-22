import { useEffect, useState } from 'react';
import { getValueCounter } from './api.js';
import { counterLines, counterTitle } from './valueCounter.js';

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
