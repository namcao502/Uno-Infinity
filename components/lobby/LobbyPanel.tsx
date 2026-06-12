'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { callAddBot, callRemoveBot, callStartGame, callDeleteRoom } from '@/lib/functions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LeaveRoomButton } from './LeaveRoomButton';
import { useT } from '@/lib/i18n/context';
import type { RoomMeta, SeatRow } from '@/lib/hooks/useRoom';

/** The waiting-room UI, rendered inside the lobby popup on the home page. Presentational:
 *  the room subscription (meta/seats/presence) lives in the LobbyDialog wrapper. */
export function LobbyPanel({ roomId, meta, seats }: { roomId: string; meta: RoomMeta; seats: SeatRow[] }) {
  const { user } = useAuth();
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteRoom = async () => {
    setBusy(true);
    try { await callDeleteRoom({ roomId }); router.push('/'); }
    catch (e) { toast.error((e as { message?: string })?.message ?? t.errors.generic); setBusy(false); }
  };

  const removeBot = async (botId: string) => {
    setBusy(true);
    try { await callRemoveBot({ roomId, botId }); }
    catch (e) { toast.error((e as { message?: string })?.message ?? t.errors.generic); }
    finally { setBusy(false); }
  };

  const isHost = user?.uid === meta.hostId;
  const players = seats.filter((s) => !s.isAudience);
  const spectators = seats.filter((s) => s.isAudience);
  const iAmAudience = seats.find((s) => s.id === user?.uid)?.isAudience === true;
  const canStart = players.length >= 2;
  const full = players.length >= meta.maxPlayers;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-dashed bg-card p-4">
        <div>
          <p className="text-xs uppercase text-muted-foreground">{t.lobby.roomCode}</p>
          <p className="text-2xl font-black tracking-[0.3em] text-lc-yellow">{meta.code}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(`${location.origin}/?room=${roomId}`)}>
            {t.lobby.copyLink}
          </Button>
          <LeaveRoomButton roomId={roomId} canBecomeAudience={!iAmAudience} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">{t.lobby.players}</h2>
          <span className="text-sm text-muted-foreground">{players.length} / {meta.maxPlayers}</span>
        </div>
        <ul className="space-y-2">
          {players.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-lc-blue text-sm font-bold text-white">
                {s.name.charAt(0).toUpperCase()}
              </span>
              <span className="font-medium">{s.name}</span>
              {s.id === meta.hostId && <Badge variant="secondary">{t.lobby.host}</Badge>}
              {s.isBot && <Badge variant="outline">🤖 {t.lobby.bot}</Badge>}
              {isHost && s.isBot && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => removeBot(s.id)} className="ml-auto text-lc-red hover:bg-lc-red/10">
                  {t.lobby.removeBot}
                </Button>
              )}
            </li>
          ))}
        </ul>

        {spectators.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-bold text-muted-foreground">{t.lobby.spectators} ({spectators.length})</h3>
            <ul className="flex flex-wrap gap-2">
              {spectators.map((s) => (
                <li key={s.id} className="rounded-full border bg-background px-3 py-1 text-xs">{s.name}</li>
              ))}
            </ul>
          </div>
        )}

        {isHost && !iAmAudience && (
          <div className="mt-4 flex gap-2">
            <Button size="lg" variant="outline" disabled={busy || full} onClick={async () => { setBusy(true); try { await callAddBot({ roomId }); } finally { setBusy(false); } }}>
              {t.lobby.addBot}
            </Button>
            <Button
              size="lg"
              className="flex-1 bg-lc-yellow text-lc-ink hover:bg-lc-yellow/90"
              disabled={busy || !canStart}
              title={canStart ? undefined : t.lobby.needTwo}
              onClick={async () => { setBusy(true); try { await callStartGame({ roomId }); } finally { setBusy(false); } }}
            >
              {t.lobby.startGame}
            </Button>
          </div>
        )}
        {isHost && (
          <Button
            size="lg"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            className="mt-3 w-full border-lc-red/40 text-lc-red hover:bg-lc-red/10"
          >
            {t.lobby.deleteRoom}
          </Button>
        )}
        {!isHost && !iAmAudience && <p className="mt-4 text-sm text-muted-foreground">{t.lobby.waitingForHost}</p>}
        {iAmAudience && <p className="mt-4 text-sm font-semibold text-muted-foreground">{t.lobby.spectating}</p>}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => !busy && setConfirmDelete(false)}>
          <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{t.lobby.deleteConfirmTitle}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t.lobby.deleteConfirmNote}</p>
            <div className="mt-5 flex flex-col gap-2">
              <Button size="lg" disabled={busy} onClick={deleteRoom} className="bg-lc-red text-white hover:bg-lc-red/90">{t.lobby.deleteRoom}</Button>
              <Button size="lg" disabled={busy} variant="ghost" onClick={() => setConfirmDelete(false)}>{t.common.cancel}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
