'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRoom } from '@/lib/hooks/useRoom';
import { buttonVariants } from '@/components/ui/button';
import { GameTable } from '@/components/game/GameTable';
import { TIMING } from '@/lib/constants';
import { useT } from '@/lib/i18n/context';

/**
 * The /play?room= renderer. The lobby waiting room is now a popup on the home page, so this
 * route only hosts the live game: while a room is still in the lobby phase we bounce to
 * /?room= (the popup); once the game starts we render the full-screen GameTable.
 */
export function Lobby({ roomId }: { roomId: string }) {
  const { meta } = useRoom(roomId);
  const router = useRouter();
  const t = useT();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => { const id = setTimeout(() => setTimedOut(true), TIMING.roomNotFoundMs); return () => clearTimeout(id); }, []);

  const lobbyPhase = meta?.phase === 'lobby';
  useEffect(() => {
    if (lobbyPhase) router.replace(`/?room=${roomId}`, { scroll: false });
  }, [lobbyPhase, roomId, router]);

  if (!meta) {
    if (timedOut) {
      return (
        <div className="mx-auto max-w-md space-y-3 p-10 text-center">
          <p className="text-muted-foreground">{t.lobby.notFound}</p>
          <Link className={buttonVariants({ variant: 'outline' })} href="/">{t.common.backToHome}</Link>
        </div>
      );
    }
    return <div className="mx-auto max-w-md p-10 text-center text-muted-foreground">{t.lobby.loadingRoom}</div>;
  }
  if (lobbyPhase) return <div className="mx-auto max-w-md p-10 text-center text-muted-foreground">{t.lobby.loadingRoom}</div>;
  return <GameTable roomId={roomId} />;
}
