'use client';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n/context';
import { CreateJoin } from './CreateJoin';
import { Lobby } from './Lobby';
import { RoomBrowser } from './RoomBrowser';
import { SignInGate } from './SignInGate';

export function PlayClient() {
  const params = useSearchParams();
  const { user, ready } = useAuth();
  const t = useT();
  if (!ready) return <div className="p-10 text-center text-muted-foreground">{t.common.loading}</div>;
  if (!user) return <SignInGate />;
  const room = params.get('room');
  if (room) return <Lobby roomId={room} />;
  if (params.get('browse')) return <RoomBrowser />;
  const mode = params.get('join') ? 'join' : 'create';
  return <CreateJoin mode={mode} />;
}
