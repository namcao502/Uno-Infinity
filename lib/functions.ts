'use client';
import { httpsCallable, type HttpsCallableResult } from 'firebase/functions';
import { functions } from './firebase/functions';
import { withLoading } from './loading/loading-store';
import type { Move, RuleConfig } from '@last-card/engine';

// Wrap a callable so it drives the global loading overlay. Use for navigation/transition
// actions where the user clicks and then waits (room create/join, start, leave) - NOT for
// frequent in-game calls (submitMove, forceTimeout, pause/resume), which would flash the
// overlay on every move and already have local busy feedback.
function navCallable<Req, Res>(name: string): (data: Req) => Promise<HttpsCallableResult<Res>> {
  const fn = httpsCallable<Req, Res>(functions, name);
  return (data: Req) => withLoading(() => fn(data));
}

export const callCreateRoom = navCallable<{ name: string; config: RuleConfig; isPublic: boolean }, { roomId: string; code: string }>('createRoom');
export const callJoinRoom   = navCallable<{ code: string; name: string; role: 'player' | 'audience' }, { roomId: string }>('joinRoom');
export const callAddBot     = navCallable<{ roomId: string }, { botId: string }>('addBot');
export const callRemoveBot  = navCallable<{ roomId: string; botId: string }, { ok: boolean }>('removeBot');
export const callLeaveRoom  = navCallable<{ roomId: string }, { ok: boolean }>('leaveRoom');
export const callDeleteRoom = navCallable<{ roomId: string }, { ok: boolean }>('deleteRoom');
export const callReturnToLobby = navCallable<{ roomId: string }, { ok: boolean }>('returnToLobby');
export const callStartGame  = navCallable<{ roomId: string }, { ok: boolean }>('startGame');

export const callBecomeAudience = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'becomeAudience');
export const callPauseGame  = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'pauseGame');
export const callResumeGame = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'resumeGame');
export const callSubmitMove = httpsCallable<{ roomId: string; move: Move }, { ok: boolean }>(functions, 'submitMove');
export const callForceTimeout = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'forceTimeout');
