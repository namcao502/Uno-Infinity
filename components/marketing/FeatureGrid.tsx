'use client';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

interface Feature {
  icon: string;
  tint: string;
  title: string;
  body: string;
  span: string;   // bento placement on md+
  big?: boolean;
}

const DECK_SWATCHES = ['bg-lc-red', 'bg-lc-green', 'bg-lc-blue', 'bg-lc-yellow', 'bg-lc-black'];

export function FeatureGrid() {
  const t = useT();
  const FEATURES: Feature[] = [
    { icon: '⚙', tint: 'rgba(230,57,70,0.16)', title: t.features.builderTitle, body: t.features.builderBody, span: 'md:col-span-2 md:row-span-2', big: true },
    { icon: '⚡', tint: 'rgba(43,108,176,0.16)', title: t.features.roomsTitle, body: t.features.roomsBody, span: 'md:col-span-1' },
    { icon: '💬', tint: 'rgba(42,157,74,0.16)', title: t.features.chatTitle, body: t.features.chatBody, span: 'md:col-span-1' },
  ];
  return (
    <section className="mt-16 grid gap-4 md:auto-rows-fr md:grid-cols-3">
      {FEATURES.map((f) => (
        <div
          key={f.title}
          className={cn(
            'group relative flex flex-col overflow-hidden rounded-2xl border bg-card/30 p-6 backdrop-blur-md transition-all duration-200',
            'shadow-[0_1px_0_0_rgba(255,255,255,0.05)_inset,0_12px_30px_-18px_rgba(0,0,0,0.6)]',
            'hover:-translate-y-1 hover:border-lc-yellow/30 hover:shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_22px_45px_-22px_rgba(0,0,0,0.7)]',
            f.span,
          )}
        >
          {/* Top edge highlight for a little tactile depth. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          <div
            className={cn('flex items-center justify-center rounded-xl', f.big ? 'h-14 w-14 text-3xl' : 'h-11 w-11 text-xl')}
            style={{ background: f.tint }}
          >
            {f.icon}
          </div>
          <h3 className={cn('mt-3 font-bold', f.big ? 'text-xl' : 'text-base')}>{f.title}</h3>
          <p className={cn('mt-1 leading-relaxed text-muted-foreground', f.big ? 'text-base' : 'text-sm')}>{f.body}</p>
          {f.big && (
            <div className="mt-auto flex gap-2 pt-6">
              {DECK_SWATCHES.map((c) => (
                <span
                  key={c}
                  aria-hidden
                  className={cn('h-9 w-7 rounded-md border-2 border-white/80 shadow-md transition-transform duration-200 group-hover:-translate-y-0.5', c)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
