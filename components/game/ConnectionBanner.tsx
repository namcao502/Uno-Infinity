'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { rtdb } from '@/lib/firebase';
import { useT } from '@/lib/i18n/context';

export function ConnectionBanner({ eliminated }: { eliminated: boolean }) {
  const [online, setOnline] = useState(true);
  const t = useT();
  useEffect(() => {
    const u = onValue(ref(rtdb, '.info/connected'), (s) => setOnline(s.val() === true));
    return () => u();
  }, []);

  if (!online) {
    return <div className="rounded-lg bg-destructive/15 px-4 py-2 text-center text-sm font-semibold text-destructive">{t.game.reconnecting}</div>;
  }
  if (eliminated) {
    return <div className="rounded-lg bg-muted px-4 py-2 text-center text-sm font-semibold">{t.game.audienceBanner}</div>;
  }
  return null;
}
