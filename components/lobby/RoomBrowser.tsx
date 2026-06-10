'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLobbies } from '@/lib/hooks/useLobbies';
import { callJoinRoom } from '@/lib/functions';
import { Button, buttonVariants } from '@/components/ui/button';
import { useT } from '@/lib/i18n/context';

export function RoomBrowser() {
  const router = useRouter();
  const { nickname, ready } = useAuth();
  const { rooms, loading } = useLobbies();
  const [busy, setBusy] = useState('');
  const t = useT();

  const join = async (code: string, role: 'player' | 'audience') => {
    setBusy(code);
    try {
      await callJoinRoom({ code, name: nickname || t.createJoin.nicknamePlaceholder, role });
      router.push(`/play?room=${code}`);
    } catch {
      setBusy('');
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-black">{t.browser.title}</h1>
        <Link href="/play?create=1" className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t.browser.createRoom}</Link>
      </div>

      {loading && <p className="text-muted-foreground">{t.browser.loading}</p>}

      {!loading && rooms.length === 0 && (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-muted-foreground">
          {t.browser.emptyPrefix}<Link href="/play?create=1" className="font-semibold text-foreground underline">{t.browser.emptyLink}</Link>.
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
              <div className="flex shrink-0 gap-2">
                <Button disabled={!ready || full || busy === r.code} onClick={() => join(r.code, 'player')} title={full ? t.browser.roomFull : undefined}>
                  {busy === r.code ? '...' : t.browser.play}
                </Button>
                <Button variant="outline" disabled={!ready || busy === r.code} onClick={() => join(r.code, 'audience')}>
                  {t.browser.watch}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
