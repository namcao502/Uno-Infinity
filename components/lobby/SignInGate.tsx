'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { Button, buttonVariants } from '@/components/ui/button';
import { useT } from '@/lib/i18n/context';

export function SignInGate() {
  const { signInGoogle } = useAuth();
  const t = useT();
  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-6 py-16 text-center">
      <h1 className="text-2xl font-black">{t.signInGate.title}</h1>
      <p className="text-muted-foreground">{t.signInGate.subtitle}</p>
      <Button
        onClick={() => { signInGoogle().catch(() => {}); }}
        className="w-full bg-lc-yellow text-lc-ink hover:bg-lc-yellow/90"
      >
        {t.signInGate.cta}
      </Button>
      <Link href="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        {t.common.backToHome}
      </Link>
    </div>
  );
}
