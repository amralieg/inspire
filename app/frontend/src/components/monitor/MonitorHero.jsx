import { Activity, Loader2 } from 'lucide-react';
import PageHeader from '../ui/PageHeader';
import MoreMenu from '../ui/MoreMenu';
import Button from '../ui/Button';

// REQ-511 Monitor C: the hero holds the page header, the run stepper and the status card (children), the screen's one More menu, and at most one primary.
// state is running | done | failed | offline; primary is { label, onClick, busy } or null.
export default function MonitorHero({ state, subtitle, primary, menuItems, children }) {
  return (
    <section data-monitor-hero="" data-state={state} aria-label="This run" className="mb-6">
      {/* PageHeader renders a <header>, which the REQ-510 probes treat as chrome, so the primary and More sit beside it, not inside it. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PageHeader title="Monitor" icon={Activity} subtitle={subtitle} className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-2">
          {primary && (
            <Button data-variant="primary" onClick={primary.onClick} disabled={primary.busy} className="px-4">
              {primary.busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {primary.label}
            </Button>
          )}
          {menuItems.length > 0 && <MoreMenu items={menuItems} />}
        </div>
      </div>
      {children}
    </section>
  );
}
