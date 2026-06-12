'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n/context';
import { RulesReference } from './RulesSection';

/** House Rules card reference as a popup (?rules), keeping the landing page focused. */
export function RulesDialog() {
  const params = useSearchParams();
  const router = useRouter();
  const t = useT();
  const open = params.has('rules');
  const close = () => router.replace('/', { scroll: false });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">{t.rules.heading}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t.rules.intro}</p>
        <RulesReference />
      </DialogContent>
    </Dialog>
  );
}
