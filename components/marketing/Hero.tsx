'use client';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { useT } from '@/lib/i18n/context';
import { CardFan } from './CardFan';
import { HeroBlobs } from './Blobs';

export function Hero() {
  const t = useT();
  return (
    <section className="relative grid items-center gap-9 py-8 md:grid-cols-[1.1fr_0.9fr]">
      {/* Drifting brand blobs behind the hero (borrowed technique, dopamine-lite). */}
      <HeroBlobs />
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
          <Link href="/?create" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            {t.hero.createRoom}
          </Link>
          <Link href="/?browse" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            {t.hero.browseRooms}
          </Link>
          <Link href="/?join" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            {t.hero.joinWithCode}
          </Link>
        </div>
      </div>
      <div className="relative">
        <CardFan />
        {/* Floating "live" spec badge (borrowed technique, re-skinned to brand). z-10 keeps it
            above the fanned cards, which set their own zIndex (0-4) and would otherwise cover it. */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-2.5 rounded-2xl border bg-card/30 px-3.5 py-2.5 shadow-xl backdrop-blur-md sm:right-6">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lc-green opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-lc-green" />
          </span>
          <div className="leading-tight">
            <div className="text-[11px] text-muted-foreground">{t.hero.badgeLabel}</div>
            <div className="text-sm font-bold">{t.hero.badgeValue}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
