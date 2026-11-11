import { useEffect, useState } from 'react';
import { getMoney } from './api.js';
import { MORE_USE_CASES, valueStripOf } from './valueStrip.js';

export default function ValueStrip({ page, data, app }) {
  const [saved, setSaved] = useState(null);
  useEffect(() => {
    let live = true;
    getMoney(page.id)
      .then((money) => { if (live) setSaved(money.saved || null); })
      .catch(() => { if (live) setSaved({ since: '', lines: [], warning: 'the saved total could not be read' }); });
    return () => { live = false; };
  }, [page.id]);
  const strip = valueStripOf(page, data, app, saved);
  if (!strip) return null;
  const { kpi, more } = strip;
  return (
    <div className="value-strip" data-value-strip="" aria-label="Value and more use cases">
      {kpi && <p data-value-now="">{kpi.label}: <b>{data ? kpi.now : 'Loading'}</b></p>}
      {strip.saved && (strip.saved.warning
        ? <p role="alert" data-value-saved-warning="">{strip.saved.warning}</p>
        : <p data-value-saved="">{strip.saved.text}</p>)}
      {more && (
        <a className="link" data-more-use-cases="" href={more.href} target={more.inside ? '_top' : '_blank'}
          rel={more.inside ? undefined : 'noopener noreferrer'}>{MORE_USE_CASES}</a>
      )}
    </div>
  );
}
