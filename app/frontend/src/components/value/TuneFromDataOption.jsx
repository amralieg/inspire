import { useState } from 'react';
import { TUNE_FROM_DATA_LABEL, readTuneFromData, writeTuneFromData } from '../../lib/tuneFromData';

// C24 (P247): the one option, shared by Settings and the Calculate value dialog. Ticked (default): the value uses the records Inspire counted;
// unticked: only the estimates and the numbers the person types.
export default function TuneFromDataOption({ onChange, className = '' }) {
  const [on, setOn] = useState(readTuneFromData);
  const pick = (next) => { setOn(next); writeTuneFromData(next); onChange?.(next); };
  return (
    <label data-tune-from-data="" className={`flex items-start gap-2 text-sm text-text-primary ${className}`}>
      <input type="checkbox" checked={on} onChange={(e) => pick(e.target.checked)} className="mt-0.5" />
      <span>
        {TUNE_FROM_DATA_LABEL}
        <span className="block text-xs text-text-tertiary">Value figures use the records Inspire counted. Untick to use only estimates and the numbers you type.</span>
      </span>
    </label>
  );
}
