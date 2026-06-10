# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Real-time, **server-authoritative** multiplayer "Last Card" (an expanded UNO-like card game). A pure
TypeScript rule engine is the single source of truth, consumed **as source** by both the Next.js web
client and the Firebase Cloud Functions. Clients never write game state; every move is re-validated
server-side inside an RTDB transaction.

## Commands

```
npm install
npm run dev                    # Next.js client (needs the 5 NEXT_PUBLIC_FIREBASE_* vars; client inits Firebase at import)
npm run build                  # next build
npm run lint                   # eslint

# Tests
npm run test:engine            # pure engine unit tests (vitest run packages/engine)
npx vitest run packages/engine/src/moves.special.test.ts   # a single engine test file
npx vitest run --root functions test/serde.test.ts         # functions serde (no emulator)
npx firebase emulators:exec --only database "npx vitest run --root functions test/rules.test.ts"  # RTDB rules (needs Java)

# Local end-to-end against emulators (requires Java)
npx firebase emulators:start --only functions,database,auth
NEXT_PUBLIC_USE_EMULATORS=true npm run dev    # in a second shell

# Functions build (esbuild bundle; engine + zod inlined -> functions/lib/index.js)
npm --prefix functions run build
npm --prefix functions run typecheck
```

There is **no root `typecheck` script**. Typecheck the two TS projects separately:
`npx tsc --noEmit -p packages/engine` and `npm --prefix functions run typecheck`. The web app is
typechecked by `next build`.

## Architecture

```
packages/engine/   Pure TS rule engine. NO I/O, fully unit-tested. Deterministic (seeded RNG).
                   index.ts re-exports cards, config, types, rng, state, combos, rules, moves, bot, view.
functions/         Cloud Functions (firebase-admin). The ONLY writer of game state. esbuild bundles
                   the engine in -> functions/lib/index.js (symlinked workspace source does NOT survive
                   `firebase deploy`'s `npm ci`, so it must be inlined).
app/ components/   Next.js App Router client at the repo ROOT. Reads RTDB, calls callables; never writes
lib/ public/       game state. Engine is transpiled via next.config.ts `transpilePackages`.
database.rules.json  RTDB security rules.   apphosting.yaml  App Hosting config.
```

### The engine is shared source, not a built package

`@last-card/engine` `main`/`types` point at `./src/index.ts` (raw TS). The web app transpiles it
(`transpilePackages`); functions inline it with esbuild. There is no build step for the engine itself.
After deploy, sanity-check inlining: `npm --prefix functions run build` then confirm the bundle
references engine symbols (e.g. `buildDeck`) — a missing symbol means the engine was not inlined.

### Trust boundary and RTDB data layout

Clients only read `/rooms/*` and call callables. The authoritative `GameState` lives at
**`/secure/{roomId}`** (`.read`/`.write` both false — server-only). Reads are projected to:

| Path | Who reads | Notes |
|------|-----------|-------|
| `rooms/{roomId}/meta` `/seats` `/public` `/members` `/participants` | room members (read), server-only write | `public` is the redacted `PublicView` + `turnDeadline` |
| `hands/{roomId}/{uid}` | owner only | **Top-level, not nested under rooms** — RTDB read rules cascade, so a hand nested under a member-readable room would leak. Server-write only. |
| `peek/{roomId}/{uid}` | owner only | Eye-reveal (RD15): target's hand delivered only to the peeker, who reads then clears it. |
| `lobbies/{roomId}` | any signed-in user | Public browse index. Pruned when room is private/empty/human-less/finished. |
| `secure/{roomId}` | nobody (server only) | The real `GameState`. |

### Server move flow (functions/src/game.ts)

`applyAuthoritative(roomId, transform)` is the core: it runs `transform(state)` inside an RTDB
transaction on `/secure/{roomId}`, then `project()`s the result to `/rooms` + `/hands`. The transaction
serializes concurrent `submitMove`/`driveBots` calls. **Null-handling contract** (firebase-admin): a
pre-read handles the absent-game case; inside the transaction a stale first `null` invocation returns
`null` (let the SDK retry), and only a genuine abort (illegal move, turn moved on) returns `undefined`
(no write). Do not return `undefined` on the stale `null` — that aborts before real data loads.

`submitMove` validates `move.playerId === uid` and `!paused`, then calls `applyAuthoritative` with
`isMoveLegal` + `applyMove`. `forceTimeout` lets any online client force the safe default (draw) once
`public.turnDeadline` passes — idempotent.

### Bots & disconnect (functions/src/bots.ts)

`driveBots` is a DB trigger on `rooms/{roomId}/public/turnId` (fires on every turn change). Per turn:
bots play after a ~900ms delay; **online** humans are left to the client timer (`forceTimeout`);
**offline** humans are skipped (no draw) within a 30s reconnect grace, then forfeited to the audience.
All paths go through `applyAuthoritative`. `pauseGame`/`resumeGame` (host only) freeze/restamp the
deadline; `resumeGame` re-kicks the driver because `driveBots` only fires on a `turnId` change.

### Serde (functions/src/serde.ts) — important gotcha

RTDB stores arrays as keyed objects and drops empty ones. **Always** `normalize()` state read back
from RTDB (rebuilds dense `players`/`hand`/`drawPile`/`discardPile`/`log` arrays) and `sanitize()`
before writing (`JSON.parse(JSON.stringify(...))` strips `undefined`, which `.set`/`.transaction`
reject; nulls are preserved). The engine never sees RTDB shapes directly.

### Auth

`requireHuman(auth)` (functions/src/auth.ts) rejects unauthenticated and **anonymous** callers —
only non-anonymous (Google) users may act. Mirrored on the client (`SignInGate`).

### Engine module map (packages/engine/src)

- `cards.ts` — `Card`, `CardKind`, `CardColor`, `buildDeck`, `cardName`, `cardPoints`.
- `config.ts` — `RuleConfig` (zod), `DEFAULT_CONFIG`, `mergeConfig` (validates), `deckTotal`.
- `state.ts` — `GameState`, `PlayerState`, `LogEntry`, `createGame`, turn helpers (`nextActiveIndex`, `recycleTarget`).
- `combos.ts` — `classifySet`: validates multi-card plays (pair/run/pairsRun/x2/single).
- `rules.ts` — `isMoveLegal` (pure, exhaustive legality), `isPlayable`, `getPlayableCards`, `canStackDraw`.
- `moves.ts` — `applyMove` (immutable: always `clone()` first), effect resolution, draw stacks, duel/bomb sub-phases, `skipTurn`, `forfeit`, `seatPlayer`.
- `view.ts` — `redactFor(state, viewerId)` -> `PublicView` (what the server projects to clients).
- `bot.ts` — `botChooseMove` AI. `rng.ts` — seeded deterministic RNG.

`GameState.phase` is `playing | duel | bombResponse | gameOver`. The id of who must act depends on the
phase (bomb response queue / duel `activeId` / `turnIndex`) — there are repeated `activeIdOf`-style
helpers in game.ts, bots.ts, rules.ts, view.ts; keep them consistent if you touch turn logic.

## Game rules

Last Card is THE ruleset; what you tune is **deck composition** (per-card counts) + a few settings, all
in `RuleConfig`. The lobby Deck Config screen edits these (`lib/config-fields.ts`). Resolved rules are
documented as RD1–RD20 in `docs/last-card-design.md` (referenced throughout the engine, e.g. "RD19:
cannot finish on a black card"); the source ruleset is `docs/last-card-rules.md`.

### Adding a new card kind (TDD — keep `npm run test:engine` green)

1. Add to `CardKind` + `DeckCounts` (+ `DEFAULT_DECK`, `deckTotal`, `buildDeck`, `deckCountsSchema`) in `cards.ts` / `config.ts`.
2. Teach `classifySet` (if it changes multi-card rules), `isMoveLegal`, and `applyEffect` (`rules.ts` / `moves.ts`).
3. Add a `CONFIG_FIELDS` entry (`lib/config-fields.ts`) and render it in the game-card UI.
4. Write engine tests first.

## Gotchas

- **Region:** functions run in `asia-southeast1` — set in `functions/src/firebase.ts` `setGlobalOptions`
  (it must be there, not index.ts, because the function modules evaluate before index.ts's body) and
  must match `getFunctions(app, 'asia-southeast1')` in `lib/firebase.ts`. A mismatch makes every
  callable 404 silently.
- **Repo layout:** the Next.js app lives at the **repo root** (`app/`, `components/`, `lib/`), not in an
  `apps/web/` subdir. The dated plan docs under `docs/plans/` describe the original `apps/web` +
  `@uno/engine` monorepo design and are historical — trust the live code, not those snapshots, for paths.
- **Functions runtime is node 22**, kept consistent across `firebase.json` (`nodejs22`),
  `functions/package.json` (`engines.node`), and the esbuild `node22` target — keep all three aligned.
- Immutability is enforced by convention: `applyMove`/`skipTurn`/`forfeit`/`seatPlayer` all `clone()`
  the state first and return a new object. Never mutate the input `GameState`.
- The history `log` is capped (`LOG_MAX` in moves.ts) and uses `seq`/`stackId`/`detail` fields the UI
  relies on for grouping draw-stack chains and rendering indented consequence lines.
