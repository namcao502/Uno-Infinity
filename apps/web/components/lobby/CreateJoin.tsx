'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DEFAULT_CONFIG, type RuleConfig } from '@uno/engine';
import { useAuth } from '@/lib/auth';
import { callCreateRoom, callJoinRoom } from '@/lib/functions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DeckConfig } from './DeckConfig';

function errMsg(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? '';
  // Surface the real error for debugging; the UI still shows a friendly message.
  console.error('Room action failed:', code, err?.message, e);
  if (code.includes('unauthenticated')) return 'Please sign in to play.';
  if (code.includes('permission-denied')) return 'Sign in with Google to play.';
  if (code.includes('not-found')) return 'Room not found.';
  if (code.includes('failed-precondition')) return 'That game already started.';
  if (code.includes('resource-exhausted')) return 'Room is full.';
  if (code.includes('internal') || code.includes('unavailable'))
    return 'Cannot reach the game server. Please try again shortly.';
  return 'Something went wrong. Please try again.';
}

export function CreateJoin({ mode }: { mode: 'create' | 'join' }) {
  const router = useRouter();
  const { nickname, setNickname, ready } = useAuth();
  const [config, setConfig] = useState<RuleConfig>(DEFAULT_CONFIG);
  const [code, setCode] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true); setError('');
    try {
      const res = await callCreateRoom({ name: nickname || 'Player', config, isPublic });
      router.push(`/play?room=${res.data.roomId}`);
    } catch (e) { setError(errMsg(e)); setBusy(false); }
  };
  const join = async (role: 'player' | 'audience') => {
    setBusy(true); setError('');
    try {
      const res = await callJoinRoom({ code: code.trim().toUpperCase(), name: nickname || 'Player', role });
      router.push(`/play?room=${res.data.roomId}`);
    } catch (e) { setError(errMsg(e)); setBusy(false); }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-black">{mode === 'join' ? 'Join a room' : 'Create a room'}</h1>
      <div className="space-y-2">
        <Label htmlFor="nick">Your nickname</Label>
        <Input id="nick" value={nickname} onChange={(e) => setNickname(e.target.value.slice(0, 20))} placeholder="Player" maxLength={20} />
      </div>
      {mode === 'join' ? (
        <div className="space-y-3">
          <Label htmlFor="code">Room code</Label>
          <Input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))} placeholder="ABCD" className="uppercase tracking-widest" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !ready || code.trim().length < 4} onClick={() => join('player')}>Join as player</Button>
            <Button variant="outline" disabled={busy || !ready || code.trim().length < 4} onClick={() => join('audience')}>Watch as audience</Button>
          </div>
          <p className="text-sm text-muted-foreground">
            or <Link href="/play?browse=1" className="font-semibold text-foreground underline">browse open rooms</Link>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-bold">Deck &amp; rules</h2>
          <DeckConfig config={config} onChange={setConfig} disabled={busy} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublic} disabled={busy} onChange={(e) => setIsPublic(e.target.checked)} className="h-4 w-4 accent-[#f4c430]" />
            List this room publicly so anyone can find and join it
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button disabled={busy || !ready} onClick={create} className="bg-[#f4c430] text-[#1a1500] hover:bg-[#f4c430]/90">
            Create room
          </Button>
        </div>
      )}
    </div>
  );
}
