import { genieOn } from './genieAsk.js';
import { Icon } from './icons.jsx';

export const REVIEW_LABEL = 'Open in Inspire Review';

const reviewable = (page) => !!(page.review && page.use_case_id);

export function reviewItem(page, app) {
  if (!reviewable(page)) return null;
  const inside = app.inside === true;
  return { label: REVIEW_LABEL, icon: <Icon name="external" size={14} />, run: () => window.open(page.review, inside ? '_top' : '_blank', inside ? undefined : 'noopener,noreferrer') };
}

export function ReviewLink({ page, app }) {
  if (!reviewable(page)) return null;
  const inside = app.inside === true;
  return (
    <a className="btn review top-ic" data-more="tight" href={page.review} target={inside ? '_top' : '_blank'} rel={inside ? undefined : 'noopener noreferrer'} data-review={page.id}
      aria-label={REVIEW_LABEL}
      title={`Opens ${page.title} on Inspire's Review page${inside ? '' : ' in a new tab'}`}>
      <Icon name="external" size={15} /><span>{REVIEW_LABEL}</span>
    </a>
  );
}

export function hubExplain(app, onExplain, page) {
  return genieOn(app, page) && onExplain ? (kind, title, context) => onExplain({ kind, page, title, context }) : null;
}
