import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  // FX-38b (REQ-453, W16 D36): a saved choice wins; with none, the page starts in the system's colour scheme.
  const [theme, setTheme] = useState(() => localStorage.getItem('inspire_theme')
    || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Only a click is a choice worth saving; the system default is read again on the next load.
  const toggle = () => setTheme((t) => {
    const next = t === 'dark' ? 'light' : 'dark';
    localStorage.setItem('inspire_theme', next);
    return next;
  });

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
