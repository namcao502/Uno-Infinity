'use client';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';
import { CardFan } from './CardFan';

export function Hero() {
  const t = useT();
  return (
    <section className="relative grid items-center gap-9 py-8 md:grid-cols-[1.1fr_0.9fr]">
      {/* Soft brand glow behind the hero (dopamine-lite, low opacity). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 -top-28 h-80 w-80 rounded-full bg-lc-yellow/20 blur-3xl" />
        <div className="absolute -right-16 top-16 h-72 w-72 rounded-full bg-lc-red/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-lc-blue/10 blur-3xl" />
      </div>
      <div>
        <span className="inline-block rounded-full bg-lc-yellow/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-lc-yellow">
          {t.hero.eyebrow}
        </span>
        <h1 className="mt-4 text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
          {t.hero.titleLine1}<br />
          <span className="text-lc-yellow">{t.hero.titleLine2}</span>
        </h1>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-muted-foreground">
          {t.hero.subtitle}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/play?create=1" className={cn(buttonVariants({ size: 'lg' }), 'bg-lc-yellow text-lc-ink hover:bg-lc-yellow/90')}>
            {t.hero.createRoom}
          </Link>
          <Link href="/play?browse=1" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            {t.hero.browseRooms}
          </Link>
          <Link href="/play?join=1" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
            {t.hero.joinWithCode}
          </Link>
        </div>
      </div>
      <CardFan />
    </section>
  );
}
