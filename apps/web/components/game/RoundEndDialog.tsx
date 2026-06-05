'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { RoomMeta, SeatRow } from '@/lib/hooks/useRoom';
import { useAuth } from '@/lib/auth';
import { callNextRound } from '@/lib/functions';
import { Button, buttonVariants } from '@/components/ui/button';

interface RoundEndDialogProps {
  roomId: string;
  meta: RoomMeta;
  seats: SeatRow[];
  winnerId: string | null;
}

export function RoundEndDialog({ roomId, meta, seats, winnerId }: RoundEndDialogProps) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (meta.phase !== 'gameOver' && meta.phase !== 'roundEnd') return null;

  const winner = seats.find((s) => s.id === winnerId);
  const isHost = user?.uid === meta.hostId;
  const standings = [...seats].sort((a, b) => a.handCount - b.handCount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center">
        <h2 className="text-2xl font-black">{meta.phase === 'gameOver' ? 'Game over' : 'Round over'}</h2>
        <p className="mt-1 text-[#f4c430]">{winner ? `${winner.name} wins!` : 'Winner decided'}</p>
        <ul className="mt-4 space-y-1 text-left text-sm">
          {standings.map((s) => (
            <li key={s.id} className="flex justify-between rounded border bg-background px-3 py-1.5">
              <span>{s.name}{s.id === winnerId ? ' 🏆' : ''}{s.status === 'out' ? ' (out)' : ''}</span>
              <span className="text-muted-foreground">{s.handCount} cards</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-center gap-2">
          {meta.phase === 'roundEnd' && isHost && (
            <Button disabled={busy} onClick={async () => { setBusy(true); try { await callNextRound({ roomId }); } finally { setBusy(false); } }}>
              Next round
            </Button>
          )}
          <Link href="/" className={buttonVariants({ variant: 'outline' })}>Back to home</Link>
        </div>
      </div>
    </div>
  );
}
