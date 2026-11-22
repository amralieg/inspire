import React from 'react';
import { assetCells } from '../lib/useCaseAssets';

/** REQ-427: App / Dashboard / Lakebase / Genie as Yes or No. */
export default function UseCaseAssets({ useCaseId, flags }) {
  if (!flags) return null;
  return (
    <div data-use-case-assets={useCaseId} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-5 py-2 text-xs text-text-secondary">
      {assetCells(flags).map((cell) => (
        <span key={cell.key} data-asset={cell.key} data-built={cell.value === 'Yes' ? 'yes' : 'no'}>
          {cell.label}: <span className={cell.value === 'Yes' ? 'font-medium text-text-primary' : ''}>{cell.value}</span>
        </span>
      ))}
    </div>
  );
}
