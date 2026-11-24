import { useState } from 'react';
import DataGrid from './DataGrid';

const PRIORITIES = ['Ultra High', 'Very High', 'High', 'Medium', 'Low'];
const PRIORITY_COLORS = {
  'Ultra High': 'var(--color-error-solid)',
  'Very High': 'color-mix(in srgb, var(--color-warning) 40%, var(--color-error-solid))',
  'High': 'color-mix(in srgb, var(--color-warning) 80%, var(--color-error-solid))',
  'Medium': 'var(--color-info)',
  'Low': 'var(--color-text-tertiary)',
};

function HeatCell({ domain, priority, count, maxCount, hovered, setHovered }) {
  const intensity = maxCount > 0 ? count / maxCount : 0;
  const color = PRIORITY_COLORS[priority];
  const key = `${domain}-${priority}`;
  return (
    <div
      className="heatmap-cell w-10 h-8 rounded-md flex items-center justify-center cursor-default relative"
      style={{
        backgroundColor: count > 0 ? `color-mix(in srgb, ${color} ${Math.round(((intensity * 180 + 20) / 255) * 100)}%, transparent)` : 'var(--t-bg-subtle)',
        '--cell-color': color,
      }}
      onMouseEnter={() => setHovered(key)}
      onMouseLeave={() => setHovered(null)}
    >
      {count > 0 && (
        <span className="text-caption font-bold" style={{ color: intensity > 0.5 ? 'white' : color }}>
          {count}
        </span>
      )}
      {hovered === key && count > 0 && (
        <div className="absolute -top-8 start-1/2 -translate-x-1/2 glass rounded-md px-2 py-1 text-caption text-text-primary font-medium whitespace-nowrap z-20 shadow-md">
          {domain}: {count} {priority}
        </div>
      )}
    </div>
  );
}

export default function PriorityHeatmap({ useCases = [], domains = [] }) {
  const [hovered, setHovered] = useState(null);
  if (!useCases.length || !domains.length) return null;

  const domainNames = domains.map(d => d.domain_name || d).filter(Boolean);
  const rows = domainNames.map((domain) => ({
    domain,
    ...Object.fromEntries(PRIORITIES.map((p) => [p, useCases.filter((uc) =>
      (uc['Business Domain'] || uc._domain || uc.domain) === domain && (uc.Priority || uc.priority) === p).length])),
  }));
  const maxCount = Math.max(0, ...rows.flatMap((row) => PRIORITIES.map((p) => row[p])));
  const columns = [
    { key: 'domain', label: 'Domain', headClassName: 'text-caption text-text-tertiary font-medium px-2 py-1.5 text-start',
      className: 'text-caption text-text-primary font-medium px-2 py-1 whitespace-nowrap max-w-[120px] truncate' },
    ...PRIORITIES.map((p) => ({
      key: p, label: p, kind: 'number', className: 'p-0.5',
      render: (row) => <HeatCell domain={row.domain} priority={p} count={row[p]} maxCount={maxCount} hovered={hovered} setHovered={setHovered} />,
    })),
  ];

  return (
    <DataGrid label="Use cases by domain and priority" grid="results:priority_heatmap" columns={columns} rows={rows} rowKey={(row) => row.domain}
      tableClassName="border-collapse" headClassName="text-caption text-text-secondary font-semibold px-2 py-1.5 text-center whitespace-nowrap" />
  );
}
