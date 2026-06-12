'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import type { RoomMeta, SeatRow } from '@/lib/hooks/useRoom';
import { callReturnToLobby } from '@/lib/functions';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/context';

interface RoundEndDialogProps {
  roomId: string;
  meta: RoomMeta;
  seats: SeatRow[];
  winnerId: string | null;
}

export function RoundEndDialog({ roomId, meta, seats, winnerId }: RoundEndDialogProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  if (meta.phase !== 'gameOver') return null;

  const winner = seats.find((s) => s.id === winnerId);
  const standings = [...seats].sort((a, b) => a.handCount - b.handCount);
  const backToLobby = async () => {
    setBusy(true);
    try {
      await callReturnToLobby({ roomId });
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? t.roundEnd.returnError);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center">
        <h2 className="text-2xl font-black">{t.roundEnd.gameOver}</h2>
        <p className="mt-1 text-lc-yellow">{winner ? t.roundEnd.wins(winner.name) : t.roundEnd.winnerDecided}</p>
        <ul className="mt-4 space-y-1 text-left text-sm">
          {standings.map((s) => (
            <li key={s.id} className="flex justify-between rounded border bg-background px-3 py-1.5">
              <span>{s.name}{s.id === winnerId ? ' 🏆' : ''}{s.status === 'out' ? ` (${t.roundEnd.out})` : ''}</span>
              <span className="text-muted-foreground">{t.roundEnd.cards(s.handCount)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-center">
          <Button size="lg" disabled={busy} variant="outline" onClick={backToLobby}>
            {t.roundEnd.backToLobby}
          </Button>
        </div>
      </div>
    </div>
  );
}
