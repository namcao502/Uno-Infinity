'use client';
import { useEffect, useState } from 'react';
import { onChildAdded, push, ref, query, limitToLast } from 'firebase/database';
import { rtdb } from '../firebase';
import { useAuth } from '../auth';

export interface ChatMsg { id: string; uid: string; name: string; kind: 'text' | 'emote'; body: string; ts: number }

export function useChat(roomId: string | null, nickname: string) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  useEffect(() => {
    if (!roomId) return;
    setMessages([]);
    const q = query(ref(rtdb, `rooms/${roomId}/chat`), limitToLast(50));
    const u = onChildAdded(q, (s) => setMessages(m => [...m, { id: s.key!, ...(s.val() as Omit<ChatMsg, 'id'>) }]));
    return () => u();
  }, [roomId]);

  const send = (kind: 'text' | 'emote', body: string) => {
    if (!user || !body.trim()) return;
    return push(ref(rtdb, `rooms/${roomId}/chat`), { uid: user.uid, name: nickname || 'Player', kind, body: body.slice(0, 280), ts: Date.now() });
  };
  return { messages, send };
}
