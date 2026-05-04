import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'splitwise-theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

export const THEME_OPTIONS = [
  { value: 'system', label: 'System', description: 'Follow your device setting.' },
  { value: 'light', label: 'Light', description: 'Use the light palette.' },
  { value: 'dark', label: 'Dark', description: 'Use the dark palette.' },
];

function getSystemTheme() {
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

function getStoredTheme() {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function resolveTheme(theme, systemTheme) {
  return theme === 'system' ? systemTheme : theme;
}

function applyResolvedTheme(theme) {
  const root = document.documentElement;
  const body = document.body;
  const isDark = theme === 'dark';
  root.classList.toggle('dark', isDark);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  if (body) {
    body.classList.toggle('dark', isDark);
    body.dataset.theme = theme;
    body.style.colorScheme = theme;
  }

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', isDark ? '#0f1418' : '#f8f5ef');
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getStoredTheme);
  const [systemTheme, setSystemTheme] = useState(() =>
    typeof window === 'undefined' ? 'light' : getSystemTheme(),
  );

  const resolvedTheme = resolveTheme(theme, systemTheme);

  useEffect(() => {
    const media = window.matchMedia(MEDIA_QUERY);

    const handleChange = (event) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };

    setSystemTheme(media.matches ? 'dark' : 'light');

    if (media.addEventListener) {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  function toggleTheme() {
    setTheme((currentTheme) =>
      resolveTheme(currentTheme, systemTheme) === 'dark' ? 'light' : 'dark',
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return value;
}
