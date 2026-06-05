import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CardFan } from './CardFan';

export function Hero() {
  return (
    <section className="grid items-center gap-9 py-8 md:grid-cols-[1.1fr_0.9fr]">
      <div>
        <span className="inline-block rounded-full bg-[#f4c430]/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#f4c430]">
          Real-time - up to 10 players - bots included
        </span>
        <h1 className="mt-4 text-5xl font-black leading-[1.04] tracking-tight">
          Play Uno your way.<br />
          <span className="text-[#f4c430]">Infinity rules, your call.</span>
        </h1>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-muted-foreground">
          Spin up a private room in seconds, tune the whole deck - draw stacks, x2/&divide;2, duels,
          bombs, swaps and more - then share a code. Sign in with Google and deal.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/play?create=1" className={cn(buttonVariants({ size: 'lg' }), 'bg-[#f4c430] text-[#1a1500] hover:bg-[#f4c430]/90')}>
            Create a Room
          </Link>
          <Link href="/play?browse=1" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Browse Rooms
          </Link>
          <Link href="/play?join=1" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
            Join with Code
          </Link>
        </div>
      </div>
      <CardFan />
    </section>
  );
}
