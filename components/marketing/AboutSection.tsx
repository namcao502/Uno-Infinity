'use client';
import { useT } from '@/lib/i18n/context';

export function AboutSection() {
  const t = useT();
  return (
    <section id="about" className="mt-20 scroll-mt-24">
      <article className="mx-auto max-w-3xl space-y-4">
        <h2 className="text-3xl font-black">{t.about.heading}</h2>
        <p className="text-muted-foreground">{t.about.p1}</p>
        <p className="text-muted-foreground">{t.about.p2}</p>
      </article>
    </section>
  );
}
