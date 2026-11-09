import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import DataGrid from './DataGrid';
import { PREVIEW_PAGE_ROWS, previewGrid } from '../lib/artifactFiles';

const LONG_CELL = 30;

function SheetPreview({ name, data }) {
  const [open, setOpen] = useState({});
  const { columns, rows } = useMemo(() => previewGrid(data), [data]);
  const read = rows.length;
  const gridColumns = useMemo(() => [
    { key: '#', label: '#', fixed: true, headClassName: 'px-3 py-2 text-[9px] text-text-tertiary font-mono text-end border-b border-e border-border w-8',
      className: 'px-3 py-1.5 text-[9px] text-text-tertiary font-mono text-end border-e border-border/50 w-8' },
    ...columns.map((c) => ({
      key: c.key, label: c.label,
      className: (row) => {
        const cell = `${row['#']}:${c.key}`;
        const long = String(row[c.key]).length > LONG_CELL;
        return `px-3 py-1.5 text-[11px] text-text-primary border-b border-border/30 ${open[cell] ? 'whitespace-normal break-words' : 'whitespace-nowrap max-w-[250px] truncate'} ${long ? 'cursor-pointer hover:bg-db-red-50/20' : ''}`;
      },
      render: (row) => {
        const text = String(row[c.key]);
        const cell = `${row['#']}:${c.key}`;
        if (text.length <= LONG_CELL) return text;
        return (
          <span role="button" tabIndex={0} title={open[cell] ? undefined : 'Click to expand'} aria-expanded={Boolean(open[cell])}
            onClick={() => setOpen((o) => ({ ...o, [cell]: !o[cell] }))}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => ({ ...o, [cell]: !o[cell] })); } }}>
            {text}
          </span>
        );
      },
    })),
  ], [columns, open]);
  return (
    <div className="rounded-xl border border-border overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-bg-subtle border-b border-border">
        <span className="text-[10px] font-semibold text-text-secondary">{columns.length} columns · {data.totalRows.toLocaleString('en-US')} rows</span>
        <span className="text-[9px] text-text-tertiary">Sort, filter or drag any column</span>
      </div>
      <DataGrid label={`Preview of ${name}`} grid={`preview:${name}`} columns={gridColumns} rows={rows} rowKey={(row) => row['#']} pageSize={PREVIEW_PAGE_ROWS}
        scrollClassName="max-h-[400px] overflow-auto" tableClassName="w-full border-collapse" theadClassName="sticky top-0 z-10" headRowClassName="bg-bg-subtle"
        headClassName="px-3 py-2 text-start text-[10px] text-text-primary font-semibold border-b border-border whitespace-nowrap"
        rowClassName={(_, i) => `${i % 2 === 0 ? 'bg-surface' : 'bg-bg-subtle/30'} hover:bg-db-red-50/30 transition-colors`} />
      {data.totalRows > read && (
        <div className="flex items-center justify-center gap-2 py-2.5 bg-bg-subtle border-t border-border text-[10px] text-text-tertiary">
          <span>Inspire read the first {read.toLocaleString('en-US')} of {data.totalRows.toLocaleString('en-US')} rows</span>
          <span className="text-text-disabled">·</span>
          <span>Download for full data</span>
        </div>
      )}
    </div>
  );
}

export default function FilePreview({ name, loading, data, pdfClassName = 'h-[500px] rounded-lg' }) {
  return (
    <>
      {loading && (
        <div className="flex items-center gap-2 py-4 justify-center">
          <Loader2 size={12} className="animate-spin text-text-tertiary" />
          <span className="text-[10px] text-text-secondary">Loading preview...</span>
        </div>
      )}
      {data?.type === 'pdf' && <iframe src={data.url} className={`w-full border border-border ${pdfClassName}`} title="PDF Preview" />}
      {data?.type === 'csv' && <SheetPreview key={name} name={name} data={data} />}
      {data?.type === 'error' && <p role="alert" dir="auto" className="text-[10px] text-error-fg py-2">{data.message}</p>}
    </>
  );
}
