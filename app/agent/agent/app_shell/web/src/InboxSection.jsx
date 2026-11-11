import { PlainNote } from './ui.jsx';
import { shortDay } from './hub.js';
import { NOT_IN_RUN } from './records.js';
import { CHANGED_GROUP, INBOX_GROUPS } from './inbox.js';
import { SectionHelp } from './SectionHelp.jsx';

const EMPTY = {
  fix: 'Nothing to fix right now.', runs: 'No run failed since the last one that finished.', reports: 'No new report waits for you.',
  changed: 'Nothing else changed since you were last here.', assigned: 'You own no open item.', due: 'Nothing of yours is due soon.', due_owner: 'Nothing of yours, and nothing nobody owns, is due soon.',
};

function Item({ item, onOpen }) {
  const what = item.kind === 'record' ? [item.status, item.due ? `${item.late ? 'Overdue since' : 'Due'} ${shortDay(item.due)}` : '', item.unowned ? 'Nobody owns it yet' : '']
    .filter(Boolean).join(' · ') : item.sub;
  return (
    <li>
      <button type="button" className="inbox-i" onClick={() => onOpen(item)} data-inbox-item={item.key} data-inbox-kind={item.kind}>
        <span className="inbox-t"><b><bdi dir="auto">{item.label}</bdi></b>{item.fresh && <span className="chg-b chg-b--you">New</span>}
          {item.kept && <span className="chg-b chg-b--missing">{NOT_IN_RUN}</span>}</span>
        {what && <small><bdi dir="auto">{what}</bdi></small>}
      </button>
    </li>
  );
}

export default function InboxSection({ page, inbox, onOpen }) {
  if (!inbox) return null;
  const since = inbox.lastVisit > 0 ? `Your last visit was ${shortDay(new Date(inbox.lastVisit).toISOString().slice(0, 10))}; items changed since then say New.`
    : 'This is your first visit on this device, so no item says New yet.';
  const shown = INBOX_GROUPS.filter(([id]) => inbox.on[id] || inbox.groups[id].length > 0);
  const group = ([id, title], note) => (
    <section key={id} className="inbox-g" data-inbox-group={id} aria-labelledby={`inbox-h-${id}`}>
      <h3 id={`inbox-h-${id}`}>{title}<span className="faint">{` ${inbox.groups[id].length}`}</span>{note && <span className="chg-b inbox-info">{note}</span>}</h3>
      {inbox.groups[id].length ? <ul>{inbox.groups[id].map((item) => <Item key={`${item.kind}:${item.key}`} item={item} onOpen={onOpen} />)}</ul>
        : <p className="faint">{EMPTY[id === 'due' && page.is_owner === true ? 'due_owner' : id]}</p>}
    </section>
  );
  return (
    <section className="card inbox-page" aria-label="Inbox" aria-busy={!inbox.ready} data-inbox-panel>
      <header className="card-h">
        <div>
          <h2>Inbox</h2>
          <p>Everything that waits for you on {page.title}. Each item opens the page where you deal with it. {since}</p>
        </div>
      <SectionHelp title={'Inbox'} steps={[{ title: 'Inbox', text: "Everything that waits for you on this use case. Each item opens the page where you deal with it." }]} /></header>
      {inbox.errors.records && <PlainNote text={inbox.errors.records} prefix="Your records could not load: " className="tile-err" role="alert" />}
      {inbox.errors.reports && <PlainNote text={inbox.errors.reports} prefix="The reported issues could not load: " className="tile-err" role="alert" />}
      {!inbox.ready && <p className="more" role="status">Loading…</p>}
      <div className="inbox-gs">
        {shown.map((g) => group(g))}
      </div>
      {inbox.on.changed && (
        <div className="inbox-gs inbox-fyi" data-inbox-fyi>
          {group(CHANGED_GROUP, 'Nothing to do')}
          <p className="faint inbox-fyi-n">Other people changed these since your last visit. They need nothing from you and are not counted in the Inbox.</p>
        </div>
      )}
    </section>
  );
}
