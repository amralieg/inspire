import { Sun, Moon } from 'lucide-react';
import DatabricksLogo from './DatabricksLogo';
import { useTheme } from '../ThemeContext';
import { NAV_TABS } from '../lib/tabs';

const NAV = NAV_TABS.map((tab, i) => ({ ...tab, step: i + 1 }));

export default function Header({
  page,
  setPage,
  canLaunch,
  canMonitor,
  canResults,
  canImplement,
  canRun = true,
}) {
  const { theme, toggle } = useTheme();
  const enabled = {
    landing: true,
    choose: true,
    monitor: canMonitor,
    results: canResults || true,
    implement: canImplement,
    run: canRun,
  };

  return (
    <header className="bg-surface/80 backdrop-blur-xl border-b border-border sticky top-0 z-40">
      <div className="max-w-screen-xl mx-auto px-3 sm:px-6">
        <div className="flex items-center justify-between gap-2 h-14">
          {/* Brand */}
          <button
            onClick={() => setPage('landing')}
            className="flex shrink-0 items-center gap-2.5 group"
          >
            <DatabricksLogo className="w-7 h-7" />
            <span className="whitespace-nowrap text-text-primary font-bold text-xl tracking-tight">
              Inspire AI
            </span>
          </button>

          {/* Navigation */}
          <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
            {NAV.map((item) => {
              const active = page === item.id;
              const can = enabled[item.id];
              return (
                <button
                  key={item.id}
                  onClick={() => can && setPage(item.id)}
                  disabled={!can}
                  aria-current={active ? 'page' : undefined}
                  title={item.label}
                  className={`
                    relative shrink-0 whitespace-nowrap px-1.5 lg:px-4 py-2 text-sm font-medium rounded-md transition-smooth
                    ${active
                      ? 'text-db-red-fg bg-db-red-50'
                      : can
                        ? 'text-text-secondary hover:text-text-primary hover:bg-bg-subtle'
                        : 'text-text-disabled cursor-not-allowed'
                    }
                  `}
                >
                  <span className="flex items-center gap-1.5">
                    {item.step && (
                      <span className={`text-xs font-mono ${active ? 'text-db-red-fg' : can ? 'text-text-tertiary' : 'opacity-50'}`}>
                        {String(item.step).padStart(2, '0')}
                      </span>
                    )}
                    <span className="sr-only lg:not-sr-only">{item.label}</span>
                  </span>
                  {active && (
                    <span className="absolute bottom-0 inset-x-3 h-0.5 bg-db-red rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Theme toggle */}
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={toggle}
              className="p-2 rounded-md text-text-secondary hover:text-db-red-fg hover:bg-db-red-50 transition-smooth"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
