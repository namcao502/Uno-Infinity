'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { rtdb } from '../firebase/db';

export interface LobbyRoom {
  code: string;
  hostId?: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  createdAt: number;
  deckTotal: number;
  startingHandSize: number;
  phase?: 'lobby' | 'playing' | 'duel' | 'bombResponse';
}

/** Subscribe to the public room index; returns rooms (lobby + in-progress), newest first. */
export function useLobbies() {
  const [rooms, setRooms] = useState<LobbyRoom[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const u = onValue(ref(rtdb, 'lobbies'), (s) => {
      const v = (s.val() ?? {}) as Record<string, LobbyRoom>;
      setRooms(Object.values(v).sort((a, b) => b.createdAt - a.createdAt));
      setLoading(false);
    });
    return () => u();
  }, []);
  return { rooms, loading };
}
