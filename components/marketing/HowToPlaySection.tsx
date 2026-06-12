'use client';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { useT } from '@/lib/i18n/context';

// Focused "How to Play": just the quick-start steps. The full House Rules card reference lives
// in a popup (?rules), linked below and from the header.
export function HowToPlaySection() {
  const t = useT();
  return (
    <section id="how-to-play" className="mt-20 scroll-mt-24">
      <article className="mx-auto max-w-3xl space-y-4">
        <h2 className="text-3xl font-black">{t.howTo.heading}</h2>
        <p className="text-muted-foreground">
          {t.howTo.intro1} <strong>{t.howTo.introColor}</strong> {t.howTo.introOr} <strong>{t.howTo.introType}</strong>{t.howTo.intro2}
        </p>
        <ol className="list-decimal space-y-2 pl-6 text-muted-foreground">
          <li><strong>{t.howTo.step1Bold}</strong> {t.howTo.step1}</li>
          <li><strong>{t.howTo.step2Bold}</strong>{t.howTo.step2}</li>
          <li><strong>{t.howTo.step3Bold}</strong> {t.howTo.step3}</li>
          <li><strong>{t.howTo.step4Bold}</strong> {t.howTo.step4}</li>
          <li><strong>{t.howTo.step5Bold}</strong>{t.howTo.step5}</li>
          <li><strong>{t.howTo.step6Bold}</strong> {t.howTo.step6}</li>
        </ol>
        <div className="pt-2">
          <Link href="/?rules" scroll={false} className={buttonVariants({ variant: 'outline', size: 'lg' })}>{t.howTo.seeRules}</Link>
        </div>
      </article>
    </section>
  );
}
