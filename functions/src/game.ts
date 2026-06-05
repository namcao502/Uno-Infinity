import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  createGame, applyMove, isMoveLegal, redactFor, nextRoundWith, topCard,
  type GameState, type Move,
} from '@uno/engine';
import { db } from './firebase.js';
import { requireHuman } from './auth.js';
import { normalize, sanitize } from './serde.js';

// --- Projection to /rooms (redacted, client-readable) -----------------------

/** Phases in which a player must act, and therefore the turn timer runs. */
const ACTIONABLE_PHASES = ['playing', 'duel', 'bombResponse'];
/** Seconds a player has to act before the safe default (draw) is forced. */
export const TURN_MS = 10000;

/** Room-scoped projection (meta/phase, public, seats/*). Hands are written separately. */
function projection(state: GameState): Record<string, unknown> {
  const pub = redactFor(state, null);
  const updates: Record<string, unknown> = {
    'meta/phase': state.phase,
    public: {
      discardTop: pub.discardTop, currentColor: pub.currentColor, colorLocked: pub.colorLocked,
      turnId: pub.turnId, direction: pub.direction, pending: pub.pending, duel: pub.duel,
      bombResponse: pub.bombResponse, goAgain: pub.goAgain, drawCount: pub.drawCount,
      winnerId: pub.winnerId, log: pub.log,
      // Fresh 10s deadline after every committed action; cleared outside actionable phases.
      turnDeadline: ACTIONABLE_PHASES.includes(state.phase) ? Date.now() + TURN_MS : null,
    },
  };
  for (const p of state.players) {
    updates[`seats/${p.id}/handCount`] = p.hand.length;
    updates[`seats/${p.id}/status`] = p.status;
    updates[`seats/${p.id}/score`] = p.score;
    updates[`seats/${p.id}/turn`] = pub.turnId === p.id;
  }
  return updates;
}

/** Per-human hand writes for the SEPARATE /hands/{roomId} path (never under /rooms). */
function handUpdates(state: GameState): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  for (const p of state.players) if (!p.isBot) u[p.id] = { cards: p.hand };
  return u;
}

async function project(roomId: string, state: GameState): Promise<void> {
  await db.ref(`rooms/${roomId}`).update(sanitize(projection(state)));
  await db.ref(`hands/${roomId}`).update(sanitize(handUpdates(state)));
  // Drop a finished game from the browse index (no-op for private rooms / absent entry).
  if (state.phase === 'gameOver') await db.ref(`lobbies/${roomId}`).remove();
}

/**
 * Atomic read-modify-write of authoritative state at /secure/{roomId}.
 * `transform` returns the next state, or `undefined` to abort (illegal move, or
 * the turn already moved on). The RTDB transaction serializes concurrent
 * submitMove/driveBots calls so a move can never be dropped or duplicated.
 * Returns the committed state, or null if aborted / game absent.
 *
 * Null-handling (firebase-admin transaction contract): a pre-read makes the
 * absent-game case explicit (return null, no transaction). Inside the transaction
 * a `null` can still appear as a STALE first invocation before the server value
 * loads; we must NOT return `undefined` there - that would abort before the SDK
 * fetches real data (the no-retry footgun). Returning `null` lets the optimistic
 * version guard reject the stale write and re-run the handler with the real state.
 * A genuine abort happens only once `current` is non-null, where `undefined`
 * aborts with NO write (so illegal moves cost nothing).
 */
async function applyAuthoritative(
  roomId: string,
  transform: (state: GameState) => GameState | undefined,
): Promise<GameState | null> {
  const ref = db.ref(`secure/${roomId}`);
  if (!(await ref.get()).exists()) return null;        // game absent: handled deterministically, no transaction
  const res = await ref.transaction((current) => {
    if (current == null) return null;                  // stale first invocation -> let the SDK retry with server data
    const next = transform(normalize(current));
    if (next === undefined) return undefined;          // real data loaded, legit abort -> no write
    return sanitize(next);
  });
  if (!res.committed || !res.snapshot.exists()) return null;
  const final = normalize(res.snapshot.val());
  await project(roomId, final);
  return final;
}

export const startGame = onCall(async (req) => {
  const uid = requireHuman(req.auth);
  const roomId = String(req.data?.roomId ?? '');
  const metaSnap = await db.ref(`rooms/${roomId}/meta`).get();
  if (!metaSnap.exists()) throw new HttpsError('not-found', 'Room not found');
  const meta = metaSnap.val();
  if (meta.hostId !== uid) throw new HttpsError('permission-denied', 'Only the host may start');
  if (meta.phase !== 'lobby') throw new HttpsError('failed-precondition', 'Game already started'); // no re-deal mid-game

  const seats = (await db.ref(`rooms/${roomId}/seats`).get()).val() ?? {};
  const ordered = Object.entries(seats)
    .map(([id, v]) => ({ id, ...(v as { name: string; isBot: boolean; seatIndex: number; isAudience?: boolean }) }))
    .filter((s) => !s.isAudience) // spectators are not dealt in
    .sort((a, b) => a.seatIndex - b.seatIndex);
  if (ordered.length < 2) throw new HttpsError('failed-precondition', 'Need at least 2 players');

  const state = createGame(
    ordered.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })),
    meta.config, `${roomId}:${Date.now()}`);

  await db.ref(`secure/${roomId}`).set(sanitize(state));
  await project(roomId, state); // writes /rooms projection + /hands/{roomId}

  // Seed presence so driveBots always has a definite value for every human seat.
  const presenceSeed: Record<string, unknown> = {};
  for (const s of ordered) if (!s.isBot) presenceSeed[`presence/${s.id}`] = { online: true, lastSeen: Date.now() };
  await db.ref(`rooms/${roomId}`).update(presenceSeed);
  // Keep the room in the browse index but mark it in-progress (mid-game join is allowed).
  if (meta.isPublic) await db.ref(`lobbies/${roomId}/phase`).set('playing');
  return { ok: true };
});

export const submitMove = onCall(async (req) => {
  const uid = requireHuman(req.auth);
  const roomId = String(req.data?.roomId ?? '');
  const move = req.data?.move as Move;
  if (!move || move.playerId !== uid) throw new HttpsError('permission-denied', 'You may only move for yourself');

  let reason = 'Move rejected';
  let eyeTarget: string | null = null;                     // set when an Eye is played
  const result = await applyAuthoritative(roomId, (state) => {
    const legal = isMoveLegal(state, move);
    if (!legal.ok) { reason = legal.reason; return undefined; }
    if (move.type === 'play') {
      const me = state.players.find(p => p.id === move.playerId)!;
      const lead = move.cardIds.map(id => me.hand.find(c => c.id === id)).find(Boolean);
      // Direct Eye, or a recycle copying an Eye on top.
      const revealsHand = lead?.kind === 'eye' || (lead?.kind === 'recycle' && topCard(state).kind === 'eye');
      eyeTarget = revealsHand ? (move.targetId ?? null) : null;
    }
    return applyMove(state, move);
  });
  if (!result) throw new HttpsError('failed-precondition', reason);

  // Eye reveal (RD15): deliver the target's hand ONLY to the peeker, via an owner-only,
  // short-lived node - never through a game-readable path. The client reads and clears it.
  if (eyeTarget) {
    const t = result.players.find(p => p.id === eyeTarget);
    if (t) await db.ref(`peek/${roomId}/${uid}`).set(sanitize({ targetId: eyeTarget, cards: t.hand, ts: Date.now() }));
  }
  return { ok: true };
});

export const nextRound = onCall(async (req) => {
  requireHuman(req.auth);
  const roomId = String(req.data?.roomId ?? '');
  // Reseat the next round from the room's CURRENT non-audience seats, so players
  // who left are dropped, spectators stay out, and mid-game joiners carry over.
  const seats = (await db.ref(`rooms/${roomId}/seats`).get()).val() ?? {};
  const seeds = Object.entries(seats)
    .map(([id, v]) => ({ id, ...(v as { name: string; isBot: boolean; isAudience?: boolean }) }))
    .filter((s) => !s.isAudience)
    .map((s) => ({ id: s.id, name: s.name, isBot: s.isBot }));
  let reason = 'Round not over';
  const result = await applyAuthoritative(roomId, (state) => {
    if (state.phase !== 'roundEnd') { reason = 'Round not over'; return undefined; }
    return nextRoundWith(state, seeds);
  });
  if (!result) throw new HttpsError('failed-precondition', reason);
  return { ok: true };
});

/**
 * Enforce the turn timer for an ONLINE player: when the deadline has passed,
 * any connected client may call this and the server forces the safe default
 * (draw) for whoever is on turn. Idempotent - re-validates the deadline and the
 * active player, so duplicate/late calls simply no-op. (Offline players are
 * handled by the driveBots turn driver, not here.)
 */
export const forceTimeout = onCall(async (req) => {
  requireHuman(req.auth);
  const roomId = String(req.data?.roomId ?? '');
  const pub = (await db.ref(`rooms/${roomId}/public`).get()).val() as
    { turnId?: string; turnDeadline?: number | null } | null;
  if (!pub?.turnId || !pub.turnDeadline || Date.now() < pub.turnDeadline) return { ok: false };

  const expected = pub.turnId;
  const result = await applyAuthoritative(roomId, (state) => {
    const activeId = state.phase === 'bombResponse' && state.bombResponse ? state.bombResponse.pending[0]
      : state.phase === 'duel' && state.duel ? state.duel.activeId
      : state.players[state.turnIndex]?.id;
    if (!['playing', 'duel', 'bombResponse'].includes(state.phase) || activeId !== expected) return undefined;
    const move: Move = { type: 'draw', playerId: activeId };
    if (!isMoveLegal(state, move).ok) return undefined;
    return applyMove(state, move);
  });
  return { ok: result !== null };
});

export { applyAuthoritative, project };
