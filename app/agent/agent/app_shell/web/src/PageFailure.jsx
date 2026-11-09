import { createContext, useContext } from 'react';
import { Icon } from './icons.jsx';
import { PlainNote, TechnicalDetails, useToast } from './ui.jsx';
import { splitTechnical } from './plainText.js';
import { copyText } from './Draft.jsx';
import { COPIED_SEND_TEXT, COPY_SEND_LABEL, PAGE_FAILED_LEAD, RETRY_LABEL, RUNS_LABEL, SHARED_CARD_TEXT, partsFailedLead, said, sharedBy } from './failures.js';

const SharedFailure = createContext('');
export const SharedFailureScope = SharedFailure.Provider;
export const useSharedFailure = () => useContext(SharedFailure);
export const useShared = (text) => sharedBy(useSharedFailure(), text);

export function CardFailure({ text, prefix = '', size = 14, className = 'tile-err' }) {
  const shared = useShared(text);
  if (!said(text)) return null;
  if (shared) return <p className={`${className} tile-err--shared`} data-shared-failure=""><Icon name="info" size={size} />{SHARED_CARD_TEXT}</p>;
  return <PlainNote text={text} prefix={prefix} icon={<Icon name="info" size={size} />} className={className} />;
}

export function PageFailure({ failures, onRetry, onRuns }) {
  const toast = useToast();
  if (!failures?.shared) return null;
  const { plain, details } = splitTechnical(`${failures.whole ? PAGE_FAILED_LEAD : partsFailedLead(failures.count)}${failures.shared}`);
  const send = [plain, ...details].filter(Boolean).join('\n');
  const copy = async () => toast(await copyText(send) ? COPIED_SEND_TEXT : `Select and copy this: ${send}`, 'info', { ms: 12000 });
  return (
    <section className="tile-err page-failure" role="alert" data-page-failure="">
      <p><Icon name="info" size={14} />{plain}</p>
      <div className="page-failure-a" data-choices="">
        {onRetry && <button type="button" className="lnk" onClick={onRetry} data-retry="">{RETRY_LABEL}</button>}
        <button type="button" className="lnk" onClick={copy} data-copy-send="">{COPY_SEND_LABEL}</button>
        {onRuns && <button type="button" className="lnk" onClick={onRuns} data-see-runs="">{RUNS_LABEL}</button>}
      </div>
      <TechnicalDetails items={details} />
    </section>
  );
}
