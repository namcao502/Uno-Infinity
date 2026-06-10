# Last Card

Real-time, server-authoritative multiplayer **Last Card** - an expanded card game with extended
draw math, multi-card plays, targeted/special cards, a 1v1 duel sub-mode, and a counterable bomb.

## Architecture

```
packages/engine   Pure TypeScript rule engine - the single source of truth (no I/O, fully unit-tested).
                  Consumed AS SOURCE by both the web app and Cloud Functions.
functions         Cloud Functions (Admin SDK) - authoritative. Validate every move, deal cards, do all
                  randomness (steal) and the Eye reveal against secret state clients cannot read.
                  Bundled with esbuild (engine inlined) -> functions/lib/index.js.
app, components,  Next.js (App Router) client at the repo root - marketing pages, lobby + deck
lib, public       config, game table, chat.
database.rules.json  RTDB security rules. apphosting.yaml  App Hosting config.
```

**Trust boundary:** clients only read `/rooms/*` and call callables; they never write game state.
`/secure/{roomId}` is server-only. Hands live at top-level `/hands/{roomId}/{uid}` (owner-only read -
RTDB read rules cascade, so hands cannot be nested under the member-readable room). Every move is
re-validated server-side inside an RTDB transaction (`applyAuthoritative`).

## Local development

```
npm install
npm run test:engine            # engine unit tests (101)

# In one shell - emulators (requires Java):
npx firebase emulators:start --only functions,database,auth

# In another shell - the web app pointed at the emulators:
#   create .env.local from .env.local.example
NEXT_PUBLIC_USE_EMULATORS=true npm run dev
```

`next build` / `next dev` need the five `NEXT_PUBLIC_FIREBASE_*` vars (the client initializes Firebase at
import). For a real project, fill `.env.local`; for deploy, `apphosting.yaml`.

## Customizing the deck / rules

Last Card is THE ruleset; what you tune is the **deck composition** (per-card counts) plus a few
settings, all in `RuleConfig` (`packages/engine/src/config.ts`). The lobby's Deck Config screen edits
these (see `lib/config-fields.ts`). The resolved rules are documented in
`docs/last-card-design.md` (RD1-RD20); the source ruleset is `docs/last-card-rules.md`.

### Adding a new card kind

1. Add it to `CardKind` and `DeckCounts` (+ `DEFAULT_DECK`, `deckTotal`) in `packages/engine/src/cards.ts` / `config.ts`.
2. Teach `classifySet` (if it changes multi-card rules), `isMoveLegal`, and `applyEffect` (`rules.ts` / `moves.ts`).
3. Add a `CONFIG_FIELDS` entry (`lib/config-fields.ts`) and render it in `GameCard`.
4. Write engine tests first (TDD) and keep `npm run test:engine` green.

## Tests

| Suite | Command |
|-------|---------|
| Engine (pure) | `npm run test:engine` |
| Functions serde | `npx vitest run --root functions test/serde.test.ts` |
| RTDB rules (needs Java emulator) | `npx firebase emulators:exec --only database "npx vitest run --root functions test/rules.test.ts"` |

See `docs/DEPLOY.md` for deployment.
