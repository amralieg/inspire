import { useState } from 'react';
import DataGrid from './DataGrid';

const PRIORITIES = ['Ultra High', 'Very High', 'High', 'Medium', 'Low'];
const PRIORITY_COLORS = { 'Ultra High': '#DC2626', 'Very High': '#EA580C', 'High': '#D97706', 'Medium': '#2563EB', 'Low': '#6B7280' };

function HeatCell({ domain, priority, count, maxCount, hovered, setHovered }) {
  const intensity = maxCount > 0 ? count / maxCount : 0;
  const color = PRIORITY_COLORS[priority];
  const key = `${domain}-${priority}`;
  return (
    <div
      className="heatmap-cell w-10 h-8 rounded-md flex items-center justify-center cursor-default relative"
      style={{
        backgroundColor: count > 0 ? `${color}${Math.round(intensity * 180 + 20).toString(16).padStart(2, '0')}` : 'var(--t-bg-subtle)',
        '--cell-color': color,
      }}
      onMouseEnter={() => setHovered(key)}
      onMouseLeave={() => setHovered(null)}
    >
      {count > 0 && (
        <span className="text-[10px] font-bold" style={{ color: intensity > 0.5 ? '#fff' : color }}>
          {count}
        </span>
      )}
      {hovered === key && count > 0 && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 glass rounded-md px-2 py-1 text-[9px] text-text-primary font-medium whitespace-nowrap z-20 shadow-md">
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
    { key: 'domain', label: 'Domain', headClassName: 'text-[9px] text-text-tertiary font-medium px-2 py-1.5 text-start',
      className: 'text-[10px] text-text-primary font-medium px-2 py-1 whitespace-nowrap max-w-[120px] truncate' },
    ...PRIORITIES.map((p) => ({
      key: p, label: p, kind: 'number', className: 'p-0.5',
      render: (row) => <HeatCell domain={row.domain} priority={p} count={row[p]} maxCount={maxCount} hovered={hovered} setHovered={setHovered} />,
    })),
  ];

  return (
    <DataGrid label="Use cases by domain and priority" grid="results:priority_heatmap" columns={columns} rows={rows} rowKey={(row) => row.domain}
      tableClassName="border-collapse" headClassName="text-[9px] text-text-secondary font-semibold px-2 py-1.5 text-center whitespace-nowrap" />
  );
}
