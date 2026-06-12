'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useRoom } from '@/lib/hooks/useRoom';
import { usePresence } from '@/lib/hooks/usePresence';
import { TIMING } from '@/lib/constants';
import { useT } from '@/lib/i18n/context';
import { LobbyPanel } from './LobbyPanel';

/** Lobby waiting room as a popup on the home page, opened by ?room=CODE. Once the host starts,
 *  the live game takes over the full /play?room= page. */
export function LobbyDialog() {
  const params = useSearchParams();
  const room = params.get('room');
  if (!room) return null;
  return <LobbyDialogInner roomId={room} />;
}

function LobbyDialogInner({ roomId }: { roomId: string }) {
  const router = useRouter();
  const t = useT();
  const { user, ready, signInGoogle } = useAuth();
  const { meta, seats } = useRoom(roomId);
  usePresence(roomId);

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => { const id = setTimeout(() => setTimedOut(true), TIMING.roomNotFoundMs); return () => clearTimeout(id); }, []);

  // Game started -> hand off to the full-screen game page.
  const started = !!meta && meta.phase !== 'lobby';
  useEffect(() => {
    if (started) router.replace(`/play?room=${roomId}`, { scroll: false });
  }, [started, roomId, router]);

  const close = () => router.replace('/', { scroll: false });

  let body: React.ReactNode;
  if (!ready) {
    body = <p className="py-6 text-center text-sm text-muted-foreground">{t.common.loading}</p>;
  } else if (!user) {
    body = (
      <div className="space-y-4 py-2 text-center">
        <p className="text-muted-foreground">{t.signInGate.subtitle}</p>
        <Button size="lg" onClick={() => { signInGoogle().catch(() => {}); }} className="w-full bg-lc-yellow text-lc-ink hover:bg-lc-yellow/90">
          {t.signInGate.cta}
        </Button>
      </div>
    );
  } else if (meta && meta.phase === 'lobby') {
    body = <LobbyPanel roomId={roomId} meta={meta} seats={seats} />;
  } else if (started) {
    body = <p className="py-6 text-center text-sm text-muted-foreground">{t.lobby.loadingRoom}</p>;
  } else if (timedOut) {
    body = <p className="py-6 text-center text-sm text-muted-foreground">{t.lobby.notFound}</p>;
  } else {
    body = <p className="py-6 text-center text-sm text-muted-foreground">{t.lobby.loadingRoom}</p>;
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">{t.lobby.title}</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
