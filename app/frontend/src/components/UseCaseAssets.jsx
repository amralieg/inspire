import React from 'react';
import { raisePermissions } from '../lib/permissionBus';
import { assetCells, dbuCell } from '../lib/useCaseAssets';

/** REQ-427: App / Dashboard / Lakebase / Genie as Yes or No, then the DBUs this use case consumed. */
export default function UseCaseAssets({ useCaseId, flags, dbus }) {
  if (!flags) return null;
  const dbu = dbuCell(dbus, useCaseId);
  return (
    <div data-use-case-assets={useCaseId} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-5 py-2 text-xs text-text-secondary">
      {assetCells(flags).map((cell) => (
        <span key={cell.key} data-asset={cell.key} data-built={cell.value === 'Yes' ? 'yes' : 'no'}>
          {cell.label}: <span className={cell.value === 'Yes' ? 'font-medium text-text-primary' : ''}>{cell.value}</span>
        </span>
      ))}
      <span data-asset="dbus">{dbu.text}</span>
      {dbu.permissions.length > 0 && (
        <button type="button" data-see-grant="" className="text-db-red-fg hover:underline font-medium"
          onClick={() => raisePermissions(dbu.permissions, {}, { explicit: true })}>
          Show the grant
        </button>
      )}
    </div>
  );
}
