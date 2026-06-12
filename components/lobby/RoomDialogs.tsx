'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n/context';
import { CreateJoin } from './CreateJoin';
import { RoomBrowser } from './RoomBrowser';
import { LobbyDialog } from './LobbyDialog';
import { RulesDialog } from '@/components/marketing/RulesDialog';

type DialogKind = 'create' | 'browse' | 'join';

/**
 * Renders the create / browse / join flows as popups on the current page, driven by the URL query
 * (`?create` / `?browse` / `?join`) so deep links and the Back button keep working. Creating/joining
 * pushes `/?room=...`, which opens the lobby popup (LobbyDialog); only the live game is a full page.
 */
export function RoomDialogs() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, ready, signInGoogle } = useAuth();
  const t = useT();

  const kind: DialogKind | null =
    params.has('create') ? 'create' : params.has('browse') ? 'browse' : params.has('join') ? 'join' : null;

  // Clear the param without adding history, so Back doesn't re-open the dialog.
  const close = () => router.replace('/', { scroll: false });

  const title =
    kind === 'browse' ? t.browser.title : kind === 'join' ? t.createJoin.joinTitle : t.createJoin.createTitle;
  const width = kind === 'join' ? 'sm:max-w-md' : 'sm:max-w-2xl';

  return (
    <>
      <Dialog open={kind !== null} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className={`${width} max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle className="text-2xl font-black">{title}</DialogTitle>
          </DialogHeader>
          {!ready ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t.common.loading}</p>
          ) : !user ? (
            <div className="space-y-4 py-2 text-center">
              <p className="text-muted-foreground">{t.signInGate.subtitle}</p>
              <Button
                size="lg"
                onClick={() => { signInGoogle().catch(() => {}); }}
                className="w-full bg-lc-yellow text-lc-ink hover:bg-lc-yellow/90"
              >
                {t.signInGate.cta}
              </Button>
            </div>
          ) : kind === 'browse' ? (
            <RoomBrowser embedded />
          ) : kind === 'join' ? (
            <CreateJoin mode="join" embedded />
          ) : (
            <CreateJoin mode="create" embedded />
          )}
        </DialogContent>
      </Dialog>
      {/* Lobby waiting room popup (?room=CODE), independent of the create/join/browse dialog. */}
      <LobbyDialog />
      {/* House Rules reference popup (?rules). */}
      <RulesDialog />
    </>
  );
}
