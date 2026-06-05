'use client';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { CreateJoin } from './CreateJoin';
import { Lobby } from './Lobby';
import { RoomBrowser } from './RoomBrowser';
import { SignInGate } from './SignInGate';

export function PlayClient() {
  const params = useSearchParams();
  const { user, ready } = useAuth();
  if (!ready) return <div className="p-10 text-center text-muted-foreground">Loading...</div>;
  if (!user) return <SignInGate />;
  const room = params.get('room');
  if (room) return <Lobby roomId={room} />;
  if (params.get('browse')) return <RoomBrowser />;
  const mode = params.get('join') ? 'join' : 'create';
  return <CreateJoin mode={mode} />;
}
