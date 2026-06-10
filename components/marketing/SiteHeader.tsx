'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n/context';

export function SiteHeader() {
  const { user, signInGoogle, signOutUser } = useAuth();
  const t = useT();
  return (
    <header className="sticky top-0 z-40 -mx-6 flex items-center justify-between gap-4 border-b bg-background/80 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Link href="/" className="flex items-center gap-2 font-heading text-xl font-extrabold tracking-wide">
        <span className="inline-flex h-8 items-center justify-center rounded-md border-2 border-white bg-lc-red px-1.5 text-xs font-black text-white">LC</span>
        LAST CARD
      </Link>
      <nav className="flex items-center gap-3 text-sm font-semibold text-muted-foreground sm:gap-5">
        <Link href="/#how-to-play" className="hidden hover:text-foreground sm:inline">{t.header.howToPlay}</Link>
        <Link href="/#rules" className="hidden hover:text-foreground sm:inline">{t.header.houseRules}</Link>
        <Link href="/#about" className="hidden hover:text-foreground sm:inline">{t.header.about}</Link>
        <LanguageToggle />
        <ThemeToggle />
        {user ? (
          <>
            <span className="hidden text-foreground sm:inline">{user.displayName ?? t.createJoin.nicknamePlaceholder}</span>
            <Button variant="outline" size="sm" onClick={() => { signOutUser().catch(() => {}); }}>
              {t.header.signOut}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => { signInGoogle().catch(() => {}); }}>
            {t.header.signIn}
          </Button>
        )}
      </nav>
    </header>
  );
}
