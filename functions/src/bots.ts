import { onValueWritten } from 'firebase-functions/v2/database';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { botChooseMove, isMoveLegal, applyMove, skipTurn, forfeit, type GameState } from '@last-card/engine';
import { db } from './firebase.js';
import { requireHuman } from './auth.js';
import { applyAuthoritative, TURN_MS } from './game.js';

const ACTIONABLE = ['playing', 'duel', 'bombResponse'];
const DISCONNECT_MS = 30000; // grace to reconnect before being moved to the audience

/** The id of the player who must act now, accounting for duel / bomb sub-phases. */
function activeIdOf(s: GameState): string | undefined {
  return s.phase === 'bombResponse' && s.bombResponse ? s.bombResponse.pending[0]
    : s.phase === 'duel' && s.duel ? s.duel.activeId
    : s.players[s.turnIndex]?.id;
}

const isPaused = async (roomId: string): Promise<boolean> =>
  (await db.ref(`rooms/${roomId}/meta/paused`).get()).val() === true;

/**
 * Drive the player on turn once: bots play after a short delay; online humans are left to the
 * client-enforced turn timer (forceTimeout); offline humans are skipped (no draw) within their
 * reconnect window and moved to the audience after 30s. All paths run through the same
 * transactional applyAuthoritative as human moves. No-ops while the game is paused (re-checked
 * after each delay so an in-flight bot move / forfeit cannot land during a pause).
 */
export async function driveTurnOnce(roomId: string, turnId: string): Promise<void> {
  if (await isPaused(roomId)) return;
  const phase = (await db.ref(`rooms/${roomId}/meta/phase`).get()).val();
  if (!ACTIONABLE.includes(phase)) return;

  const seat = (await db.ref(`rooms/${roomId}/seats/${turnId}`).get()).val();

  // --- Bot: play after a short pacing delay -------------------------------
  // A bot can stay on turn after its own move - RD7 playAgain (no advance), or a skip in a
  // 2-player game that bounces back to the same seat. public/turnId is then unchanged, so the
  // turnId-change trigger never re-fires; we must drive the same bot again here or it freezes.
  // (redactFor computes public/turnId exactly like activeIdOf, so an unchanged activeId means an
  // unchanged turnId and no trigger.) Loop until the turn leaves this bot; cap as a safety net.
  if (seat?.isBot === true) {
    let actingId = turnId;
    for (let guard = 0; guard < 64; guard++) {
      await new Promise((r) => setTimeout(r, 900));
      if (await isPaused(roomId)) return;                  // host paused during the pacing delay
      const after = await applyAuthoritative(roomId, (state) => {
        if (!ACTIONABLE.includes(state.phase) || activeIdOf(state) !== actingId) return undefined;
        // If the AI ever picks an illegal move (e.g. a targeted card with no valid opponent),
        // fall back to the safe default (draw) so the bot can never freeze its own turn.
        let move = botChooseMove(state, actingId);
        if (!isMoveLegal(state, move).ok) move = { type: 'draw', playerId: actingId };
        return isMoveLegal(state, move).ok ? applyMove(state, move) : undefined;
      });
      if (!after) return;                                  // aborted (illegal / turn already moved) or game gone
      const nextId = activeIdOf(after);
      if (nextId !== actingId) return;                     // turn advanced -> the turnId trigger drives the next actor
      if (!ACTIONABLE.includes(after.phase)) return;       // game over / non-actionable phase
      if (after.players.find((p) => p.id === nextId)?.isBot !== true) return; // a human now holds the repeat turn
      actingId = nextId;                                   // same bot still on turn -> drive it again
    }
    return;
  }

  // --- Human: the server only acts when they are OFFLINE ------------------
  const presenceRef = db.ref(`rooms/${roomId}/presence/${turnId}`);
  if ((await presenceRef.get()).val()?.online !== false) return; // online -> client handles it

  await new Promise((r) => setTimeout(r, 2000)); // grace for brief blips / disconnect on own turn
  if (await isPaused(roomId)) return;            // host paused during the grace -> no skip / forfeit
  const presence = (await presenceRef.get()).val();
  if (presence?.online !== false) return;        // reconnected during the grace

  const offlineMs = Date.now() - (presence?.lastSeen ?? Date.now());
  await applyAuthoritative(roomId, (state) => {
    if (!ACTIONABLE.includes(state.phase) || activeIdOf(state) !== turnId) return undefined;
    return offlineMs >= DISCONNECT_MS ? forfeit(state, turnId) : skipTurn(state);
  });
}

/** Fires whenever the active turn changes. */
export const driveBots = onValueWritten('rooms/{roomId}/public/turnId', async (event) => {
  const turnId = event.data.after.val() as string | null;
  if (!turnId) return;
  await driveTurnOnce(event.params.roomId, turnId);
});

/** Host pauses the game: freeze the turn timer (clear the deadline) and stop all auto-driving. */
export const pauseGame = onCall(async (req) => {
  const uid = requireHuman(req.auth);
  const roomId = String(req.data?.roomId ?? '');
  const meta = (await db.ref(`rooms/${roomId}/meta`).get()).val();
  if (!meta) throw new HttpsError('not-found', 'Room not found');
  if (meta.hostId !== uid) throw new HttpsError('permission-denied', 'Only the host may pause');
  if (!ACTIONABLE.includes(meta.phase)) throw new HttpsError('failed-precondition', 'No game in progress');
  await db.ref(`rooms/${roomId}`).update({ 'meta/paused': true, 'public/turnDeadline': null });
  return { ok: true };
});

/** Host resumes: clear the flag, re-stamp a fresh deadline, and re-kick the current turn driver
 *  (driveBots only fires on a turnId change, so a bot / offline player on turn would otherwise stall). */
export const resumeGame = onCall(async (req) => {
  const uid = requireHuman(req.auth);
  const roomId = String(req.data?.roomId ?? '');
  const meta = (await db.ref(`rooms/${roomId}/meta`).get()).val();
  if (!meta) throw new HttpsError('not-found', 'Room not found');
  if (meta.hostId !== uid) throw new HttpsError('permission-denied', 'Only the host may resume');
  if (meta.paused !== true) return { ok: true };
  await db.ref(`rooms/${roomId}`).update({
    'meta/paused': false,
    'public/turnDeadline': ACTIONABLE.includes(meta.phase) ? Date.now() + TURN_MS : null,
  });
  const turnId = (await db.ref(`rooms/${roomId}/public/turnId`).get()).val() as string | null;
  if (turnId) await driveTurnOnce(roomId, turnId);
  return { ok: true };
});
