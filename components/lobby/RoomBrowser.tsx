'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { useLobbies } from '@/lib/hooks/useLobbies';
import { callJoinRoom, callDeleteRoom } from '@/lib/functions';
import { Button, buttonVariants } from '@/components/ui/button';
import { useT } from '@/lib/i18n/context';

export function RoomBrowser({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const { nickname, ready, user } = useAuth();
  const { rooms, loading } = useLobbies();
  const [busy, setBusy] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const t = useT();

  const join = async (code: string, role: 'player' | 'audience') => {
    setBusy(code);
    try {
      await callJoinRoom({ code, name: nickname || t.createJoin.nicknamePlaceholder, role });
      router.push(`/?room=${code}`);
    } catch {
      setBusy('');
    }
  };

  // Host-only: delete one of your own rooms straight from the browse list (the lobby index
  // entry disappears on success, so the list refreshes itself).
  const remove = async (code: string) => {
    setBusy(code);
    try { await callDeleteRoom({ roomId: code }); setConfirmDelete(null); }
    catch (e) { toast.error((e as { message?: string })?.message ?? t.errors.generic); }
    finally { setBusy(''); }
  };

  return (
    <div className={embedded ? 'space-y-6' : 'mx-auto w-full max-w-2xl space-y-6 px-6 py-10'}>
      {/* Top create CTA only when rooms exist; the empty state has its own create link,
          so showing both there would duplicate the button. */}
      {(!embedded || rooms.length > 0) && (
        <div className="flex items-center justify-between gap-4">
          {!embedded && <h1 className="text-2xl font-black">{t.browser.title}</h1>}
          {rooms.length > 0 && (
            <Link href="/?create" scroll={false} className={buttonVariants({ variant: 'outline', size: 'lg' })}>{t.browser.createRoom}</Link>
          )}
        </div>
      )}

      {loading && <p className="text-muted-foreground">{t.browser.loading}</p>}

      {!loading && rooms.length === 0 && (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center">
          <p className="text-muted-foreground">{t.browser.emptyPrefix}</p>
          <div className="mt-4">
            <Link href="/?create" scroll={false} className={buttonVariants({ variant: 'outline', size: 'lg' })}>{t.browser.createRoom}</Link>
          </div>
        </div>
      )}

      <ul className="space-y-3">
        {rooms.map((r) => {
          const inGame = r.phase && r.phase !== 'lobby';
          const full = r.players >= r.maxPlayers;
          return (
            <li key={r.code} className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4">
              <div>
                <p className="flex items-center gap-2 text-lg font-black tracking-[0.2em] text-lc-yellow">
                  {r.code}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-normal ${inGame ? 'bg-lc-red/15 text-lc-red' : 'bg-muted text-muted-foreground'}`}>
                    {inGame ? t.browser.inGame : t.browser.inLobby}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {t.browser.roomLine(r.hostName, r.players, r.maxPlayers, r.deckTotal)}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="lg" disabled={!ready || full || busy === r.code} onClick={() => join(r.code, 'player')} title={full ? t.browser.roomFull : undefined}>
                  {busy === r.code ? '...' : t.browser.play}
                </Button>
                <Button size="lg" variant="outline" disabled={!ready || busy === r.code} onClick={() => join(r.code, 'audience')}>
                  {t.browser.watch}
                </Button>
                {user?.uid === r.hostId && (
                  <Button size="lg" variant="outline" disabled={busy === r.code} onClick={() => setConfirmDelete(r.code)} className="border-lc-red/40 text-lc-red hover:bg-lc-red/10">
                    {t.lobby.deleteRoom}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => busy !== confirmDelete && setConfirmDelete(null)}>
          <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{t.lobby.deleteConfirmTitle}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t.lobby.deleteConfirmNote}</p>
            <div className="mt-5 flex flex-col gap-2">
              <Button size="lg" disabled={busy === confirmDelete} onClick={() => remove(confirmDelete)} className="bg-lc-red text-white hover:bg-lc-red/90">{t.lobby.deleteRoom}</Button>
              <Button size="lg" disabled={busy === confirmDelete} variant="ghost" onClick={() => setConfirmDelete(null)}>{t.common.cancel}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
