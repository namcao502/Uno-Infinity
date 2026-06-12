'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DEFAULT_CONFIG, type RuleConfig } from '@last-card/engine';
import { useAuth } from '@/lib/auth';
import { callCreateRoom, callJoinRoom } from '@/lib/functions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DeckConfig } from './DeckConfig';
import { LIMITS } from '@/lib/constants';
import { useT } from '@/lib/i18n/context';
import type { Dict } from '@/lib/i18n';

function errMsg(e: unknown, t: Dict): string {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? '';
  // Surface the real error for debugging; the UI still shows a friendly message.
  console.error('Room action failed:', code, err?.message, e);
  if (code.includes('unauthenticated')) return t.errors.signInRequired;
  if (code.includes('permission-denied')) return t.errors.googleRequired;
  if (code.includes('not-found')) return t.errors.roomNotFound;
  if (code.includes('failed-precondition')) return t.errors.alreadyStarted;
  if (code.includes('resource-exhausted')) return t.errors.roomFull;
  if (code.includes('internal') || code.includes('unavailable')) return t.errors.serverUnreachable;
  return t.errors.generic;
}

export function CreateJoin({ mode, embedded = false }: { mode: 'create' | 'join'; embedded?: boolean }) {
  const router = useRouter();
  const t = useT();
  const { nickname, setNickname, ready } = useAuth();
  const [config, setConfig] = useState<RuleConfig>(DEFAULT_CONFIG);
  const [code, setCode] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true); setError('');
    try {
      const res = await callCreateRoom({ name: nickname || t.createJoin.nicknamePlaceholder, config, isPublic });
      router.push(`/?room=${res.data.roomId}`);
    } catch (e) { setError(errMsg(e, t)); setBusy(false); }
  };
  const join = async (role: 'player' | 'audience') => {
    setBusy(true); setError('');
    try {
      const res = await callJoinRoom({ code: code.trim().toUpperCase(), name: nickname || t.createJoin.nicknamePlaceholder, role });
      router.push(`/?room=${res.data.roomId}`);
    } catch (e) { setError(errMsg(e, t)); setBusy(false); }
  };

  const codeReady = code.trim().length >= LIMITS.roomCodeLength;

  return (
    <div className={embedded ? 'space-y-6' : 'mx-auto w-full max-w-2xl space-y-6 px-6 py-10'}>
      {!embedded && <h1 className="text-2xl font-black">{mode === 'join' ? t.createJoin.joinTitle : t.createJoin.createTitle}</h1>}
      <div className="space-y-2">
        <Label htmlFor="nick">{t.createJoin.nicknameLabel}</Label>
        <Input id="nick" value={nickname} onChange={(e) => setNickname(e.target.value.slice(0, LIMITS.nicknameMax))} placeholder={t.createJoin.nicknamePlaceholder} maxLength={LIMITS.nicknameMax} />
      </div>
      {mode === 'join' ? (
        <div className="space-y-3">
          <Label htmlFor="code">{t.createJoin.roomCodeLabel}</Label>
          <Input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, LIMITS.roomCodeLength))} placeholder="ABCD" className="uppercase tracking-widest" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-col gap-2">
            <Button size="lg" disabled={busy || !ready || !codeReady} onClick={() => join('player')} className="w-full">{t.createJoin.joinAsPlayer}</Button>
            <Button size="lg" variant="outline" disabled={busy || !ready || !codeReady} onClick={() => join('audience')} className="w-full">{t.createJoin.watchAsAudience}</Button>
          </div>
          <Link href="/?browse" scroll={false} className={buttonVariants({ variant: 'ghost', size: 'lg' })}>{t.createJoin.browsePrompt}</Link>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-bold">{t.createJoin.deckTitle}</h2>
          <DeckConfig config={config} onChange={setConfig} disabled={busy} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublic} disabled={busy} onChange={(e) => setIsPublic(e.target.checked)} className="h-4 w-4 accent-lc-yellow" />
            {t.createJoin.publicToggle}
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button size="lg" variant="outline" disabled={busy || !ready} onClick={create} className="w-full">
            {t.createJoin.createRoom}
          </Button>
        </div>
      )}
    </div>
  );
}
