'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { rtdb } from '@/lib/firebase';

export function ConnectionBanner({ eliminated }: { eliminated: boolean }) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const u = onValue(ref(rtdb, '.info/connected'), (s) => setOnline(s.val() === true));
    return () => u();
  }, []);

  if (!online) {
    return <div className="rounded-lg bg-destructive/15 px-4 py-2 text-center text-sm font-semibold text-destructive">Reconnecting...</div>;
  }
  if (eliminated) {
    return <div className="rounded-lg bg-muted px-4 py-2 text-center text-sm font-semibold">You are in the audience - you can still watch and chat.</div>;
  }
  return null;
}
