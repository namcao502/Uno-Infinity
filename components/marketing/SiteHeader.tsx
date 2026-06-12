'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n/context';
import { cn } from '@/lib/utils';

export function SiteHeader() {
  const { user, signInGoogle, signOutUser } = useAuth();
  const t = useT();
  // Transparent at the top of the page; gains a blurred background once scrolled (borrowed technique).
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header
      className={cn(
        'sticky top-0 z-40 -mx-6 flex items-center justify-between gap-4 border-b px-6 py-4 transition-colors duration-300',
        scrolled
          ? 'border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60'
          : 'border-transparent',
      )}
    >
      <Link href="/" className="flex items-center gap-2 font-heading text-xl font-extrabold tracking-wide">
        <span className="inline-flex h-8 items-center justify-center rounded-md border-2 border-white bg-lc-red px-1.5 text-xs font-black text-white">LC</span>
        LAST CARD
      </Link>
      <nav className="flex items-center gap-3 text-sm font-semibold text-muted-foreground sm:gap-5">
        <Link href="/#how-to-play" className="hidden hover:text-foreground sm:inline">{t.header.howToPlay}</Link>
        <Link href="/?rules" scroll={false} className="hidden hover:text-foreground sm:inline">{t.header.houseRules}</Link>
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
