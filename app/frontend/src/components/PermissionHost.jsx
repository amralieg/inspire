import { useEffect, useState } from 'react';
import PermissionRequired from './PermissionRequired';
import { grantListKey, subscribePermissions } from '../lib/permissionBus';

// Mounted once at the App root. Shows one Permission Required dialog at a time.
export default function PermissionHost() {
  const [open, setOpen] = useState(null);
  // quiet: a repeat of grants already shown. It merges into the open dialog for the same grants and never opens one.
  useEffect(() => subscribePermissions((permissions, extra, { quiet = false } = {}) => {
    setOpen((cur) => {
      const same = cur && grantListKey(cur.permissions) === grantListKey(permissions);
      if (same) return { ...cur, ...extra };
      if (quiet) return cur;
      return { permissions, ...extra };
    });
  }), []);
  if (!open) return null;
  return <PermissionRequired permissions={open.permissions} onRetry={open.retry} onStart={open.onStart} onClose={() => setOpen(null)} />;
}
