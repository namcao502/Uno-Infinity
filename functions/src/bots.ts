import { onValueWritten } from 'firebase-functions/v2/database';
import { botChooseMove, isMoveLegal, applyMove, skipTurn, forfeit, type GameState } from '@uno/engine';
import { db } from './firebase.js';
import { applyAuthoritative } from './game.js';

const ACTIONABLE = ['playing', 'duel', 'bombResponse'];
const DISCONNECT_MS = 30000; // grace to reconnect before being moved to the audience

/** The id of the player who must act now, accounting for duel / bomb sub-phases. */
function activeIdOf(s: GameState): string | undefined {
  return s.phase === 'bombResponse' && s.bombResponse ? s.bombResponse.pending[0]
    : s.phase === 'duel' && s.duel ? s.duel.activeId
    : s.players[s.turnIndex]?.id;
}

/**
 * Fires whenever the active turn changes. Bots play after a short delay.
 * Online humans are left to the client-enforced turn timer (forceTimeout).
 * Offline humans are skipped (no draw) while within their reconnect window, and
 * moved to the audience once they have been gone for 30s. All paths run through
 * the same transactional applyAuthoritative as human moves.
 */
export const driveBots = onValueWritten('rooms/{roomId}/public/turnId', async (event) => {
  const roomId = event.params.roomId;
  const turnId = event.data.after.val() as string | null;
  if (!turnId) return;

  const phase = (await db.ref(`rooms/${roomId}/meta/phase`).get()).val();
  if (!ACTIONABLE.includes(phase)) return;

  const seat = (await db.ref(`rooms/${roomId}/seats/${turnId}`).get()).val();

  // --- Bot: play after a short pacing delay -------------------------------
  if (seat?.isBot === true) {
    await new Promise((r) => setTimeout(r, 900));
    await applyAuthoritative(roomId, (state) => {
      if (!ACTIONABLE.includes(state.phase) || activeIdOf(state) !== turnId) return undefined;
      const move = botChooseMove(state, turnId);
      return isMoveLegal(state, move).ok ? applyMove(state, move) : undefined;
    });
    return;
  }

  // --- Human: the server only acts when they are OFFLINE ------------------
  const presenceRef = db.ref(`rooms/${roomId}/presence/${turnId}`);
  if ((await presenceRef.get()).val()?.online !== false) return; // online -> client handles it

  await new Promise((r) => setTimeout(r, 2000)); // grace for brief blips / disconnect on own turn
  const presence = (await presenceRef.get()).val();
  if (presence?.online !== false) return;        // reconnected during the grace

  const offlineMs = Date.now() - (presence?.lastSeen ?? Date.now());
  await applyAuthoritative(roomId, (state) => {
    if (!ACTIONABLE.includes(state.phase) || activeIdOf(state) !== turnId) return undefined;
    return offlineMs >= DISCONNECT_MS ? forfeit(state, turnId) : skipTurn(state);
  });
});
