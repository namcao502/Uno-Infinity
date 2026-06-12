import { cn } from '@/lib/utils';

// Organic blob shapes (borrowed technique). `fill="currentColor"` so brand color comes from a
// `text-lc-*` class on each instance.
const PATHS = {
  a: 'M300,80 C370,100 410,180 380,270 C350,360 240,400 160,370 C80,340 20,260 40,170 C60,80 130,20 210,30 C260,37 280,65 300,80Z',
  b: 'M220,40 C270,70 290,140 260,200 C230,260 150,290 90,260 C30,230 10,150 40,90 C70,30 140,0 190,20 C205,25 215,34 220,40Z',
  c: 'M180,20 C250,10 330,60 340,140 C350,220 300,310 220,330 C140,350 50,300 20,220 C-10,140 30,40 100,20 C130,12 158,23 180,20Z',
} as const;

const VIEWBOX = { a: '0 0 400 400', b: '0 0 300 300', c: '0 0 350 350' } as const;

function Blob({ variant, className }: { variant: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox={VIEWBOX[variant]} className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d={PATHS[variant]} fill="currentColor" />
    </svg>
  );
}

/** Soft, slowly-drifting brand-colored blobs - one per card color - fixed behind the whole page
 *  so they stay put while you scroll. Decorative + non-interactive. will-change-transform promotes
 *  each to its own layer so the blur isn't re-rasterized on scroll. */
export function HeroBlobs({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none fixed inset-y-0 left-1/2 w-full max-w-6xl -translate-x-1/2 -z-10 overflow-hidden', className)}>
      <Blob variant="a" className="absolute left-4 top-20 h-[32rem] w-[32rem] text-lc-red/20 blur-3xl will-change-transform animate-blob-1 motion-reduce:animate-none" />
      <Blob variant="b" className="absolute right-4 top-14 h-[32rem] w-[32rem] text-lc-green/20 blur-3xl will-change-transform animate-blob-2 motion-reduce:animate-none" />
      <Blob variant="c" className="absolute bottom-12 left-8 h-[32rem] w-[32rem] text-lc-blue/20 blur-3xl will-change-transform animate-blob-3 motion-reduce:animate-none" />
      <Blob variant="b" className="absolute bottom-16 right-8 h-[32rem] w-[32rem] text-lc-yellow/20 blur-3xl will-change-transform animate-blob-1 [animation-delay:-7s] motion-reduce:animate-none" />
    </div>
  );
}
