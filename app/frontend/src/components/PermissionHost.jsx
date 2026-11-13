import { useEffect, useState } from 'react';
import PermissionRequired from './PermissionRequired';
import { subscribePermissions } from '../lib/permissionBus';

// Mounted once at the App root. Shows one Permission Required dialog at a time.
export default function PermissionHost() {
  const [open, setOpen] = useState(null);
  useEffect(() => subscribePermissions((permissions, extra) => {
    setOpen((cur) => {
      const same = cur && JSON.stringify(cur.permissions) === JSON.stringify(permissions);
      if (same) return { ...cur, ...extra };
      return { permissions, ...extra };
    });
  }), []);
  if (!open) return null;
  return <PermissionRequired permissions={open.permissions} onRetry={open.retry} onStart={open.onStart} onClose={() => setOpen(null)} />;
}
