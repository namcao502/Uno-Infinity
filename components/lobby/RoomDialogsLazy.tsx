'use client';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';

// Lazy-load the room dialogs (and their Firebase database/functions deps) only when a dialog is
// actually requested via the URL, keeping the landing page's initial JS light.
const RoomDialogs = dynamic(() => import('./RoomDialogs').then((m) => ({ default: m.RoomDialogs })), {
  ssr: false,
});

export function RoomDialogsLazy() {
  const params = useSearchParams();
  const active = params.has('create') || params.has('browse') || params.has('join') || params.has('room') || params.has('rules');
  return active ? <RoomDialogs /> : null;
}
