'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/lib/auth';

export function SiteHeader() {
  const { user, signInGoogle, signOutUser } = useAuth();
  return (
    <header className="flex items-center justify-between gap-4 py-6">
      <Link href="/" className="flex items-center gap-2 text-xl font-extrabold tracking-wide">
        <span className="flex">
          <span className="-mr-2 inline-flex h-8 w-6 -rotate-6 items-center justify-center rounded-md border-2 border-white bg-[#e63946] text-white">U</span>
          <span className="inline-flex h-8 w-6 rotate-6 items-center justify-center rounded-md border-2 border-white bg-[#2a9d4a] text-white">N</span>
        </span>
        UNO INFINITY
      </Link>
      <nav className="flex items-center gap-3 text-sm font-semibold text-muted-foreground sm:gap-5">
        <Link href="/how-to-play" className="hidden hover:text-foreground sm:inline">How to Play</Link>
        <Link href="/rules" className="hidden hover:text-foreground sm:inline">House Rules</Link>
        <Link href="/about" className="hidden hover:text-foreground sm:inline">About</Link>
        <ThemeToggle />
        {user ? (
          <>
            <span className="hidden text-foreground sm:inline">{user.displayName ?? 'Player'}</span>
            <Button variant="outline" size="sm" onClick={() => { signOutUser().catch(() => {}); }}>
              Sign out
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => { signInGoogle().catch(() => {}); }}>
            Sign in with Google
          </Button>
        )}
      </nav>
    </header>
  );
}
