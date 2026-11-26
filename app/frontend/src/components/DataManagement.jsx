import { useState } from 'react';
import DataFilters from './DataFilters';
import RelationshipsSection from './RelationshipsSection';
import useDataTables from './useDataTables';

// The one line for the metric views left out (REQ-370): the count, why, and the names behind a "Show them" control.
function MetricViewsLine({ names }) {
  const [open, setOpen] = useState(false);
  const many = names.length !== 1;
  return (
    <div data-metric-views-left-out role="status" className="text-warning-fg space-y-1">
      <p>
        {names.length} metric view{many ? 's are' : ' is'} left out of Data Management: {many ? 'they' : 'it'} cannot be filtered.{' '}
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="underline">Show {many ? 'them' : 'it'}</button>
      </p>
      {open && (
        <ul data-metric-views-names className="font-mono text-text-secondary ps-4 list-disc">
          {names.map((name) => <li key={name}>{name}</li>)}
        </ul>
      )}
    </div>
  );
}

// Data Management (REQ-361): two sections in order. Relationships first (how the picked tables join), then the Data filter.
export default function DataManagement({ scope, scopes, relationships, onRelationships, apiFetch, warehouseId, ...rest }) {
  const listing = useDataTables({ scope, scopes, apiFetch, warehouseId });
  return (
    <div data-data-management className="space-y-6 text-xs">
      {listing.metricViews.length > 0 && <MetricViewsLine names={listing.metricViews} />}
      <section aria-labelledby="data-management-relationships" data-section="relationships" className="space-y-2">
        <h3 id="data-management-relationships" className="text-sm font-bold text-text-primary">Relationships</h3>
        <p className="text-text-secondary">How the tables you picked join. Inspire suggests them from declared keys, then from matching column names.</p>
        <RelationshipsSection tables={listing.tables} relationships={relationships} onRelationships={onRelationships} apiFetch={apiFetch}
          warehouseId={warehouseId} onMetricViews={listing.addMetricViews} />
      </section>
      <section aria-labelledby="data-management-filter" data-section="data-filter" className="space-y-2">
        <h3 id="data-management-filter" className="text-sm font-bold text-text-primary">Data filter</h3>
        <DataFilters scope={scope} scopes={scopes} tables={listing.tables} listing={listing} apiFetch={apiFetch} warehouseId={warehouseId}
          onMetricViews={listing.addMetricViews} {...rest} />
      </section>
    </div>
  );
}
