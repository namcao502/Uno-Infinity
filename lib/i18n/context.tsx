'use client';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { dictionaries, LOCALE_COOKIE, type Dict, type Locale } from './index';

interface LanguageContextValue {
  locale: Locale;
  dict: Dict;
  setLocale: (l: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  // Seeded from the server-resolved locale so SSR and the first client render match (no flash).
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = (l: Locale) => {
    setLocaleState(l); // instant UI swap
    // Persist so future loads SSR in the chosen language.
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
  };

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, dict: dictionaries[locale], setLocale }),
    [locale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}

/** The active dictionary (same shape as `en`). */
export const useT = (): Dict => useLanguage().dict;

/** Current locale + a setter that persists the choice. */
export function useLocale(): [Locale, (l: Locale) => void] {
  const { locale, setLocale } = useLanguage();
  return [locale, setLocale];
}
