'use client';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/i18n/context';

/** Switches between English and Vietnamese. Shows the language you'd switch TO (like ThemeToggle).
 *  Locale is server-resolved, so this is hydration-safe without a mount guard. */
export function LanguageToggle({ className }: { className?: string }) {
  const [locale, setLocale] = useLocale();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Switch language"
      className={className}
      onClick={() => setLocale(locale === 'en' ? 'vi' : 'en')}
    >
      {locale === 'en' ? 'VI' : 'EN'}
    </Button>
  );
}
