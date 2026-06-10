import { en } from './en';
import { vi } from './vi';

export type { Dict } from './en';

export const dictionaries = { en, vi };
export type Locale = keyof typeof dictionaries;

/** Cookie name that persists the user's explicit language choice. */
export const LOCALE_COOKIE = 'lang';

/**
 * Resolve the locale for SSR: an explicit cookie wins; otherwise fall back to the
 * browser's preferred language (Vietnamese -> `vi`), defaulting to English.
 */
export function pickLocale(cookie?: string, acceptLanguage?: string | null): Locale {
  if (cookie === 'en' || cookie === 'vi') return cookie;
  if (acceptLanguage?.trim().toLowerCase().startsWith('vi')) return 'vi';
  return 'en';
}
