'use client';
import { useEffect, useState } from 'react';
import { onValue, ref, remove } from 'firebase/database';
import { rtdb } from '../firebase';
import { useAuth } from '../auth';
import type { Card } from '@uno/engine';

export interface Peek { targetId: string; cards: Card[] }
export function usePeek(roomId: string | null) {
  const { user } = useAuth();
  const [peek, setPeek] = useState<Peek | null>(null);
  useEffect(() => {
    if (!roomId || !user) return;
    const r = ref(rtdb, `peek/${roomId}/${user.uid}`);
    const u = onValue(r, s => { const v = s.val(); if (v) setPeek({ targetId: v.targetId, cards: v.cards ?? [] }); });
    return () => u();
  }, [roomId, user]);
  const dismiss = () => { if (roomId && user) remove(ref(rtdb, `peek/${roomId}/${user.uid}`)); setPeek(null); };
  return { peek, dismiss };
}
