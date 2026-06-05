'use client';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { Move, RuleConfig } from '@uno/engine';

export const callCreateRoom = httpsCallable<{ name: string; config: RuleConfig; isPublic: boolean }, { roomId: string; code: string }>(functions, 'createRoom');
export const callJoinRoom   = httpsCallable<{ code: string; name: string; role: 'player' | 'audience' }, { roomId: string }>(functions, 'joinRoom');
export const callAddBot     = httpsCallable<{ roomId: string }, { botId: string }>(functions, 'addBot');
export const callLeaveRoom  = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'leaveRoom');
export const callBecomeAudience = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'becomeAudience');
export const callStartGame  = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'startGame');
export const callSubmitMove = httpsCallable<{ roomId: string; move: Move }, { ok: boolean }>(functions, 'submitMove');
export const callNextRound  = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'nextRound');
export const callForceTimeout = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'forceTimeout');
