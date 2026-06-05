import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { ruleConfigSchema, deckTotal, seatPlayer, forfeit, DEFAULT_CONFIG, type RuleConfig } from '@uno/engine';
import { db } from './firebase.js';
import { requireHuman } from './auth.js';
import { applyAuthoritative } from './game.js';

const LIVE_PHASES = ['playing', 'duel', 'bombResponse'];

function genCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

type SeatMap = Record<string, { isAudience?: boolean; seatIndex?: number; status?: string; score?: number; handCount?: number }>;

/** Count only active-eligible (non-audience) seats - the figure capped by maxPlayers. */
function playerSeatCount(seats: SeatMap): number {
  return Object.values(seats).filter((s) => !s.isAudience).length;
}

/**
 * Keep the public `lobbies/{code}` browse index in sync with a room. The room
 * stays listed through the game (so spectators / mid-game joiners can find it);
 * the entry is removed only when the room is private, empty, or finished.
 * Refreshes the live player count and phase. roomId === code.
 */
async function syncLobby(roomId: string): Promise<void> {
  const meta = (await db.ref(`rooms/${roomId}/meta`).get()).val();
  const seats = ((await db.ref(`rooms/${roomId}/seats`).get()).val() ?? {}) as SeatMap;
  const players = playerSeatCount(seats);
  if (!meta || !meta.isPublic || players === 0 || meta.phase === 'gameOver') {
    await db.ref(`lobbies/${roomId}`).remove();
    return;
  }
  await db.ref(`lobbies/${roomId}`).update({ players, phase: meta.phase });
}

/**
 * Atomically claim the next monotonic seat index from meta/seatCounter.
 * Monotonic (never reused after a leave), so seatIndex and bot ids never collide.
 */
async function claimSeatIndex(roomId: string): Promise<number> {
  const res = await db.ref(`rooms/${roomId}/meta/seatCounter`).transaction((c) => ((c as number) ?? 0) + 1);
  return (res.snapshot.val() as number) - 1;
}

/**
 * Consume one "player stint" for a user. A user may be an active player in a
 * room at most twice (initial entry + one comeback). Survives leaves because it
 * lives under participants/, which leaveRoom does not delete.
 */
async function claimPlayerEntry(roomId: string, uid: string): Promise<void> {
  const res = await db.ref(`rooms/${roomId}/participants/${uid}/playerEntries`).transaction((c) => {
    const n = (c as number) ?? 0;
    return n >= 2 ? undefined : n + 1; // undefined aborts -> limit reached
  });
  if (!res.committed) throw new HttpsError('failed-precondition', 'Re-join limit reached');
}

export const createRoom = onCall(async (req) => {
  const uid = requireHuman(req.auth);
  const name = String(req.data?.name ?? 'Player').slice(0, 20);
  const isPublic = req.data?.isPublic !== false; // default public; only an explicit false makes it private
  const parsed = ruleConfigSchema.safeParse(req.data?.config);
  const config: RuleConfig = parsed.success ? parsed.data : DEFAULT_CONFIG;

  // The code IS the roomId. Claim it atomically (init meta only if the node is null)
  // so two concurrent creates can never clobber each other (no check-then-set race).
  let code = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    code = genCode();
    const res = await db.ref(`rooms/${code}/meta`).transaction((m) =>
      m === null
        // seatCounter starts at 1: the host occupies seat index 0.
        ? { code, hostId: uid, phase: 'lobby', maxPlayers: config.maxPlayers, createdAt: Date.now(), config, seatCounter: 1, isPublic }
        : undefined, // code taken -> abort, try another
    );
    if (res.committed) break;
    code = '';
  }
  if (!code) throw new HttpsError('resource-exhausted', 'Could not allocate a room code');
  const roomId = code;

  await db.ref(`rooms/${roomId}`).update({
    [`members/${uid}`]: true,
    [`participants/${uid}`]: { playerEntries: 1 }, // host's initial stint
    [`seats/${uid}`]: { name, isBot: false, seatIndex: 0, isAudience: false, connected: true, handCount: 0, status: 'active', score: 0, turn: false },
  });

  // Publish to the browse index (non-sensitive fields only).
  if (isPublic) {
    await db.ref(`lobbies/${roomId}`).set({
      code, hostName: name, players: 1, maxPlayers: config.maxPlayers, phase: 'lobby',
      createdAt: Date.now(), deckTotal: deckTotal(config.deck), startingHandSize: config.startingHandSize,
    });
  }
  return { roomId, code };
});

export const joinRoom = onCall(async (req) => {
  const uid = requireHuman(req.auth);
  const code = String(req.data?.code ?? '').toUpperCase();
  const name = String(req.data?.name ?? 'Player').slice(0, 20);
  const role: 'player' | 'audience' = req.data?.role === 'audience' ? 'audience' : 'player';
  const roomId = code;

  const meta = (await db.ref(`rooms/${roomId}/meta`).get()).val();
  if (!meta) throw new HttpsError('not-found', 'Room not found');

  const seats = ((await db.ref(`rooms/${roomId}/seats`).get()).val() ?? {}) as SeatMap;
  const existing = seats[uid];
  const live = LIVE_PHASES.includes(meta.phase);

  // --- Audience: spectate, any phase, uncapped, no engine involvement --------
  if (role === 'audience') {
    const seatIndex = existing?.seatIndex ?? await claimSeatIndex(roomId);
    await db.ref(`rooms/${roomId}`).update({
      [`members/${uid}`]: true,
      [`seats/${uid}`]: { name, isBot: false, seatIndex, isAudience: true, connected: true, handCount: 0, status: 'out', score: existing?.score ?? 0, turn: false },
    });
    await db.ref(`hands/${roomId}/${uid}`).remove();
    await syncLobby(roomId);
    return { roomId };
  }

  // --- Player ----------------------------------------------------------------
  if (existing && !existing.isAudience && existing.status === 'active') return { roomId }; // already in play
  if (!existing || existing.isAudience) {
    if (playerSeatCount(seats) >= meta.maxPlayers) throw new HttpsError('resource-exhausted', 'Room is full');
  }
  await claimPlayerEntry(roomId, uid); // one-comeback cap (throws if exhausted)

  const seatIndex = existing?.seatIndex ?? await claimSeatIndex(roomId);
  // Write seat metadata first; if the game is live, the engine add/reactivate
  // then projects the correct hand count / status / turn over the top.
  await db.ref(`rooms/${roomId}`).update({
    [`members/${uid}`]: true,
    [`seats/${uid}`]: { name, isBot: false, seatIndex, isAudience: false, connected: true, handCount: 0, status: 'active', score: existing?.score ?? 0, turn: false },
  });
  if (live) await applyAuthoritative(roomId, (s) => seatPlayer(s, { id: uid, name, isBot: false }));
  await syncLobby(roomId);
  return { roomId };
});

export const addBot = onCall(async (req) => {
  const uid = requireHuman(req.auth);
  const roomId = String(req.data?.roomId ?? '');
  const metaSnap = await db.ref(`rooms/${roomId}/meta`).get();
  if (!metaSnap.exists()) throw new HttpsError('not-found', 'Room not found');
  if (metaSnap.val().hostId !== uid) throw new HttpsError('permission-denied', 'Only the host may add bots');
  if (metaSnap.val().phase !== 'lobby') throw new HttpsError('failed-precondition', 'Game already started');

  const seats = ((await db.ref(`rooms/${roomId}/seats`).get()).val() ?? {}) as SeatMap;
  if (playerSeatCount(seats) >= metaSnap.val().maxPlayers) throw new HttpsError('resource-exhausted', 'Room is full');

  const seatIndex = await claimSeatIndex(roomId);
  const botId = `bot_${seatIndex}`; // seatIndex is monotonic, so the id is unique
  const botNames = ['Aria', 'Rex', 'Mia', 'Leo', 'Zoe', 'Max', 'Ivy', 'Sam'];
  await db.ref(`rooms/${roomId}/seats/${botId}`).set({
    name: `Bot ${botNames[seatIndex % botNames.length]}`, isBot: true, seatIndex, isAudience: false,
    connected: true, handCount: 0, status: 'active', score: 0, turn: false,
  });
  await syncLobby(roomId);
  return { botId };
});

/** Stop playing but stay in the room as a spectator. */
export const becomeAudience = onCall(async (req) => {
  const uid = requireHuman(req.auth);
  const roomId = String(req.data?.roomId ?? '');
  const meta = (await db.ref(`rooms/${roomId}/meta`).get()).val();
  if (!meta) throw new HttpsError('not-found', 'Room not found');
  const seat = (await db.ref(`rooms/${roomId}/seats/${uid}`).get()).val();
  if (!seat) throw new HttpsError('not-found', 'You are not in this room');

  // If actively playing, forfeit out of the live game first so the turn moves on.
  if (LIVE_PHASES.includes(meta.phase) && seat.status === 'active' && !seat.isAudience) {
    await applyAuthoritative(roomId, (s) => forfeit(s, uid));
  }
  await db.ref(`rooms/${roomId}/seats/${uid}`).update({ isAudience: true, status: 'out', turn: false });
  await db.ref(`hands/${roomId}/${uid}`).remove();
  await syncLobby(roomId);
  return { ok: true };
});

export const leaveRoom = onCall(async (req) => {
  const uid = requireHuman(req.auth);
  const roomId = String(req.data?.roomId ?? '');
  const meta = (await db.ref(`rooms/${roomId}/meta`).get()).val();
  const seat = (await db.ref(`rooms/${roomId}/seats/${uid}`).get()).val();

  // Forfeit out of a live game so play continues for everyone else.
  if (meta && seat && !seat.isAudience && seat.status === 'active' && LIVE_PHASES.includes(meta.phase)) {
    await applyAuthoritative(roomId, (s) => forfeit(s, uid));
  }
  await db.ref(`rooms/${roomId}/members/${uid}`).remove();
  await db.ref(`rooms/${roomId}/seats/${uid}`).remove();
  await db.ref(`rooms/${roomId}/presence/${uid}`).remove();
  await db.ref(`hands/${roomId}/${uid}`).remove();
  // participants/{uid} is intentionally KEPT so the one-comeback cap survives a leave.
  await syncLobby(roomId);
  return { ok: true };
});
