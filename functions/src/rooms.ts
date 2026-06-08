import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { ruleConfigSchema, deckTotal, seatPlayer, forfeit, DEFAULT_CONFIG, type RuleConfig } from '@last-card/engine';
import { db } from './firebase.js';
import { requireHuman } from './auth.js';
import { applyAuthoritative } from './game.js';

const LIVE_PHASES = ['playing', 'duel', 'bombResponse'];
const MAX_AUDIENCE = 10; // hard cap on spectators per room (players are capped separately by config.maxPlayers)

function genCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

type SeatMap = Record<string, { name?: string; isAudience?: boolean; isBot?: boolean; seatIndex?: number; status?: string; handCount?: number }>;

/** Count only active-eligible (non-audience) seats - the figure capped by maxPlayers. */
function playerSeatCount(seats: SeatMap): number {
  return Object.values(seats).filter((s) => !s.isAudience).length;
}

/** Count spectator seats - the figure capped by MAX_AUDIENCE. */
function audienceSeatCount(seats: SeatMap): number {
  return Object.values(seats).filter((s) => s.isAudience).length;
}

/**
 * Keep the public `lobbies/{code}` browse index in sync with a room. The room
 * stays listed through the game (so spectators / mid-game joiners can find it);
 * the entry is removed only when the room is private, empty, human-less, or finished.
 * Refreshes the live player count and phase. roomId === code.
 */
async function syncLobby(roomId: string): Promise<void> {
  const meta = (await db.ref(`rooms/${roomId}/meta`).get()).val();
  const seats = ((await db.ref(`rooms/${roomId}/seats`).get()).val() ?? {}) as SeatMap;
  const players = playerSeatCount(seats);
  // A room with only bots and no humans must never linger in the public browser.
  const hasHuman = Object.values(seats).some((s) => !s.isBot);
  if (!meta || !meta.isPublic || players === 0 || !hasHuman || meta.phase === 'gameOver') {
    await db.ref(`lobbies/${roomId}`).remove();
    return;
  }
  const hostSeat = seats[meta.hostId];
  await db.ref(`lobbies/${roomId}`).update({
    code: meta.code ?? roomId,
    hostName: hostSeat?.name ?? 'Host',
    players,
    maxPlayers: meta.maxPlayers,
    phase: meta.phase,
    createdAt: meta.createdAt ?? Date.now(),
    deckTotal: deckTotal(meta.config.deck),
    startingHandSize: meta.config.startingHandSize,
  });
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
    [`seats/${uid}`]: { name, isBot: false, seatIndex: 0, isAudience: false, connected: true, handCount: 0, status: 'active', turn: false },
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

  // --- Audience: spectate, any phase, capped at MAX_AUDIENCE, no engine involvement ---
  if (role === 'audience') {
    // A spectator already in the room may re-enter (idempotent); only a genuinely
    // new spectator is rejected once the room is full of watchers.
    if (!existing?.isAudience && audienceSeatCount(seats) >= MAX_AUDIENCE) {
      throw new HttpsError('resource-exhausted', 'Spectator limit reached');
    }
    const seatIndex = existing?.seatIndex ?? await claimSeatIndex(roomId);
    await db.ref(`rooms/${roomId}`).update({
      [`members/${uid}`]: true,
      [`seats/${uid}`]: { name, isBot: false, seatIndex, isAudience: true, connected: true, handCount: 0, status: 'out', turn: false },
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
    [`seats/${uid}`]: { name, isBot: false, seatIndex, isAudience: false, connected: true, handCount: 0, status: 'active', turn: false },
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
    connected: true, handCount: 0, status: 'active', turn: false,
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

export const returnToLobby = onCall(async (req) => {
  const uid = requireHuman(req.auth);
  const roomId = String(req.data?.roomId ?? '');
  const meta = (await db.ref(`rooms/${roomId}/meta`).get()).val();
  if (!meta) throw new HttpsError('not-found', 'Room not found');
  if (meta.phase !== 'gameOver') throw new HttpsError('failed-precondition', 'Game is not finished');
  const isMember = (await db.ref(`rooms/${roomId}/members/${uid}`).get()).exists();
  if (!isMember) throw new HttpsError('permission-denied', 'You are not in this room');

  const seats = ((await db.ref(`rooms/${roomId}/seats`).get()).val() ?? {}) as SeatMap;
  const updates: Record<string, unknown> = {
    'meta/phase': 'lobby',
    public: null,
  };
  for (const [id, seat] of Object.entries(seats)) {
    updates[`seats/${id}/handCount`] = 0;
    updates[`seats/${id}/turn`] = false;
    updates[`seats/${id}/status`] = seat.isAudience ? 'out' : 'active';
  }

  await Promise.all([
    db.ref(`rooms/${roomId}`).update(updates),
    db.ref(`secure/${roomId}`).remove(),
    db.ref(`hands/${roomId}`).remove(),
    db.ref(`peek/${roomId}`).remove(),
  ]);
  await syncLobby(roomId);
  return { ok: true };
});

export const leaveRoom = onCall(async (req) => {
  const uid = requireHuman(req.auth);
  const roomId = String(req.data?.roomId ?? '');
  const meta = (await db.ref(`rooms/${roomId}/meta`).get()).val();
  const seat = (await db.ref(`rooms/${roomId}/seats/${uid}`).get()).val();

  // members/ holds every human in the room (player or audience). If this user is
  // the last human, the room would be left with only bots - tear it down entirely
  // rather than leaving a human-less ghost room listed in the browser.
  const members = ((await db.ref(`rooms/${roomId}/members`).get()).val() ?? {}) as Record<string, boolean>;
  const humansRemain = Object.keys(members).some((id) => id !== uid);
  if (!humansRemain) {
    // Remove every path the room touches, incl. the admin-only authoritative
    // state at secure/ and any Eye-reveal peek nodes, so nothing is orphaned.
    await Promise.all([
      db.ref(`rooms/${roomId}`).remove(),
      db.ref(`hands/${roomId}`).remove(),
      db.ref(`secure/${roomId}`).remove(),
      db.ref(`peek/${roomId}`).remove(),
      db.ref(`lobbies/${roomId}`).remove(),
    ]);
    return { ok: true };
  }

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
