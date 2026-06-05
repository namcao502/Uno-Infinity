'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { rtdb } from '../firebase';
import { useAuth } from '../auth';
import type { Card } from '@uno/engine';

export function useHand(roomId: string | null): Card[] {
  const { user } = useAuth();
  const [hand, setHand] = useState<Card[]>([]);
  useEffect(() => {
    if (!roomId || !user) return;
    const u = onValue(ref(rtdb, `hands/${roomId}/${user.uid}`), s => setHand(s.val()?.cards ?? []));
    return () => u();
  }, [roomId, user]);
  return hand;
}
