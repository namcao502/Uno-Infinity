'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRoom } from '@/lib/hooks/useRoom';
import { usePresence } from '@/lib/hooks/usePresence';
import { useAuth } from '@/lib/auth';
import { callAddBot, callStartGame } from '@/lib/functions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GameTable } from '@/components/game/GameTable';
import { LeaveRoomButton } from './LeaveRoomButton';

export function Lobby({ roomId }: { roomId: string }) {
  const { meta, seats } = useRoom(roomId);
  const { user } = useAuth();
  usePresence(roomId);
  const [busy, setBusy] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTimedOut(true), 4000); return () => clearTimeout(t); }, []);

  if (!meta) {
    if (timedOut) {
      return (
        <div className="mx-auto max-w-md space-y-3 p-10 text-center">
          <p className="text-muted-foreground">Room not found.</p>
          <Link className={buttonVariants({ variant: 'outline' })} href="/">Back to home</Link>
        </div>
      );
    }
    return <div className="mx-auto max-w-md p-10 text-center text-muted-foreground">Loading room...</div>;
  }
  if (meta.phase !== 'lobby') return <GameTable roomId={roomId} />;

  const isHost = user?.uid === meta.hostId;
  const players = seats.filter((s) => !s.isAudience);
  const spectators = seats.filter((s) => s.isAudience);
  const iAmAudience = seats.find((s) => s.id === user?.uid)?.isAudience === true;
  const canStart = players.length >= 2;
  const full = players.length >= meta.maxPlayers;

  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-6 py-10">
      <div className="flex items-center justify-between rounded-xl border border-dashed bg-card p-4">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Room code</p>
          <p className="text-2xl font-black tracking-[0.3em] text-[#f4c430]">{meta.code}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(`${location.origin}/play?room=${roomId}`)}>
            Copy link
          </Button>
          <LeaveRoomButton roomId={roomId} canBecomeAudience={!iAmAudience} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">Players</h2>
          <span className="text-sm text-muted-foreground">{players.length} / {meta.maxPlayers}</span>
        </div>
        <ul className="space-y-2">
          {players.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2b6cb0] text-sm font-bold text-white">
                {s.name.charAt(0).toUpperCase()}
              </span>
              <span className="font-medium">{s.name}</span>
              {s.id === meta.hostId && <Badge variant="secondary">Host</Badge>}
              {s.isBot && <Badge variant="outline">🤖 bot</Badge>}
            </li>
          ))}
        </ul>

        {spectators.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-bold text-muted-foreground">Spectators ({spectators.length})</h3>
            <ul className="flex flex-wrap gap-2">
              {spectators.map((s) => (
                <li key={s.id} className="rounded-full border bg-background px-3 py-1 text-xs">{s.name}</li>
              ))}
            </ul>
          </div>
        )}

        {isHost && !iAmAudience && (
          <div className="mt-4 flex gap-2">
            <Button variant="outline" disabled={busy || full} onClick={async () => { setBusy(true); try { await callAddBot({ roomId }); } finally { setBusy(false); } }}>
              Add bot
            </Button>
            <Button
              className="flex-1 bg-[#f4c430] text-[#1a1500] hover:bg-[#f4c430]/90"
              disabled={busy || !canStart}
              title={canStart ? undefined : 'Need at least 2 players'}
              onClick={async () => { setBusy(true); try { await callStartGame({ roomId }); } finally { setBusy(false); } }}
            >
              Start game
            </Button>
          </div>
        )}
        {!isHost && !iAmAudience && <p className="mt-4 text-sm text-muted-foreground">Waiting for the host to start...</p>}
        {iAmAudience && <p className="mt-4 text-sm font-semibold text-muted-foreground">You are spectating this room.</p>}
      </div>
    </div>
  );
}
