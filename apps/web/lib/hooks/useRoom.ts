'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { rtdb } from '../firebase';
import type { PublicView } from '@uno/engine';

export interface SeatRow { id: string; name: string; isBot: boolean; seatIndex: number; connected: boolean; handCount: number; status: 'active' | 'out'; score: number; turn: boolean; isAudience?: boolean }
export interface RoomMeta { code: string; hostId: string; phase: 'lobby' | 'playing' | 'duel' | 'bombResponse' | 'roundEnd' | 'gameOver'; maxPlayers: number; config: import('@uno/engine').RuleConfig }
// Adds the server-set turn-timer deadline to the redacted public view.
export type PublicState = Omit<PublicView, 'players' | 'you'> & { turnDeadline?: number | null };
export interface PresenceInfo { online: boolean; lastSeen: number }

export function useRoom(roomId: string | null) {
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [pub, setPub] = useState<PublicState | null>(null);
  const [presence, setPresence] = useState<Record<string, PresenceInfo>>({});

  useEffect(() => {
    if (!roomId) return;
    const u1 = onValue(ref(rtdb, `rooms/${roomId}/meta`), s => setMeta(s.val()));
    const u2 = onValue(ref(rtdb, `rooms/${roomId}/seats`), s => {
      const v = s.val() ?? {};
      setSeats(Object.entries(v).map(([id, r]) => ({ id, ...(r as Omit<SeatRow, 'id'>) })).sort((a, b) => a.seatIndex - b.seatIndex));
    });
    const u3 = onValue(ref(rtdb, `rooms/${roomId}/public`), s => setPub(s.val()));
    const u4 = onValue(ref(rtdb, `rooms/${roomId}/presence`), s => setPresence(s.val() ?? {}));
    return () => { u1(); u2(); u3(); u4(); };
  }, [roomId]);

  return { meta, seats, pub, presence };
}
