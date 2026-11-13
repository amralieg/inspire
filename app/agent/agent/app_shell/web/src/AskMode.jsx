import { useEffect, useState } from 'react';
import GeniePanel from './Genie.jsx';
import { answerQuality, answersOf, readAnswers, withRatings, writeAnswers } from './answers.js';
import { dayLabel, integer } from './format.js';
import { Icon } from './icons.jsx';
import { ModeEmpty } from './ModeParts.jsx';
import { SectionHelp } from './SectionHelp.jsx';
import { genieOf } from './genieAsk.js';

function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}

const personOf = (app) => app.user?.email || app.user?.name || '';

function Work({ app, page, genie, onPick }) {
  const person = personOf(app);
  useEffect(() => {
    if (!genie || genie.key !== page.id) return;
    const storage = browserStorage();
    const next = withRatings(readAnswers(storage), person, page.id, genie.thread);
    if (next) writeAnswers(storage, next);
  }, [genie?.thread, genie?.key, page.id, person]);
  return (
    <div className="mode-work mode-ask" data-mode-work="ask">
      {genie ? <GeniePanel app={app} genie={genie} page={page} pages={app.pages} onPick={onPick} full /> : <ModeEmpty>{genieOf(app, page.id).note || 'Ask Genie is off for this use case.'}</ModeEmpty>}
    </div>
  );
}

function Performance({ app, page }) {
  const [list] = useState(() => answersOf(readAnswers(browserStorage()), personOf(app), page.id));
  const q = answerQuality(list);
  return (
    <section className="card mode-quality" data-mode-performance="ask" aria-label="Answer quality">
      <header className="card-h"><div><h2>Answer quality</h2><p>From the answers you rated in Ask, in this browser.</p></div><SectionHelp title={'Answer quality'} steps={[{ title: 'Answer quality', text: "Each answer you rated in Ask, marked helpful or not. Use it to see where Genie answers well and where it needs a fix." }]} /></header>
      {!q.rated && <ModeEmpty>Rate Genie&apos;s answers in Ask with Helpful or Not helpful, and the share of helpful answers shows here.</ModeEmpty>}
      {q.rated > 0 && (
        <div className="mode-stats">
          <div className="mode-stat" data-stat="rated"><small>Answers rated</small><b>{integer(q.rated)}</b></div>
          <div className="mode-stat" data-stat="helpful"><small>Helpful</small><b>{Math.round(q.share * 100)}%</b><small>{integer(q.up)} of {integer(q.rated)}</small></div>
          <div className="mode-stat" data-stat="wrong"><small>Wrong answers</small><b>{integer(q.wrong.length)}</b></div>
        </div>
      )}
      {q.wrong.length > 0 && (
        <ul className="mode-list" aria-label="Wrong answers">
          {q.wrong.map((e) => <li key={e.id}><Icon name="info" size={13} /><span>{e.question || 'A question'}</span><small>{dayLabel(new Date(e.at).toISOString().slice(0, 10))}</small></li>)}
        </ul>
      )}
    </section>
  );
}

export default { Work, Performance };
