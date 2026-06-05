'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { rtdb } from '../firebase';

/**
 * Server-aligned wall clock in ms, ticking ~twice a second. Uses RTDB
 * `.info/serverTimeOffset` to correct for client clock skew so turn-timer
 * countdowns match the deadlines written by the server.
 */
export function useServerNow(): number {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const u = onValue(ref(rtdb, '.info/serverTimeOffset'), (s) => setOffset(Number(s.val()) || 0));
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => { u(); clearInterval(t); };
  }, []);
  return now + offset;
}
