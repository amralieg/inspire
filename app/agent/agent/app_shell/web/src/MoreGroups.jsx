import { MultiSelect } from './FilterBar.jsx';
import { groupValues, setGroupValues } from './filters.js';

export default function MoreGroups({ groups, now, pageId, onState }) {
  return groups.map((g) => (
    <MultiSelect key={g.key} filter={g.filter} selected={groupValues(now, g)} pageId={pageId} onChange={(values) => onState(setGroupValues(now, g, values))} />
  ));
}
