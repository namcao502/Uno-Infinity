# UNO Infinity - Multiplayer Implementation Plan

> **For agentic workers:** Use s3-implement to execute this plan task-by-task.
> **Rule design of record:** `docs/UNO_infinity_design.md` (resolved rules RD1-RD18). Source: `docs/UNO_infinity_rules.md`.

**Goal:** Build a Next.js website hosting a real-time multiplayer **UNO Infinity** game (an expanded UNO variant with extended draw math, multi-card plays, targeted/special cards, and a 1v1 duel sub-mode), plus marketing pages, backed by Firebase (RTDB + Auth + Cloud Functions) with server-authoritative move validation and AI bots.

**Architecture:** A pure, framework-agnostic TypeScript rule engine (`packages/engine`) is the single source of truth for UNO Infinity logic and is shared by the Next.js client (advisory/optimistic hints) and Cloud Functions (authoritative). Cloud Functions validate every move, deal cards, and perform all randomness/reveals (steal, Eye peek) against secret state clients cannot read; RTDB security rules expose only a public projection plus each player's own hand (hands live at top-level `/hands/{roomId}/{uid}`). AI bots run server-side via an RTDB trigger. The Next.js App Router app (Tailwind + shadcn/ui) provides landing/marketing pages, a config (deck-composition) screen, room lobby, and the game table.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Tailwind CSS + shadcn/ui, Firebase (Realtime Database, Auth, Cloud Functions for Firebase v2), Firebase App Hosting, Zod (config validation), Vitest (engine + rules unit tests), `@firebase/rules-unit-testing` (security-rule tests), npm workspaces (monorepo).

---

## Repository layout

```
/
├── apps/web/                 # Next.js App Router app (Firebase App Hosting root)
│   ├── app/                  # routes
│   ├── components/           # UI components
│   ├── lib/                  # firebase client, hooks
│   └── ...
├── packages/engine/          # pure TS Uno rule engine (shared)
│   └── src/
├── functions/                # Cloud Functions (Admin SDK, authoritative)
│   └── src/
├── database.rules.json       # RTDB security rules
├── firebase.json
├── .firebaserc
├── apphosting.yaml
└── package.json              # npm workspaces root
```

## Canonical types (defined in Tasks 3-5, referenced everywhere)

These names/signatures are fixed; later tasks depend on them exactly. They mirror `docs/UNO_infinity_design.md`. All `value` fields are `number | null`, NEVER `undefined` (RTDB `.set()` rejects undefined).

```ts
// packages/engine/src/cards.ts
export type CardColor = 'red' | 'green' | 'blue' | 'yellow' | 'black'; // black = colorless / wild
export type CardKind =
  | 'number' | 'draw' | 'playAgain' | 'skip' | 'minus'          // colored kinds (draw also used by black)
  | 'mult' | 'div' | 'duel' | 'bomb' | 'reverseDraw' | 'recycle'
  | 'eye' | 'swap' | 'steal' | 'gift' | 'drawUntilColor' | 'shield' | 'counter' | 'wild'; // black kinds
export interface Card {
  id: string; color: CardColor; kind: CardKind;
  value: number | null; // number:0-9; draw:amount; reverseDraw:4|10; mult/div:2; else null
}

// packages/engine/src/config.ts  (Infinity config = deck composition + a few toggles)
export interface RuleConfig {
  version: 1;
  startingHandSize: number;        // 1-15
  maxPlayers: number;              // 2-10
  win: { condition: 'firstToEmpty' | 'pointsTarget'; pointsTarget: number };
  deck: DeckCounts;                // counts per card type (see Task 4)
}

// packages/engine/src/state.ts
export type GamePhase = 'playing' | 'duel' | 'bombResponse' | 'roundEnd' | 'gameOver';
export const MAX_HAND = 30;        // hand.length > 30 -> eliminated to audience (RD20)
export interface PlayerState {
  id: string; name: string; isBot: boolean; connected: boolean;
  status: 'active' | 'out';        // 'out' = eliminated (overloaded hand), now audience
  hand: Card[]; score: number;
}
export interface PendingDraw { total: number; topValue: number; source: 'colorDraw' | 'blackDraw' }
export interface DuelState { challengerId: string; opponentId: string; activeId: string }
export interface BombResponse { bomberId: string; pending: string[]; bomberDraw: number; endColor: CardColor } // RD12
export interface GameState {
  phase: GamePhase;
  config: RuleConfig;
  players: PlayerState[];          // seat order
  drawPile: Card[];                // secret
  discardPile: Card[];             // top = last element
  currentColor: CardColor;         // active color; black cards set it via chosenColor
  colorLocked: boolean;            // after a run / 3 consecutive pairs: next must match currentColor
  turnIndex: number;
  direction: 1 | -1;
  pending: PendingDraw | null;     // active draw stack
  duel: DuelState | null;          // non-null only in phase 'duel'
  bombResponse: BombResponse | null; // non-null only in phase 'bombResponse'
  goAgain: boolean;                // after playAgain: same player continues, color-restricted
  winnerId: string | null;
  seed: string;
  log: string;
}

// packages/engine/src/types.ts  (move/legality types live here to break the rules<->moves cycle)
export type Move =
  | { type: 'play'; playerId: string; cardIds: string[];   // 1 card, a pair/run/3-pairs set, or [draw, x2]
      chosenColor?: CardColor; targetId?: string; giftCardId?: string; minusDiscard?: boolean }
  | { type: 'draw'; playerId: string }                     // draw 1 (turn passes), or resolve a pending stack
  | { type: 'shield'; playerId: string }
  | { type: 'counter'; playerId: string };
export type LegalityResult = { ok: true } | { ok: false; reason: string };
```
> Draw model (first cut): `draw` takes one card (or resolves the whole pending stack) and the turn passes immediately - there is no "drew, now optionally play it" window, so there is no `pass` move. Revisit if a draw-then-play option is wanted later.

**Helpers (cards.ts):** `isBlack(c)= c.color==='black'`; `isDraw(c)= c.kind==='draw'`; `cardPoints(c)` (for optional scoring). **Import-direction rule (prevents the rules<->moves cycle):** `Move`/`LegalityResult` live in `types.ts` (no runtime deps). `rules.ts`, `combos.ts` and `moves.ts` import them as types from `./types`. `moves.ts` value-imports from `rules.ts`/`combos.ts`; neither value-imports `moves.ts`. The only runtime edges point toward `moves` (acyclic). `index.ts` re-exports: `cards, config, types, rng, state, combos, rules, moves, bot, view`.

---

## Phase 0 - Foundation

### Task 1: Monorepo + Next.js + Tailwind/shadcn scaffold

**Files:**
- Create: `package.json` (workspaces root)
- Create: `apps/web/` (via create-next-app)
- Create: `apps/web/tailwind.config.ts`, `apps/web/app/globals.css`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/vitest.config.ts`

- [ ] **Step 1: Create the workspace root**
Create `package.json`:
```json
{
  "name": "uno-arena",
  "private": true,
  "workspaces": ["apps/*", "packages/*", "functions"],
  "scripts": {
    "dev": "npm run dev -w apps/web",
    "test:engine": "vitest run packages/engine",
    "build:web": "npm run build -w apps/web"
  },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

- [ ] **Step 2: Scaffold the Next.js app**
Run: `npx create-next-app@latest apps/web --ts --app --tailwind --eslint --src-dir=false --import-alias "@/*" --no-turbopack`
Expected: `apps/web` created with App Router + Tailwind.

- [ ] **Step 3: Add shadcn/ui**
Run (from `apps/web`): `npx shadcn@latest init -d` then `npx shadcn@latest add button card dialog input label switch slider tabs select tooltip sonner avatar badge scroll-area`
Expected: `apps/web/components/ui/*` populated; `apps/web/lib/utils.ts` created.

- [ ] **Step 4: Create the engine package skeleton**
Create `packages/engine/package.json`:
```json
{
  "name": "@uno/engine",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p tsconfig.json" }
}
```
> **Consumption model (important):** `@uno/engine` is consumed *as TypeScript source*, never as a pre-built artifact. The web app handles it via `transpilePackages: ['@uno/engine']` (Task 1 Step 5); Cloud Functions inline it via esbuild bundling (Task 2 Step 1); Vitest runs it natively. There is therefore **no `dist` build and no `tsc` emit** for the engine - `tsc` is used only for `--noEmit` typechecking. This is what avoids the NodeNext-vs-raw-`.ts` compile failure.
Create `packages/engine/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "noEmit": true, "strict": true, "skipLibCheck": true
  },
  "include": ["src"]
}
```
Create `packages/engine/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } });
```
Create `packages/engine/src/index.ts` (export order matters - see the import-direction rule above):
```ts
export * from './cards';
export * from './config';
export * from './types';
export * from './rng';
export * from './state';
export * from './combos';
export * from './rules';
export * from './moves';
export * from './bot';
export * from './view';
```

- [ ] **Step 5: Wire the engine into the web app**
Run: `npm i @uno/engine -w apps/web` (workspace symlink). Add to `apps/web/next.config.ts`:
```ts
import type { NextConfig } from 'next';
const nextConfig: NextConfig = { transpilePackages: ['@uno/engine'] };
export default nextConfig;
```
Run: `npm run dev -w apps/web` once to confirm the app boots, then stop it.
Expected: Next.js dev server starts without errors at http://localhost:3000.

### Task 2: Firebase config files + emulators

**Files:**
- Create: `firebase.json`, `.firebaserc`, `database.rules.json`, `apphosting.yaml`
- Create: `apps/web/.env.local.example`
- Create: `functions/package.json`, `functions/tsconfig.json`, `functions/src/index.ts`

- [ ] **Step 1: Functions package**
Create `functions/package.json`:
```json
{
  "name": "functions",
  "type": "module",
  "main": "lib/index.js",
  "engines": { "node": "20" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "esbuild src/index.ts --bundle --platform=node --format=esm --target=node20 --outfile=lib/index.js --external:firebase-admin --external:firebase-functions",
    "serve": "npm run build && firebase emulators:start --only functions,database,auth"
  },
  "dependencies": {
    "firebase-admin": "^12.6.0",
    "firebase-functions": "^6.1.0"
  },
  "devDependencies": {
    "@uno/engine": "*",
    "zod": "^3.23.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.5.0",
    "@firebase/rules-unit-testing": "^4.0.0",
    "firebase": "^11.0.0",
    "vitest": "^2.0.0"
  }
}
```
> **Why esbuild, not `tsc` (Cons 1-2):** `@uno/engine` resolves to a raw `.ts` entry, which `tsc` under `NodeNext` cannot emit, and an npm-workspace symlink does not survive `firebase deploy`'s isolated `npm ci`. esbuild bundles the engine's source (and `zod`) directly into a single self-contained `lib/index.js`, so the deployed function has no workspace/`.ts` runtime dependency. `firebase-admin`/`firebase-functions` stay external (installed from `dependencies` at deploy). `@uno/engine` and `zod` are therefore **devDependencies** (build-time only, inlined) - they are intentionally NOT in runtime `dependencies`. The esbuild entry is `src/index.ts` only, so `functions/test/*.test.ts` (not reachable from that import graph) are never bundled - they run under Vitest, separate from the deploy artifact.
Create `functions/tsconfig.json` (typecheck only; esbuild does the emit). Use `moduleResolution: Bundler` (NOT NodeNext): functions are bundled by esbuild (a bundler), and `@uno/engine` is consumed as Bundler-style source with extensionless relative imports - NodeNext typecheck would reject the engine's imports and fail to resolve its exports. Bundler resolution matches the esbuild reality and still resolves the functions' own `.js`-suffixed relative imports:
```json
{ "compilerOptions": { "module": "ESNext", "moduleResolution": "Bundler", "target": "ES2022",
  "noEmit": true, "strict": true, "skipLibCheck": true, "esModuleInterop": true }, "include": ["src", "test"] }
```
Create `functions/src/index.ts`:
```ts
export {}; // populated in Phase 2
```

- [ ] **Step 2: firebase.json**
Create `firebase.json`:
```json
{
  "database": { "rules": "database.rules.json" },
  "functions": [{
    "source": "functions",
    "codebase": "default",
    "runtime": "nodejs20",
    "predeploy": ["npm --prefix functions run build"]
  }],
  "emulators": {
    "auth": { "port": 9099 },
    "functions": { "port": 5001 },
    "database": { "port": 9000 },
    "ui": { "enabled": true }
  }
}
```

- [ ] **Step 3: Placeholder rules + project files**
Create `database.rules.json`:
```json
{ "rules": { ".read": false, ".write": false } }
```
Create `.firebaserc`:
```json
{ "projects": { "default": "uno-arena-dev" } }
```
Create `apphosting.yaml` (one entry per `NEXT_PUBLIC_FIREBASE_*` var the client reads in `apps/web/lib/firebase.ts` - the single combined-secret form would NOT populate the five discrete `process.env` values). Firebase web config values are publishable, so plain `value` entries are acceptable; they must be available at BUILD time because `NEXT_PUBLIC_*` is inlined during `next build`:
```yaml
runConfig:
  cpu: 1
  memoryMiB: 512
  maxInstances: 2
env:
  - variable: NEXT_PUBLIC_FIREBASE_API_KEY
    value: "<apiKey from Firebase console>"
    availability: [BUILD, RUNTIME]
  - variable: NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    value: "<project>.firebaseapp.com"
    availability: [BUILD, RUNTIME]
  - variable: NEXT_PUBLIC_FIREBASE_DATABASE_URL
    value: "https://<project>-default-rtdb.firebaseio.com"
    availability: [BUILD, RUNTIME]
  - variable: NEXT_PUBLIC_FIREBASE_PROJECT_ID
    value: "<projectId>"
    availability: [BUILD, RUNTIME]
  - variable: NEXT_PUBLIC_FIREBASE_APP_ID
    value: "<appId>"
    availability: [BUILD, RUNTIME]
```
Create `apps/web/.env.local.example`:
```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
# Local only:
NEXT_PUBLIC_USE_EMULATORS=true
```

- [ ] **Step 4: Verify emulators boot**
Run: `npx firebase emulators:start --only database,auth` (requires firebase-tools; `npm i -g firebase-tools` if missing). Confirm Emulator UI at http://localhost:4000, then stop.
Expected: database + auth emulators start cleanly.

---

## Phase 1 - Rule engine (`packages/engine`, TDD)

> All Phase 1 tasks are pure functions with deterministic RNG. Run tests with `npx vitest run packages/engine/src/<file>.test.ts`. Design of record: `docs/UNO_infinity_design.md` (RD1-RD20).

### Task 3: RNG + Card model + deck builder

**Files:**
- Create: `packages/engine/src/rng.ts`, `packages/engine/src/rng.test.ts`
- Create: `packages/engine/src/cards.ts`, `packages/engine/src/cards.test.ts`

- [ ] **Step 1: Write failing RNG test**
Create `packages/engine/src/rng.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createRng, shuffle } from './rng';

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng('seed-1'); const b = createRng('seed-1');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('shuffle is a permutation and deterministic per seed', () => {
    const arr = [1, 2, 3, 4, 5];
    const s1 = shuffle(arr, createRng('x'));
    const s2 = shuffle(arr, createRng('x'));
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(arr).toEqual([1, 2, 3, 4, 5]); // input not mutated
  });
});
```

- [ ] **Step 2: Run - expect FAIL**
Run: `npx vitest run packages/engine/src/rng.test.ts`
Expected: FAIL "Failed to resolve import './rng'".

- [ ] **Step 3: Implement rng.ts**
Create `packages/engine/src/rng.ts`:
```ts
export type Rng = () => number; // returns [0,1)

function xfnv1a(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function createRng(seed: string): Rng {
  let a = xfnv1a(seed) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

- [ ] **Step 4: Run - expect PASS**
Run: `npx vitest run packages/engine/src/rng.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write failing deck test**
Create `packages/engine/src/cards.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildDeck, cardPoints, DEFAULT_DECK, isBlack, isDraw } from './cards';

describe('buildDeck (Infinity, config-driven)', () => {
  const deck = buildDeck(DEFAULT_DECK);
  it('produces the expected colored counts', () => {
    // numberPerColor=2 over 10 ranks over 4 colors = 80
    expect(deck.filter(c => c.kind === 'number').length).toBe(80);
    expect(deck.filter(c => c.kind === 'skip').length).toBe(8);     // 2/color
    expect(deck.filter(c => c.kind === 'minus').length).toBe(4);    // 1/color
    expect(deck.filter(c => c.kind === 'playAgain').length).toBe(8);
  });
  it('produces the expected black/special counts', () => {
    expect(deck.filter(c => c.kind === 'duel').length).toBe(2);
    expect(deck.filter(c => c.kind === 'bomb').length).toBe(2);
    expect(deck.filter(c => c.kind === 'shield').length).toBe(4);
    expect(deck.filter(c => c.kind === 'counter').length).toBe(4);
    expect(deck.filter(c => c.kind === 'mult').length).toBe(4);
    expect(deck.filter(c => c.kind === 'div').length).toBe(4);
  });
  it('every card has a unique id and an explicit value (number|null, never undefined)', () => {
    expect(new Set(deck.map(c => c.id)).size).toBe(deck.length);
    for (const c of deck) expect(c.value === null || typeof c.value === 'number').toBe(true);
    expect(deck.some(c => c.value === undefined)).toBe(false);
  });
  it('black draws carry their amount; colored draws too', () => {
    const blackDraws = deck.filter(c => c.kind === 'draw' && isBlack(c)).map(c => c.value).sort((a, b) => (a! - b!));
    expect(blackDraws).toContain(6);
    expect(blackDraws).toContain(10);
    expect(deck.filter(c => isDraw(c) && !isBlack(c)).every(c => c.value === 2 || c.value === 4)).toBe(true);
  });
  it('scores cards', () => {
    expect(cardPoints({ id: 'a', color: 'red', kind: 'number', value: 7 })).toBe(7);
    expect(cardPoints({ id: 'b', color: 'black', kind: 'bomb', value: null })).toBe(50);
    expect(cardPoints({ id: 'c', color: 'red', kind: 'draw', value: 4 })).toBe(4);
  });
});
```

- [ ] **Step 6: Run - expect FAIL**, then implement.
Create `packages/engine/src/cards.ts`:
```ts
export type CardColor = 'red' | 'green' | 'blue' | 'yellow' | 'black';
export type CardKind =
  | 'number' | 'draw' | 'playAgain' | 'skip' | 'minus'
  | 'mult' | 'div' | 'duel' | 'bomb' | 'reverseDraw' | 'recycle'
  | 'eye' | 'swap' | 'steal' | 'gift' | 'drawUntilColor' | 'shield' | 'counter' | 'wild';
// value: number 0-9; draw amount; reverseDraw 4|10; mult/div 2; else null. NEVER undefined.
export interface Card { id: string; color: CardColor; kind: CardKind; value: number | null }

export const COLORS: Exclude<CardColor, 'black'>[] = ['red', 'green', 'blue', 'yellow'];
export const isBlack = (c: Card): boolean => c.color === 'black';
export const isDraw = (c: Card): boolean => c.kind === 'draw';

export interface DeckCounts {
  numberPerColor: number;       // of EACH rank 0-9, per color
  colorDraw2PerColor: number; colorDraw4PerColor: number;
  playAgainPerColor: number; skipPerColor: number; minusPerColor: number;
  blackDraw2: number; blackDraw4: number; blackDraw6: number; blackDraw8: number; blackDraw10: number;
  mult: number; div: number; duel: number; bomb: number;
  reverseDraw4: number; reverseDraw10: number; recycle: number; wild: number;
  eye: number; swap: number; steal: number; gift: number; drawUntilColor: number;
  shield: number; counter: number;
}

export const DEFAULT_DECK: DeckCounts = {
  numberPerColor: 2, colorDraw2PerColor: 2, colorDraw4PerColor: 2,
  playAgainPerColor: 2, skipPerColor: 2, minusPerColor: 1,
  blackDraw2: 2, blackDraw4: 2, blackDraw6: 2, blackDraw8: 2, blackDraw10: 2,
  mult: 4, div: 4, duel: 2, bomb: 2,
  reverseDraw4: 2, reverseDraw10: 2, recycle: 4, wild: 4,
  eye: 3, swap: 2, steal: 3, gift: 3, drawUntilColor: 3, shield: 4, counter: 4,
};

export function buildDeck(counts: DeckCounts): Card[] {
  const cards: Card[] = [];
  let n = 0;
  const push = (c: Omit<Card, 'id'>, times = 1) => { for (let i = 0; i < times; i++) cards.push({ ...c, id: `c${n++}` }); };
  for (const color of COLORS) {
    for (let v = 0; v <= 9; v++) push({ color, kind: 'number', value: v }, counts.numberPerColor);
    push({ color, kind: 'draw', value: 2 }, counts.colorDraw2PerColor);
    push({ color, kind: 'draw', value: 4 }, counts.colorDraw4PerColor);
    push({ color, kind: 'playAgain', value: null }, counts.playAgainPerColor);
    push({ color, kind: 'skip', value: null }, counts.skipPerColor);
    push({ color, kind: 'minus', value: null }, counts.minusPerColor);
  }
  const B = 'black' as const;
  push({ color: B, kind: 'draw', value: 2 }, counts.blackDraw2);
  push({ color: B, kind: 'draw', value: 4 }, counts.blackDraw4);
  push({ color: B, kind: 'draw', value: 6 }, counts.blackDraw6);
  push({ color: B, kind: 'draw', value: 8 }, counts.blackDraw8);
  push({ color: B, kind: 'draw', value: 10 }, counts.blackDraw10);
  push({ color: B, kind: 'mult', value: 2 }, counts.mult);
  push({ color: B, kind: 'div', value: 2 }, counts.div);
  push({ color: B, kind: 'duel', value: 4 }, counts.duel);
  push({ color: B, kind: 'bomb', value: 4 }, counts.bomb);
  push({ color: B, kind: 'reverseDraw', value: 4 }, counts.reverseDraw4);
  push({ color: B, kind: 'reverseDraw', value: 10 }, counts.reverseDraw10);
  push({ color: B, kind: 'recycle', value: null }, counts.recycle);
  push({ color: B, kind: 'wild', value: null }, counts.wild);
  push({ color: B, kind: 'eye', value: null }, counts.eye);
  push({ color: B, kind: 'swap', value: null }, counts.swap);
  push({ color: B, kind: 'steal', value: null }, counts.steal);
  push({ color: B, kind: 'gift', value: null }, counts.gift);
  push({ color: B, kind: 'drawUntilColor', value: null }, counts.drawUntilColor);
  push({ color: B, kind: 'shield', value: null }, counts.shield);
  push({ color: B, kind: 'counter', value: null }, counts.counter);
  return cards;
}

export function cardPoints(card: Card): number {
  if (card.kind === 'number') return card.value ?? 0;
  if (card.kind === 'draw' || card.kind === 'reverseDraw') return card.value ?? 0;
  if (['duel', 'bomb', 'wild', 'recycle', 'swap', 'eye', 'steal', 'gift', 'drawUntilColor'].includes(card.kind)) return 50;
  return 20; // skip / playAgain / minus / mult / div / shield / counter
}
```

- [ ] **Step 7: Run - expect PASS**
Run: `npx vitest run packages/engine/src/cards.test.ts`
Expected: PASS.

### Task 4: Config (deck composition + toggles) + Zod + merge

**Files:**
- Create: `packages/engine/src/config.ts`, `packages/engine/src/config.test.ts`
- Install: `npm i zod -w packages/engine`

- [ ] **Step 1: Write failing test**
Create `packages/engine/src/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, ruleConfigSchema, mergeConfig, deckTotal } from './config';
import { DEFAULT_DECK } from './cards';

describe('Infinity config', () => {
  it('default config is valid', () => {
    expect(ruleConfigSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
  });
  it('deckTotal counts the default deck', () => {
    expect(deckTotal(DEFAULT_DECK)).toBe(172); // 116 colored + 56 black
  });
  it('mergeConfig fills missing fields (incl. deck) from defaults', () => {
    const merged = mergeConfig({ startingHandSize: 8 });
    expect(merged.startingHandSize).toBe(8);
    expect(merged.deck.duel).toBe(DEFAULT_DECK.duel);
    expect(merged.win.condition).toBe('firstToEmpty');
  });
  it('rejects out-of-range hand size', () => {
    expect(ruleConfigSchema.safeParse({ ...DEFAULT_CONFIG, startingHandSize: 99 }).success).toBe(false);
  });
  it('rejects a deal that cannot fit the configured deck', () => {
    const tiny = { ...DEFAULT_CONFIG, startingHandSize: 15, maxPlayers: 10,
      deck: { ...DEFAULT_DECK, numberPerColor: 0 } }; // far fewer cards now
    expect(ruleConfigSchema.safeParse(tiny).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run - expect FAIL**, then implement.
Create `packages/engine/src/config.ts`:
```ts
import { z } from 'zod';
import { DEFAULT_DECK, type DeckCounts } from './cards';

const count = z.number().int().min(0).max(40);
export const deckCountsSchema = z.object({
  numberPerColor: count, colorDraw2PerColor: count, colorDraw4PerColor: count,
  playAgainPerColor: count, skipPerColor: count, minusPerColor: count,
  blackDraw2: count, blackDraw4: count, blackDraw6: count, blackDraw8: count, blackDraw10: count,
  mult: count, div: count, duel: count, bomb: count,
  reverseDraw4: count, reverseDraw10: count, recycle: count, wild: count,
  eye: count, swap: count, steal: count, gift: count, drawUntilColor: count,
  shield: count, counter: count,
});

export function deckTotal(d: DeckCounts): number {
  const colored = 4 * (d.numberPerColor * 10 + d.colorDraw2PerColor + d.colorDraw4PerColor +
    d.playAgainPerColor + d.skipPerColor + d.minusPerColor);
  const black = d.blackDraw2 + d.blackDraw4 + d.blackDraw6 + d.blackDraw8 + d.blackDraw10 +
    d.mult + d.div + d.duel + d.bomb + d.reverseDraw4 + d.reverseDraw10 + d.recycle + d.wild +
    d.eye + d.swap + d.steal + d.gift + d.drawUntilColor + d.shield + d.counter;
  return colored + black;
}

export const ruleConfigSchema = z.object({
  version: z.literal(1),
  startingHandSize: z.number().int().min(1).max(15),
  maxPlayers: z.number().int().min(2).max(10),
  win: z.object({ condition: z.enum(['firstToEmpty', 'pointsTarget']), pointsTarget: z.number().int().min(50).max(2000) }),
  deck: deckCountsSchema,
}).refine(
  (c) => c.startingHandSize * c.maxPlayers + 1 <= deckTotal(c.deck),
  { message: 'startingHandSize x maxPlayers must leave room in the deck', path: ['startingHandSize'] },
);

export type RuleConfig = z.infer<typeof ruleConfigSchema>;

export const DEFAULT_CONFIG: RuleConfig = {
  version: 1,
  startingHandSize: 7,
  maxPlayers: 6,
  win: { condition: 'firstToEmpty', pointsTarget: 500 },
  deck: DEFAULT_DECK,
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Merge a partial onto defaults and VALIDATE the result (throws on invalid combos). */
export function mergeConfig(patch: DeepPartial<RuleConfig>): RuleConfig {
  const d = DEFAULT_CONFIG;
  const merged = {
    version: 1 as const,
    startingHandSize: patch.startingHandSize ?? d.startingHandSize,
    maxPlayers: patch.maxPlayers ?? d.maxPlayers,
    win: { ...d.win, ...patch.win },
    deck: { ...d.deck, ...patch.deck },
  };
  return ruleConfigSchema.parse(merged);
}
```

- [ ] **Step 3: Run - expect PASS**
Run: `npx vitest run packages/engine/src/config.test.ts`
Expected: PASS.

### Task 5: Game creation + dealing + turn helpers

**Files:**
- Create: `packages/engine/src/state.ts`, `packages/engine/src/state.test.ts`

- [ ] **Step 1: Write failing test**
Create `packages/engine/src/state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createGame, nextActiveIndex, type PlayerSeed } from './state';
import { DEFAULT_CONFIG, deckTotal } from './config';

const seeds: PlayerSeed[] = [
  { id: 'p1', name: 'Nam', isBot: false },
  { id: 'p2', name: 'Linh', isBot: false },
  { id: 'b1', name: 'Bot', isBot: true },
];

describe('createGame', () => {
  it('deals the configured hand size and starts everyone active', () => {
    const g = createGame(seeds, DEFAULT_CONFIG, 'seed-1');
    expect(g.players).toHaveLength(3);
    for (const p of g.players) { expect(p.hand).toHaveLength(7); expect(p.status).toBe('active'); }
  });
  it('conserves the whole deck across piles and hands', () => {
    const g = createGame(seeds, DEFAULT_CONFIG, 'seed-1');
    const total = g.drawPile.length + g.discardPile.length + g.players.reduce((s, p) => s + p.hand.length, 0);
    expect(total).toBe(deckTotal(DEFAULT_CONFIG.deck));
  });
  it('starts on a colored NUMBER card, color not black, with clean flags', () => {
    const g = createGame(seeds, DEFAULT_CONFIG, 'seed-1');
    const top = g.discardPile.at(-1)!;
    expect(top.kind).toBe('number');
    expect(top.color).not.toBe('black');
    expect(g.currentColor).toBe(top.color);
    expect(g.phase).toBe('playing');
    expect(g.pending).toBeNull();
    expect(g.colorLocked).toBe(false);
    expect(g.goAgain).toBe(false);
  });
  it('is deterministic for the same seed', () => {
    const a = createGame(seeds, DEFAULT_CONFIG, 's');
    const b = createGame(seeds, DEFAULT_CONFIG, 's');
    expect(a.players[0].hand.map(c => c.id)).toEqual(b.players[0].hand.map(c => c.id));
  });
});

describe('nextActiveIndex', () => {
  it('skips eliminated (out) players', () => {
    const g = createGame(seeds, DEFAULT_CONFIG, 's');
    g.players[1].status = 'out';                 // p2 eliminated
    expect(nextActiveIndex(g, 0, 1)).toBe(2);    // 0 -> skip 1 -> 2
    g.direction = -1;
    expect(nextActiveIndex(g, 0, 1)).toBe(2);    // backward also skips 1 -> wraps to 2
  });
});
```

- [ ] **Step 2: Run - expect FAIL**, then implement.
Create `packages/engine/src/state.ts`:
```ts
import { buildDeck, type Card, type CardColor } from './cards';
import type { RuleConfig } from './config';
import { createRng, shuffle } from './rng';

export type GamePhase = 'playing' | 'duel' | 'bombResponse' | 'roundEnd' | 'gameOver';
export const MAX_HAND = 30;                        // hand.length > 30 -> eliminated (RD20)

export interface PlayerSeed { id: string; name: string; isBot: boolean }
export interface PlayerState {
  id: string; name: string; isBot: boolean; connected: boolean;
  status: 'active' | 'out';
  hand: Card[]; score: number;
}
export interface PendingDraw { total: number; topValue: number; source: 'colorDraw' | 'blackDraw' }
export interface DuelState { challengerId: string; opponentId: string; activeId: string }
export interface BombResponse { bomberId: string; pending: string[]; bomberDraw: number; endColor: CardColor }

export interface GameState {
  phase: GamePhase;
  config: RuleConfig;
  players: PlayerState[];
  drawPile: Card[];
  discardPile: Card[];
  currentColor: CardColor;
  colorLocked: boolean;
  turnIndex: number;
  direction: 1 | -1;
  pending: PendingDraw | null;
  duel: DuelState | null;
  bombResponse: BombResponse | null;
  goAgain: boolean;
  winnerId: string | null;
  seed: string;
  log: string;
}

export function createGame(seeds: PlayerSeed[], config: RuleConfig, seed: string): GameState {
  const rng = createRng(seed);
  const deck = shuffle(buildDeck(config.deck), rng);
  if (seeds.length * config.startingHandSize + 1 > deck.length)
    throw new Error(`Cannot deal ${config.startingHandSize} to ${seeds.length} players from a ${deck.length}-card deck`);

  const players: PlayerState[] = seeds.map(s => ({
    id: s.id, name: s.name, isBot: s.isBot, connected: true, status: 'active', hand: [], score: 0,
  }));
  let idx = 0;
  for (let r = 0; r < config.startingHandSize; r++)
    for (const p of players) p.hand.push(deck[idx++]);

  // Start on the first plain colored NUMBER card (no special on the opening discard).
  let firstIdx = idx;
  while (firstIdx < deck.length && deck[firstIdx].kind !== 'number') firstIdx++;
  if (firstIdx >= deck.length) throw new Error('No number card available to start the discard pile');
  const first = deck[firstIdx];
  const drawPile = deck.slice(idx).filter(c => c.id !== first.id);

  return {
    phase: 'playing', config, players,
    drawPile, discardPile: [first], currentColor: first.color, colorLocked: false,
    turnIndex: 0, direction: 1, pending: null, duel: null, bombResponse: null, goAgain: false,
    winnerId: null, seed, log: 'Game started',
  };
}

export const topCard = (s: GameState): Card => s.discardPile[s.discardPile.length - 1];
export const currentPlayer = (s: GameState): PlayerState => s.players[s.turnIndex];
export const activePlayers = (s: GameState): PlayerState[] => s.players.filter(p => p.status === 'active');

/** Index of the player `steps` active seats from `from`, in s.direction, skipping 'out' players. */
export function nextActiveIndex(s: GameState, from: number, steps: number): number {
  const n = s.players.length;
  let i = from, moved = 0;
  while (moved < steps) {
    i = ((i + s.direction) % n + n) % n;
    if (s.players[i].status === 'active') moved++;
    if (activePlayers(s).length === 0) break; // safety
  }
  return i;
}
```

- [ ] **Step 3: Run - expect PASS**
Run: `npx vitest run packages/engine/src/state.test.ts`
Expected: PASS.

---

### Task 6: Types + multi-card combos + playability/legality

**Files:**
- Create: `packages/engine/src/types.ts`
- Create: `packages/engine/src/combos.ts`, `packages/engine/src/combos.test.ts`
- Create: `packages/engine/src/rules.ts`, `packages/engine/src/rules.test.ts`

- [ ] **Step 0: Shared move/legality types (breaks the rules<->moves cycle)**
Create `packages/engine/src/types.ts`:
```ts
import type { CardColor } from './cards';

export type Move =
  | { type: 'play'; playerId: string; cardIds: string[];
      chosenColor?: CardColor; targetId?: string; giftCardId?: string; minusDiscard?: boolean }
  | { type: 'draw'; playerId: string }
  | { type: 'shield'; playerId: string }
  | { type: 'counter'; playerId: string };

export type LegalityResult = { ok: true } | { ok: false; reason: string };
```

- [ ] **Step 1: Multi-card combos - failing test, then implement (RD3)**
Create `packages/engine/src/combos.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { classifySet } from './combos';
import type { Card } from './cards';
const num = (id: string, color: Card['color'], v: number): Card => ({ id, color, kind: 'number', value: v });

describe('classifySet', () => {
  it('single card', () => {
    const r = classifySet([num('a', 'red', 5)]);
    expect(r.ok && r.combo.kind).toBe('single');
  });
  it('pair (same color+number)', () => {
    const r = classifySet([num('a', 'red', 6), num('b', 'red', 6)]);
    expect(r.ok && r.combo.kind).toBe('pair');
  });
  it('run 6-7-8 same color, locks color', () => {
    const r = classifySet([num('a', 'red', 6), num('b', 'red', 7), num('c', 'red', 8)]);
    expect(r.ok && r.combo.kind).toBe('run');
    expect(r.ok && r.combo.locksColor).toBe(true);
    expect(r.ok && r.combo.finalTop.value).toBe(8);
  });
  it('three consecutive pairs 6-6-7-7-8-8', () => {
    const r = classifySet([num('a', 'red', 6), num('b', 'red', 6), num('c', 'red', 7), num('d', 'red', 7), num('e', 'red', 8), num('f', 'red', 8)]);
    expect(r.ok && r.combo.kind).toBe('pairsRun');
  });
  it('x2 combo = one draw + one mult', () => {
    const draw: Card = { id: 'd', color: 'black', kind: 'draw', value: 4 };
    const mult: Card = { id: 'm', color: 'black', kind: 'mult', value: 2 };
    const r = classifySet([draw, mult]);
    expect(r.ok && r.combo.isX2).toBe(true);
  });
  it('rejects a non-consecutive multi-number set', () => {
    expect(classifySet([num('a', 'red', 6), num('b', 'red', 8), num('c', 'red', 9)]).ok).toBe(false);
  });
});
```
Create `packages/engine/src/combos.ts`:
```ts
import type { Card } from './cards';

export type ComboKind = 'single' | 'x2' | 'pair' | 'run' | 'pairsRun';
export interface Combo {
  kind: ComboKind; cards: Card[];   // play order (runs sorted ascending)
  lead: Card;                       // card matched against the discard top
  finalTop: Card;                   // card left on top after the play
  locksColor: boolean; isX2: boolean;
  draw?: Card; mult?: Card;         // set for x2
}
export type ComboResult = { ok: true; combo: Combo } | { ok: false; reason: string };

const consecutive = (asc: number[]) => asc.every((v, i) => i === 0 || v === asc[i - 1] + 1);

export function classifySet(cards: Card[]): ComboResult {
  if (cards.length === 0) return { ok: false, reason: 'No cards' };
  if (cards.length === 1) {
    const c = cards[0];
    return { ok: true, combo: { kind: 'single', cards, lead: c, finalTop: c, locksColor: false, isX2: false } };
  }
  if (cards.length === 2) {
    const draw = cards.find(c => c.kind === 'draw');
    const mult = cards.find(c => c.kind === 'mult');
    if (draw && mult)
      return { ok: true, combo: { kind: 'x2', cards: [draw, mult], lead: draw, finalTop: mult, locksColor: false, isX2: true, draw, mult } };
    const [a, b] = cards;
    if (a.kind === 'number' && b.kind === 'number' && a.color !== 'black' && a.color === b.color && a.value === b.value)
      return { ok: true, combo: { kind: 'pair', cards, lead: a, finalTop: b, locksColor: false, isX2: false } };
    return { ok: false, reason: 'Two cards must be a matching pair or draw+x2' };
  }
  // 3+ numbers, same non-black color
  if (cards.every(c => c.kind === 'number' && c.color !== 'black' && c.color === cards[0].color)) {
    const sorted = [...cards].sort((a, b) => (a.value! - b.value!));
    const vals = sorted.map(c => c.value!);
    if (new Set(vals).size === vals.length && consecutive(vals))
      return { ok: true, combo: { kind: 'run', cards: sorted, lead: sorted[0], finalTop: sorted[sorted.length - 1], locksColor: true, isX2: false } };
    if (vals.length === 6) {
      const ranks = [...new Set(vals)].sort((a, b) => a - b);
      const eachTwice = ranks.length === 3 && ranks.every(r => vals.filter(v => v === r).length === 2);
      if (eachTwice && consecutive(ranks))
        return { ok: true, combo: { kind: 'pairsRun', cards: sorted, lead: sorted[0], finalTop: sorted[sorted.length - 1], locksColor: true, isX2: false } };
    }
    return { ok: false, reason: 'Not a valid run or three consecutive pairs' };
  }
  return { ok: false, reason: 'Invalid multi-card set' };
}
```

- [ ] **Step 2: Playability + legality - failing test, then implement**
Create `packages/engine/src/rules.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isPlayable, isMoveLegal } from './rules';
import { DEFAULT_CONFIG } from './config';
import { createGame, type GameState, type PlayerState } from './state';
import type { Card } from './cards';

const top: Card = { id: 't', color: 'red', kind: 'number', value: 5 };
const cardOf = (over: Partial<Card>): Card => ({ id: 'x', color: 'red', kind: 'number', value: 1, ...over });

describe('isPlayable', () => {
  it('matches color / number; black always; colorLocked forces color', () => {
    expect(isPlayable(cardOf({ color: 'red', value: 9 }), top, 'red', false)).toBe(true);
    expect(isPlayable(cardOf({ color: 'blue', value: 5 }), top, 'red', false)).toBe(true);
    expect(isPlayable(cardOf({ color: 'blue', value: 9 }), top, 'red', false)).toBe(false);
    expect(isPlayable(cardOf({ color: 'black', kind: 'wild', value: null }), top, 'red', false)).toBe(true);
    expect(isPlayable(cardOf({ color: 'blue', value: 5 }), top, 'red', true)).toBe(false); // locked to red
  });
});

function mk(over: Partial<GameState>, hand: Card[]): GameState {
  const players: PlayerState[] = [
    { id: 'p1', name: 'A', isBot: false, connected: true, status: 'active', hand, score: 0 },
    { id: 'p2', name: 'B', isBot: false, connected: true, status: 'active', hand: [cardOf({ id: 'z' })], score: 0 },
  ];
  return { ...createGame([{ id: 'p1', name: 'A', isBot: false }, { id: 'p2', name: 'B', isBot: false }], DEFAULT_CONFIG, 's'),
    players, discardPile: [top], currentColor: 'red', pending: null, ...over };
}

describe('isMoveLegal (Infinity)', () => {
  it('rejects out of turn', () => {
    const s = mk({}, [cardOf({ id: 'a', value: 9 })]);
    expect(isMoveLegal(s, { type: 'draw', playerId: 'p2' }).ok).toBe(false);
  });
  it('cannot finish on a black card (RD19)', () => {
    const s = mk({}, [cardOf({ id: 'a', color: 'black', kind: 'wild', value: null })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['a'], chosenColor: 'red' }).ok).toBe(false);
  });
  it('x2 / div require a pending stack', () => {
    const s = mk({}, [cardOf({ id: 'a', value: 5 }), cardOf({ id: 'm', color: 'black', kind: 'mult', value: 2 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['a', 'm'] }).ok).toBe(false);
  });
  it('a draw stacks only if value >= pending top (RD6)', () => {
    const s = mk({ pending: { total: 6, topValue: 6, source: 'blackDraw' } },
      [cardOf({ id: 'd', color: 'black', kind: 'draw', value: 4 }), cardOf({ id: 'd2', color: 'black', kind: 'draw', value: 8 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['d'] }).ok).toBe(false); // 4 < 6
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['d2'] }).ok).toBe(true);  // 8 >= 6
  });
  it('shield/counter need a pending and a held shield card (not the last card)', () => {
    const noShield = mk({ pending: { total: 4, topValue: 4, source: 'blackDraw' } }, [cardOf({ id: 'a', value: 5 })]);
    expect(isMoveLegal(noShield, { type: 'shield', playerId: 'p1' }).ok).toBe(false); // holds no shield
    const noPending = mk({}, [cardOf({ id: 's', color: 'black', kind: 'shield', value: null }), cardOf({ id: 'k', value: 2 })]);
    expect(isMoveLegal(noPending, { type: 'shield', playerId: 'p1' }).ok).toBe(false); // nothing to shield
    const ok = mk({ pending: { total: 4, topValue: 4, source: 'blackDraw' } },
      [cardOf({ id: 's', color: 'black', kind: 'shield', value: null }), cardOf({ id: 'k', value: 2 })]);
    expect(isMoveLegal(ok, { type: 'shield', playerId: 'p1' }).ok).toBe(true);
  });
  it('targeted cards need a valid active opponent', () => {
    // give p1 a spare card so the (black) swap is not the last card (RD19).
    const s = mk({}, [cardOf({ id: 'a', color: 'black', kind: 'swap', value: null }), cardOf({ id: 'k', value: 2 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['a'] }).ok).toBe(false);          // no target
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['a'], targetId: 'p2' }).ok).toBe(true);
  });
  it('cannot finish on a gift - it sheds the gifted card too (RD19)', () => {
    // hand = [gift, X]: playing gift + gifting X would empty the hand -> illegal.
    const s = mk({}, [cardOf({ id: 'g', color: 'black', kind: 'gift', value: null }), cardOf({ id: 'x', value: 4 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['g'], targetId: 'p2', giftCardId: 'x' }).ok).toBe(false);
  });
  it('cannot recycle a gift to empty the hand (RD19)', () => {
    const giftTop = cardOf({ id: 'gt', color: 'black', kind: 'gift', value: null });
    const s = mk({ discardPile: [giftTop] }, [cardOf({ id: 'r', color: 'black', kind: 'recycle', value: null }), cardOf({ id: 'x', value: 4 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['r'], targetId: 'p2', giftCardId: 'x' }).ok).toBe(false);
  });
  it('cannot recycle a minus to dump the whole hand (RD19)', () => {
    const minusTop = cardOf({ id: 'mt', color: 'red', kind: 'minus', value: null });
    const s = mk({ discardPile: [minusTop], currentColor: 'red' }, [cardOf({ id: 'r', color: 'black', kind: 'recycle', value: null }), cardOf({ id: 'r3', color: 'red', value: 3 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['r'], minusDiscard: true }).ok).toBe(false);
  });
});
```
Create `packages/engine/src/rules.ts`:
```ts
import { isBlack, isDraw, type Card, type CardColor } from './cards';
import { topCard, type GameState } from './state';
import { classifySet } from './combos';
import type { Move, LegalityResult } from './types';

const TARGETED = new Set<Card['kind']>(['duel', 'eye', 'swap', 'steal', 'gift']);
/** Black cards that require the player to choose the active color (RD1). */
function needsColor(card: Card): boolean {
  return card.kind === 'wild' || card.kind === 'drawUntilColor' || card.kind === 'duel' || card.kind === 'bomb';
}

/** Pure matching (no pending logic). Pending rules are enforced in isMoveLegal. */
export function isPlayable(card: Card, top: Card, currentColor: CardColor, colorLocked: boolean): boolean {
  if (isBlack(card)) return true;                       // colorless plays on anything, bypasses lock
  if (colorLocked) return card.color === currentColor;
  if (card.color === currentColor) return true;
  if (card.kind === 'number' && top.kind === 'number') return card.value === top.value;
  if (card.kind !== 'number') return card.kind === top.kind;
  return false;
}

export function getPlayableCards(state: GameState, playerId: string): Card[] {
  const p = state.players.find(x => x.id === playerId);
  if (!p) return [];
  const top = topCard(state);
  if (state.pending)
    return p.hand.filter(c => (isDraw(c) && (c.value ?? 0) >= state.pending!.topValue) || c.kind === 'div');
  return p.hand.filter(c => isPlayable(c, top, state.currentColor, state.colorLocked));
}

export function isMoveLegal(state: GameState, move: Move): LegalityResult {
  if (!['playing', 'duel', 'bombResponse'].includes(state.phase)) return { ok: false, reason: 'Game not in progress' };
  const turnId = state.phase === 'bombResponse' ? state.bombResponse!.pending[0]
    : state.phase === 'duel' ? state.duel!.activeId
    : state.players[state.turnIndex].id;
  if (move.playerId !== turnId) return { ok: false, reason: 'Not your turn' };
  const me = state.players.find(p => p.id === move.playerId);
  if (!me || me.status !== 'active') return { ok: false, reason: 'You are not in the game' };

  // Bomb response: each hit player may only accept (draw 4), shield, or counter.
  if (state.phase === 'bombResponse') {
    if (move.type === 'draw') return { ok: true };
    if (move.type === 'shield' || move.type === 'counter') {
      if (!me.hand.some(c => c.kind === move.type)) return { ok: false, reason: `You have no ${move.type} card` };
      if (me.hand.length === 1) return { ok: false, reason: 'Cannot use your last card as shield/counter (RD19) - you must accept' };
      return { ok: true };
    }
    return { ok: false, reason: 'Respond to the bomb: draw, shield, or counter' };
  }

  if (move.type === 'draw') return { ok: true };
  if (move.type === 'shield' || move.type === 'counter') {
    if (!state.pending) return { ok: false, reason: 'Nothing to shield/counter' };
    if (!me.hand.some(c => c.kind === move.type)) return { ok: false, reason: `You have no ${move.type} card` };
    if (me.hand.length === 1) return { ok: false, reason: 'Cannot play your last card as shield/counter (RD19)' };
    return { ok: true };
  }

  // play
  const cards = move.cardIds.map(id => me.hand.find(c => c.id === id)).filter(Boolean) as Card[];
  if (cards.length !== move.cardIds.length) return { ok: false, reason: 'Card not in hand' };
  const res = classifySet(cards);
  if (!res.ok) return res;
  const c = res.combo;
  const top = topCard(state);

  // RD19: cannot empty your hand on a black final card.
  if (me.hand.length === c.cards.length && isBlack(c.finalTop))
    return { ok: false, reason: 'You cannot finish on a black card' };

  if (state.pending) {
    if (c.isX2) return (c.draw!.value ?? 0) >= state.pending.topValue
      ? { ok: true } : { ok: false, reason: 'Draw value too low to stack' };
    if (c.kind === 'single' && isDraw(c.lead)) return (c.lead.value ?? 0) >= state.pending.topValue
      ? { ok: true } : { ok: false, reason: 'Draw value too low to stack' };
    if (c.kind === 'single' && c.lead.kind === 'div') return { ok: true };
    return { ok: false, reason: 'Only a draw, x2, or /2 may be played on a stack' };
  }

  if (c.isX2 || c.lead.kind === 'div' || c.lead.kind === 'mult')
    return { ok: false, reason: 'x2 and /2 only play on a draw stack' };
  if (c.lead.kind === 'shield' || c.lead.kind === 'counter')
    return { ok: false, reason: 'Use the shield/counter action' };
  if (!isPlayable(c.lead, top, state.currentColor, state.colorLocked))
    return { ok: false, reason: 'Card is not playable on the pile' };
  if (state.goAgain && !isBlack(c.lead) && c.lead.color !== state.currentColor && c.lead.kind !== 'playAgain')
    return { ok: false, reason: 'Must continue with the play-again color' };
  if (needsColor(c.lead) && !move.chosenColor) return { ok: false, reason: 'Choose a color' };
  if (TARGETED.has(c.lead.kind)) {
    const t = state.players.find(p => p.id === move.targetId);
    if (!t || t.status !== 'active' || t.id === me.id) return { ok: false, reason: 'Choose a valid opponent' };
  }
  if (c.lead.kind === 'gift') {
    if (!move.giftCardId || !me.hand.find(x => x.id === move.giftCardId)) return { ok: false, reason: 'Choose a card to gift' };
    // RD19: gift also sheds the gifted card; you cannot empty your hand finishing on a (black) gift.
    if (me.hand.length === c.cards.length + 1) return { ok: false, reason: 'Cannot finish on a gift' };
  }
  if (c.lead.kind === 'bomb' && top.kind !== 'number') return { ok: false, reason: 'Bomb plays only on a number' };
  if (c.lead.kind === 'recycle') {
    if (top.kind === 'recycle') return { ok: false, reason: 'Nothing to recycle' };
    if (top.kind === 'number' && state.discardPile.length === 1) return { ok: false, reason: 'Nothing to recycle (opening card)' }; // RD14
    if (needsColor(top) && !move.chosenColor) return { ok: false, reason: 'Choose a color for the recycled card' };
    if (TARGETED.has(top.kind)) {                          // recycling a targeted card needs the same target/gift inputs
      const t = state.players.find(p => p.id === move.targetId);
      if (!t || t.status !== 'active' || t.id === me.id) return { ok: false, reason: 'Choose a valid opponent for the recycled card' };
      if (top.kind === 'gift') {
        if (!move.giftCardId || !me.hand.find(x => x.id === move.giftCardId)) return { ok: false, reason: 'Choose a card to gift' };
        // RD19: recycle is black; a recycled gift also sheds the gifted card -> mustn't empty the hand.
        if (me.hand.length === c.cards.length + 1) return { ok: false, reason: 'Cannot finish on a recycled gift' };
      }
    }
    // RD19: a recycled minus that dumps every remaining card would empty the hand on a (black) recycle.
    if (top.kind === 'minus' && move.minusDiscard) {
      const after = me.hand.filter(x => !move.cardIds.includes(x.id)); // hand after the recycle leaves
      if (after.length > 0 && after.every(x => x.color === top.color))
        return { ok: false, reason: 'Cannot empty your hand on a recycled minus' };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 3: Run - expect PASS**
Run: `npx vitest run packages/engine/src/combos.test.ts packages/engine/src/rules.test.ts`
Expected: PASS.

### Task 7: applyMove engine - core (play, draw-stack math, elimination, win)

**Files:**
- Create: `packages/engine/src/moves.ts`, `packages/engine/src/moves.core.test.ts`

- [ ] **Step 1: Write failing test** (`packages/engine/src/moves.core.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { applyMove } from './moves';
import { DEFAULT_CONFIG } from './config';
import type { GameState, PlayerState, PendingDraw } from './state';
import type { Card } from './cards';

const C = (over: Partial<Card>): Card => ({ id: 'x', color: 'red', kind: 'number', value: 1, ...over });
function mk(over: Partial<GameState>, hands: Card[][]): GameState {
  const players: PlayerState[] = ['p1', 'p2', 'p3'].map((id, i) => ({
    id, name: id, isBot: false, connected: true, status: 'active',
    hand: hands[i]?.length ? hands[i] : [C({ id: `pad${i}`, color: 'blue', value: 1 })], score: 0,
  }));
  return {
    phase: 'playing', config: DEFAULT_CONFIG, players,
    drawPile: Array.from({ length: 40 }, (_, i) => C({ id: `d${i}`, color: 'green', value: (i % 9) + 1 })),
    discardPile: [C({ id: 'top', color: 'red', value: 5 })],
    currentColor: 'red', colorLocked: false, turnIndex: 0, direction: 1,
    pending: null, duel: null, bombResponse: null, goAgain: false, winnerId: null, seed: 's', log: '', ...over,
  };
}

describe('applyMove - core', () => {
  it('plays a matching number, advances turn, does not mutate input', () => {
    const s = mk({}, [[C({ id: 'a', color: 'red', value: 9 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'] });
    expect(r.discardPile.at(-1)!.id).toBe('a');
    expect(r.players[0].hand).toHaveLength(0);
    expect(r.turnIndex).toBe(1);
    expect(s.players[0].hand).toHaveLength(1);
  });
  it('a run locks the color to the run color', () => {
    const run = [C({ id: 'a', color: 'red', value: 6 }), C({ id: 'b', color: 'red', value: 7 }), C({ id: 'c', color: 'red', value: 8 })];
    const s = mk({ currentColor: 'red' }, [run, [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a', 'b', 'c'] });
    expect(r.colorLocked).toBe(true);
    expect(r.currentColor).toBe('red');
    expect(r.discardPile.at(-1)!.value).toBe(8);
  });
  it('a draw card starts a pending stack and passes to the victim', () => {
    const s = mk({}, [[C({ id: 'a', color: 'red', kind: 'draw', value: 2 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'] });
    expect(r.pending).toEqual<PendingDraw>({ total: 2, topValue: 2, source: 'colorDraw' });
    expect(r.turnIndex).toBe(1);
  });
  it('x2 doubles the attached draw and extends the stack (RD4: 2+4+8=14)', () => {
    const pending: PendingDraw = { total: 6, topValue: 4, source: 'colorDraw' };
    const s = mk({ pending, turnIndex: 0 }, [[C({ id: 'd', color: 'black', kind: 'draw', value: 4 }), C({ id: 'm', color: 'black', kind: 'mult', value: 2 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['d', 'm'] });
    expect(r.pending!.total).toBe(14);
    expect(r.turnIndex).toBe(1);
  });
  it('/2 halves the pending; the player draws the result (RD5: 6 -> 3)', () => {
    const pending: PendingDraw = { total: 6, topValue: 4, source: 'colorDraw' };
    const s = mk({ pending, turnIndex: 0 }, [[C({ id: 'v', color: 'black', kind: 'div', value: 2 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['v'] });
    expect(r.pending).toBeNull();
    expect(r.players[0].hand.length).toBe(3); // drew 3 (the div card left the hand)
    expect(r.turnIndex).toBe(1);
  });
  it('shield pushes the pending to the next player (RD7)', () => {
    const pending: PendingDraw = { total: 4, topValue: 4, source: 'blackDraw' };
    const s = mk({ pending, turnIndex: 0 }, [[C({ id: 'a', value: 1 }), C({ id: 'sh', color: 'black', kind: 'shield', value: null })], [], []]);
    const r = applyMove(s, { type: 'shield', playerId: 'p1' });
    expect(r.pending).toEqual(pending);  // stack preserved
    expect(r.turnIndex).toBe(1);         // now p2 faces it
    expect(r.players[0].hand.length).toBe(1); // p1 drew nothing; shield card consumed
  });
  it('drawing the stack draws total and passes (victim skipped)', () => {
    const pending: PendingDraw = { total: 4, topValue: 4, source: 'blackDraw' };
    const s = mk({ pending, turnIndex: 1 }, [[], [], []]);
    const r = applyMove(s, { type: 'draw', playerId: 'p2' });
    expect(r.players[1].hand.length).toBe(1 + 4); // pad + 4 drawn
    expect(r.pending).toBeNull();
    expect(r.turnIndex).toBe(2);
  });
  it('a player whose hand exceeds 30 is eliminated (RD20) and skipped', () => {
    const big = Array.from({ length: 28 }, (_, i) => C({ id: `h${i}`, color: 'green', value: (i % 9) + 1 }));
    const pending: PendingDraw = { total: 6, topValue: 6, source: 'blackDraw' };
    const s = mk({ pending, turnIndex: 1 }, [[C({ id: 'a', value: 1 })], big, [C({ id: 'b', value: 2 })]]);
    const r = applyMove(s, { type: 'draw', playerId: 'p2' }); // 28 + 6 = 34 > 30
    expect(r.players[1].status).toBe('out');
  });
});
```

- [ ] **Step 2: Run - expect FAIL**, then implement (`packages/engine/src/moves.ts`):
```ts
import { isBlack, isDraw, type Card, type CardColor } from './cards';
import { topCard, nextActiveIndex, activePlayers, MAX_HAND, type GameState, type PlayerState } from './state';
import { classifySet, type Combo } from './combos';
import { createRng, shuffle } from './rng';
import type { Move } from './types';

export const clone = (s: GameState): GameState => ({
  ...s,
  players: s.players.map(p => ({ ...p, hand: [...p.hand] })),
  drawPile: [...s.drawPile], discardPile: [...s.discardPile],
  pending: s.pending ? { ...s.pending } : null,
  duel: s.duel ? { ...s.duel } : null,
  bombResponse: s.bombResponse ? { ...s.bombResponse, pending: [...s.bombResponse.pending] } : null,
});

/** Advance to the next ACTIVE seat (skips eliminated players); clears per-turn flags. */
export function advance(s: GameState, steps = 1): void {
  s.turnIndex = nextActiveIndex(s, s.turnIndex, steps);
  s.goAgain = false;
}

function reshuffle(s: GameState): void {
  if (s.discardPile.length <= 1) return;
  const top = s.discardPile.pop()!;
  s.drawPile = shuffle(s.discardPile, createRng(s.seed + ':' + s.discardPile.length));
  s.discardPile = [top];
}

/** Single elimination chokepoint (RD20): call after ANY hand growth (draws, gift, steal, drawUntilColor). */
export function eliminateIfOverloaded(s: GameState, p: PlayerState): void {
  if (p.hand.length > MAX_HAND && p.status === 'active') {
    p.status = 'out';
    s.log = `${p.name} overloaded (${p.hand.length}) and is out`;
  }
}

export function drawCards(s: GameState, p: PlayerState, count: number): void {
  for (let i = 0; i < count; i++) {
    if (s.drawPile.length === 0) reshuffle(s);
    if (s.drawPile.length === 0) break;
    p.hand.push(s.drawPile.pop()!);
  }
  eliminateIfOverloaded(s, p);
}

/** Win checks: any active player emptied, or only one active player remains (RD18, RD20). */
function checkEnd(s: GameState): GameState {
  const emptied = s.players.find(p => p.status === 'active' && p.hand.length === 0);
  if (emptied) { s.winnerId = emptied.id; s.phase = 'gameOver'; s.log = `${emptied.name} wins!`; return s; }
  const act = activePlayers(s);
  if (act.length === 1) { s.winnerId = act[0].id; s.phase = 'gameOver'; s.log = `${act[0].name} is the last player standing!`; }
  return s;
}

export function applyMove(state: GameState, move: Move): GameState {
  const s = clone(state);
  if (s.phase === 'bombResponse') return resolveBombResponse(s, move); // Task 8: each hit player responds in turn
  switch (move.type) {
    case 'draw': return resolveDraw(s);
    case 'shield': return resolveShield(s);
    case 'counter': return resolveCounter(s);
    case 'play': return applyPlay(s, move);
  }
}

/** The player whose turn it is, accounting for the duel sub-phase. */
const acting = (s: GameState): PlayerState =>
  s.phase === 'duel' && s.duel ? s.players.find(p => p.id === s.duel!.activeId)! : s.players[s.turnIndex];

function resolveDraw(s: GameState): GameState {
  const p = acting(s);
  if (s.pending) {
    drawCards(s, p, s.pending.total);
    s.log = `${p.name} drew ${s.pending.total}`;
    s.pending = null; s.colorLocked = false;
    if (s.phase === 'duel') return endDuel(s);   // drawing ends a duel (Task 8)
    advance(s, 1);
  } else {
    drawCards(s, p, 1);
    s.log = `${p.name} drew a card`;
    advance(s, 1);
  }
  return checkEnd(s);
}

function discardKind(s: GameState, p: PlayerState, kind: 'shield' | 'counter'): void {
  const i = p.hand.findIndex(c => c.kind === kind);
  if (i >= 0) s.discardPile.push(p.hand.splice(i, 1)[0]);
}
function resolveShield(s: GameState): GameState {           // push pending to next player
  const p = acting(s); discardKind(s, p, 'shield');        // legality forbids this being the last card (RD19)
  s.log = `${p.name} shielded`;
  advance(s, 1);                                            // pending preserved, passes to next
  return checkEnd(s);
}
function resolveCounter(s: GameState): GameState {          // bounce pending to previous player
  const p = acting(s); discardKind(s, p, 'counter');
  s.log = `${p.name} countered`;
  const dir = s.direction; s.direction = (-dir) as 1 | -1;
  advance(s, 1); s.direction = dir;                         // step backward one active seat (toggles in duel)
  return checkEnd(s);
}

function applyPlay(s: GameState, move: Extract<Move, { type: 'play' }>): GameState {
  const actor = s.players.find(p => p.id === move.playerId)!;
  const cards = move.cardIds.map(id => actor.hand.find(c => c.id === id)!);
  const combo = (classifySet(cards) as { ok: true; combo: Combo }).combo; // legality already validated
  actor.hand = actor.hand.filter(c => !move.cardIds.includes(c.id));
  for (const c of combo.cards) s.discardPile.push(c);
  s.log = `${actor.name} played ${combo.kind === 'single' ? combo.lead.kind : combo.kind}`;

  // --- Stack responses (pending exists): draw-extend, x2, div ---
  if (s.pending) {
    if (combo.isX2) {
      s.pending.total += (combo.draw!.value ?? 0) * 2;     // RD4: double the attached draw
      s.pending.topValue = combo.draw!.value ?? 0;
      advance(s, 1);
    } else if (combo.lead.kind === 'div') {                // RD5: halve, then this player draws
      s.pending.total = Math.floor(s.pending.total / 2);
      drawCards(s, actor, s.pending.total);
      s.pending = null; s.colorLocked = false;
      if (s.phase === 'duel') return endDuel(s);            // RD11: /2 resolves the stack -> duel ends
      advance(s, 1);
    } else {                                               // single draw extends the stack
      s.pending.total += combo.lead.value ?? 0;
      s.pending.topValue = combo.lead.value ?? 0;
      advance(s, 1);                                        // duel-aware advance toggles the duelist
    }
    return checkEnd(s);
  }

  // --- Normal play (no pending) ---
  s.currentColor = isBlack(combo.lead)
    ? (move.chosenColor ?? s.currentColor)               // black sets color (RD1)
    : combo.finalTop.color;
  s.colorLocked = combo.locksColor;

  // Draw card with no pending: open a new stack.
  if (isDraw(combo.lead)) {
    s.pending = { total: combo.lead.value ?? 0, topValue: combo.lead.value ?? 0,
      source: isBlack(combo.lead) ? 'blackDraw' : 'colorDraw' };
    advance(s, 1);
    return checkEnd(s);
  }

  // Special effects (skip/playAgain/minus/reverseDraw/recycle/duel/bomb/targeted/drawUntilColor/wild)
  // are dispatched to applyEffect (Task 8). Plain numbers/pairs/runs just advance.
  applyEffect(s, combo, move);
  return checkEnd(s);
}

// Minimal runtime bodies so Task 7's core tests actually run (a `declare function`
// has NO runtime value and would throw when applyPlay calls applyEffect). Task 8
// replaces applyEffect's body and the endDuel/resolveBombResponse stubs with the
// full implementations. The minimal applyEffect just advances the turn, which is
// exactly the behavior the core tests need for plain numbers and runs.
function applyEffect(s: GameState, _combo: Combo, _move: Extract<Move, { type: 'play' }>): void { advance(s, 1); }
function endDuel(s: GameState): GameState { return s; }              // replaced in Task 8
function resolveBombResponse(s: GameState, _move: Move): GameState { return s; } // replaced in Task 8
export { checkEnd, reshuffle };
```
> Note: Task 8 replaces the minimal `applyEffect`/`endDuel`/`resolveBombResponse` bodies in this file with the full implementations. The minimal `applyEffect` (advance only) is correct for plain numbers/pairs/runs, which is all Task 7's core tests exercise.

- [ ] **Step 3: Run - expect PASS** (core tests)
Run: `npx vitest run packages/engine/src/moves.core.test.ts`
Expected: PASS. (Special-effect kinds are covered in Task 8.)

### Task 8: applyMove - special effects, duel, targeted cards

**Files:**
- Modify: `packages/engine/src/moves.ts` (real `applyEffect`/`endDuel`; make `advance` duel-aware)
- Create: `packages/engine/src/moves.special.test.ts`

- [ ] **Step 1: Write failing tests** (`packages/engine/src/moves.special.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { applyMove } from './moves';
import { DEFAULT_CONFIG } from './config';
import type { GameState, PlayerState } from './state';
import type { Card } from './cards';

const C = (over: Partial<Card>): Card => ({ id: 'x', color: 'red', kind: 'number', value: 1, ...over });
function mk(over: Partial<GameState>, hands: Card[][]): GameState {
  const players: PlayerState[] = ['p1', 'p2', 'p3'].map((id, i) => ({
    id, name: id, isBot: false, connected: true, status: 'active',
    hand: hands[i]?.length ? hands[i] : [C({ id: `pad${i}`, color: 'blue', value: 1 }), C({ id: `pq${i}`, color: 'blue', value: 2 })], score: 0,
  }));
  return {
    phase: 'playing', config: DEFAULT_CONFIG, players,
    drawPile: Array.from({ length: 40 }, (_, i) => C({ id: `d${i}`, color: 'green', value: (i % 9) + 1 })),
    discardPile: [C({ id: 'top', color: 'red', value: 5 })],
    currentColor: 'red', colorLocked: false, turnIndex: 0, direction: 1,
    pending: null, duel: null, bombResponse: null, goAgain: false, winnerId: null, seed: 's', log: '', ...over,
  };
}

describe('special effects', () => {
  it('skip advances two active seats', () => {
    const r = applyMove(mk({}, [[C({ id: 'a', color: 'red', kind: 'skip', value: null }), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'] });
    expect(r.turnIndex).toBe(2);
  });
  it('playAgain keeps the turn and sets goAgain', () => {
    const r = applyMove(mk({}, [[C({ id: 'a', color: 'red', kind: 'playAgain', value: null }), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'] });
    expect(r.turnIndex).toBe(0);
    expect(r.goAgain).toBe(true);
  });
  it('minus discards all same-color cards when chosen (RD10)', () => {
    const hand = [C({ id: 'm', color: 'red', kind: 'minus', value: null }), C({ id: 'r1', color: 'red', value: 3 }), C({ id: 'b1', color: 'blue', value: 4 })];
    const r = applyMove(mk({}, [hand, [], []]), { type: 'play', playerId: 'p1', cardIds: ['m'], minusDiscard: true });
    expect(r.players[0].hand.map(c => c.id)).toEqual(['b1']); // red cards dumped, blue kept
  });
  it('reverseDraw flips direction and the previous player draws value (RD13)', () => {
    const r = applyMove(mk({}, [[C({ id: 'a', color: 'black', kind: 'reverseDraw', value: 4 }), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'], chosenColor: 'red' });
    expect(r.direction).toBe(-1);
    expect(r.players[2].hand.length).toBe(2 + 4); // p3 (now "previous" after the flip) drew 4
    expect(r.turnIndex).toBe(1);                  // skips the victim -> p2
  });
  it('bomb opens a response phase; accepting draws 4, countering bounces 4 to the bomber (RD12)', () => {
    const s = mk({}, [
      [C({ id: 'a', color: 'black', kind: 'bomb', value: 4 }), C({ id: 'k', value: 3 })],
      [C({ id: 'p2a', value: 1 })],                         // p2 will accept (draw 4)
      [C({ id: 'cn', color: 'black', kind: 'counter', value: null }), C({ id: 'p3a', value: 2 })], // p3 counters
    ]);
    const entered = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'], chosenColor: 'green' });
    expect(entered.phase).toBe('bombResponse');
    expect(entered.bombResponse).toMatchObject({ bomberId: 'p1', pending: ['p2', 'p3'], bomberDraw: 0 });

    const afterP2 = applyMove(entered, { type: 'draw', playerId: 'p2' });   // accept
    expect(afterP2.players[1].hand.length).toBe(1 + 4);
    expect(afterP2.bombResponse!.pending).toEqual(['p3']);

    const done = applyMove(afterP2, { type: 'counter', playerId: 'p3' });   // bounce
    expect(done.phase).toBe('playing');
    expect(done.players[0].hand.length).toBe(1 + 4); // bomber drew 4 (one counter); 'k' remained
    expect(done.players[2].hand.map(c => c.id)).toEqual(['p3a']); // counter consumed, spare card kept
    expect(done.currentColor).toBe('green');
    expect(done.turnIndex).toBe(1); // after bomber p1 -> p2
  });
  it('swap exchanges hands with the target', () => {
    const r = applyMove(mk({}, [[C({ id: 'a', color: 'black', kind: 'swap', value: null }), C({ id: 'k', value: 3 })], [C({ id: 'y', value: 7 })], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'], targetId: 'p2' });
    expect(r.players[0].hand.map(c => c.id)).toEqual(['y']); // p1 took p2's single card
    expect(r.players[1].hand.map(c => c.id)).toEqual(['k']); // p2 took p1's leftover
  });
  it('duel: +4T enters duel; opponent drawing ends it and passes after the challenger', () => {
    const s = mk({}, [[C({ id: 'a', color: 'black', kind: 'duel', value: 4 }), C({ id: 'k', value: 3 })], [], []]);
    const entered = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'], targetId: 'p2', chosenColor: 'blue' });
    expect(entered.phase).toBe('duel');
    expect(entered.duel).toMatchObject({ challengerId: 'p1', opponentId: 'p2', activeId: 'p2' });
    expect(entered.pending!.total).toBe(4);
    const ended = applyMove(entered, { type: 'draw', playerId: 'p2' }); // opponent takes the 4
    expect(ended.phase).toBe('playing');
    expect(ended.duel).toBeNull();
    expect(ended.players[1].hand.length).toBe(2 + 4);
    expect(ended.currentColor).toBe('blue');
    expect(ended.turnIndex).toBe(1); // after challenger p1 (idx 0) -> p2 (idx 1), per RD11
  });
  it('duel: the opponent playing /2 also ends the duel (RD11)', () => {
    const s = mk({}, [[C({ id: 'a', color: 'black', kind: 'duel', value: 4 }), C({ id: 'k', value: 3 })],
      [C({ id: 'v', color: 'black', kind: 'div', value: 2 }), C({ id: 'k2', value: 5 })], []]);
    const entered = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'], targetId: 'p2', chosenColor: 'red' });
    const ended = applyMove(entered, { type: 'play', playerId: 'p2', cardIds: ['v'] }); // /2: draw 2, stack clears
    expect(ended.phase).toBe('playing');
    expect(ended.duel).toBeNull();
    expect(ended.players[1].hand.length).toBe(1 + 2); // 'k2' kept (div played), drew floor(4/2)=2
    expect(ended.turnIndex).toBe(1); // resumes after challenger -> p2
  });
});
```

- [ ] **Step 2: Run - expect FAIL**, then implement.
First, make `advance` duel-aware (replace the `advance` body from Task 7):
```ts
export function advance(s: GameState, steps = 1): void {
  if (s.phase === 'duel' && s.duel) {                       // in a duel, toggle between the two duelists
    s.duel.activeId = s.duel.activeId === s.duel.challengerId ? s.duel.opponentId : s.duel.challengerId;
    s.goAgain = false; return;
  }
  s.turnIndex = nextActiveIndex(s, s.turnIndex, steps);
  s.goAgain = false;
}
```
Then replace the minimal Task 7 bodies of `applyEffect`/`endDuel`/`resolveBombResponse` with (`eliminateIfOverloaded`, `drawCards`, `discardKind`, `advance`, `checkEnd`, `acting` are all already defined in Task 7):
```ts
function endDuel(s: GameState): GameState {
  const challengerIdx = s.players.findIndex(p => p.id === s.duel!.challengerId);
  s.phase = 'playing'; s.duel = null; s.pending = null; s.colorLocked = false;
  s.turnIndex = challengerIdx;
  advance(s, 1);                                            // pass to the player after the challenger
  return checkEnd(s);
}

/** RD12: each hit player responds in seat order; shield/counter bounces 4 to the bomber. */
function resolveBombResponse(s: GameState, move: Move): GameState {
  const br = s.bombResponse!;
  const responder = s.players.find(p => p.id === br.pending[0])!;
  if (move.type === 'shield' || move.type === 'counter') {
    discardKind(s, responder, move.type);                  // consume the held card
    br.bomberDraw += 4;                                     // 4 per responder who bounces
    s.log = `${responder.name} ${move.type === 'shield' ? 'shielded' : 'countered'} the bomb`;
  } else {                                                  // any other move (draw) = accept
    drawCards(s, responder, 4);
    s.log = `${responder.name} took 4 from the bomb`;
  }
  br.pending.shift();
  return br.pending.length > 0 ? s : finishBomb(s);
}

function finishBomb(s: GameState): GameState {
  const br = s.bombResponse!;
  const bomber = s.players.find(p => p.id === br.bomberId)!;
  if (br.bomberDraw > 0) drawCards(s, bomber, br.bomberDraw);
  s.currentColor = br.endColor;
  s.phase = 'playing'; s.bombResponse = null;
  s.turnIndex = s.players.findIndex(p => p.id === br.bomberId);
  advance(s, 1);
  return checkEnd(s);
}

function applyEffect(s: GameState, combo: Combo, move: Extract<Move, { type: 'play' }>): void {
  const actor = s.players.find(p => p.id === move.playerId)!;
  const lead = combo.lead;
  switch (lead.kind) {
    case 'skip': advance(s, 2); break;
    case 'playAgain': s.goAgain = true; break;               // same player continues (no advance)
    case 'minus':
      if (move.minusDiscard) actor.hand = actor.hand.filter(c => c.color !== lead.color);
      advance(s, 1); break;
    case 'reverseDraw': {                                    // RD13: flip + previous player draws
      s.direction = (-s.direction) as 1 | -1;
      const victim = s.players[nextActiveIndex(s, s.turnIndex, 1)];
      drawCards(s, victim, lead.value ?? 0);
      advance(s, 2); break;                                  // skip the victim
    }
    case 'duel':                                             // RD11: enter 1v1; color chosen upfront
      s.phase = 'duel';
      s.pending = { total: 4, topValue: 4, source: 'blackDraw' };
      s.duel = { challengerId: actor.id, opponentId: move.targetId!, activeId: move.targetId! };
      s.currentColor = move.chosenColor ?? s.currentColor;
      break;                                                 // no advance; duel takes over
    case 'bomb': {                                           // RD12: open the sequential response phase
      const order: string[] = [];
      let i = s.players.findIndex(p => p.id === actor.id);
      for (let k = 0; k < s.players.length; k++) {
        i = nextActiveIndex(s, i, 1);
        if (s.players[i].id === actor.id) break;            // looped back to the bomber
        order.push(s.players[i].id);
      }
      const endColor = move.chosenColor ?? s.currentColor;
      if (order.length === 0) { s.currentColor = endColor; advance(s, 1); break; } // no one to hit
      s.phase = 'bombResponse';
      s.bombResponse = { bomberId: actor.id, pending: order, bomberDraw: 0, endColor };
      break;                                                 // no advance; the response phase takes over
    }
    case 'drawUntilColor': {                                 // RD17
      const victim = s.players[nextActiveIndex(s, s.turnIndex, 1)];
      for (let i = 0; i < 200; i++) {
        if (s.drawPile.length === 0) reshuffle(s);
        if (s.drawPile.length === 0) break;
        const c = s.drawPile.pop()!; victim.hand.push(c);
        if (c.color === move.chosenColor) break;
      }
      eliminateIfOverloaded(s, victim);
      s.currentColor = move.chosenColor ?? s.currentColor;
      advance(s, 2); break;                                  // victim skipped
    }
    case 'swap': {
      const t = s.players.find(p => p.id === move.targetId)!;
      [actor.hand, t.hand] = [t.hand, actor.hand];
      advance(s, 1); break;
    }
    case 'steal': {
      const t = s.players.find(p => p.id === move.targetId)!;
      if (t.hand.length) {
        const j = Math.floor(createRng(s.seed + ':' + s.discardPile.length)() * t.hand.length);
        actor.hand.push(t.hand.splice(j, 1)[0]);
        eliminateIfOverloaded(s, actor);
      }
      advance(s, 1); break;
    }
    case 'gift': {
      const t = s.players.find(p => p.id === move.targetId)!;
      const gi = actor.hand.findIndex(c => c.id === move.giftCardId);
      if (gi >= 0) { t.hand.push(actor.hand.splice(gi, 1)[0]); eliminateIfOverloaded(s, t); }
      advance(s, 1); break;
    }
    case 'eye': advance(s, 1); break;                        // reveal is delivered server-side (Task 12)
    case 'wild': advance(s, 1); break;                       // color already set in applyPlay
    case 'recycle': applyRecycle(s, move); break;
    default: advance(s, 1);                                  // number / pair / run / pairsRun
  }
}

/** Copy the effect of the card beneath the recycle just played (RD14). By design this
 *  re-applies the effect directly and skips the copied card's normal play preconditions
 *  (e.g. a recycled bomb does not require a number on top); legality already validated the
 *  recycle's own inputs (targetId/giftCardId/color) in isMoveLegal. */
function applyRecycle(s: GameState, move: Extract<Move, { type: 'play' }>): void {
  const copied = s.discardPile[s.discardPile.length - 2];
  if (isDraw(copied)) {
    s.pending = { total: copied.value ?? 0, topValue: copied.value ?? 0, source: isBlack(copied) ? 'blackDraw' : 'colorDraw' };
    s.currentColor = isBlack(copied) ? (move.chosenColor ?? s.currentColor) : copied.color;
    advance(s, 1); return;
  }
  if (!isBlack(copied)) s.currentColor = copied.color;
  else if (move.chosenColor) s.currentColor = move.chosenColor;
  const synthetic: Combo = { kind: 'single', cards: [copied], lead: copied, finalTop: copied, locksColor: false, isX2: false };
  applyEffect(s, synthetic, move);
}
```
Replace the minimal Task 7 bodies of `applyEffect`/`endDuel`/`resolveBombResponse` with the full versions above. (`isBlack`, `isDraw`, `MAX_HAND`, `nextActiveIndex`, `eliminateIfOverloaded` are already defined/imported at the top of `moves.ts` from Task 7; `discardKind` is defined in Task 7.)

- [ ] **Step 3: Run - expect PASS**
Run: `npx vitest run packages/engine/src/moves.special.test.ts packages/engine/src/moves.core.test.ts`
Expected: PASS.

- [ ] **Step 4: startNextRound (points mode, deferred default)**
Append to `packages/engine/src/state.ts`:
```ts
/** Begin a fresh round, preserving scores and resetting status. Used only in points mode. */
export function startNextRound(prev: GameState): GameState {
  const next = createGame(
    prev.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot })),
    prev.config, prev.seed + ':r' + prev.discardPile.length);
  next.players.forEach((p) => { p.score = prev.players.find(x => x.id === p.id)?.score ?? 0; });
  return next;
}
```
Run: `npx vitest run packages/engine` to confirm the whole engine suite stays green.

### Task 9: Bot move selection + state redaction

**Files:**
- Create: `packages/engine/src/bot.ts`, `packages/engine/src/bot.test.ts`
- Create: `packages/engine/src/view.ts`, `packages/engine/src/view.test.ts`

- [ ] **Step 1: Write failing bot test** (`packages/engine/src/bot.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { botChooseMove } from './bot';
import { isMoveLegal } from './rules';
import { DEFAULT_CONFIG } from './config';
import type { GameState, PlayerState, PendingDraw } from './state';
import type { Card } from './cards';

const C = (over: Partial<Card>): Card => ({ id: 'x', color: 'red', kind: 'number', value: 1, ...over });
function mk(over: Partial<GameState>, hand: Card[]): GameState {
  const players: PlayerState[] = [
    { id: 'b1', name: 'Bot', isBot: true, connected: true, status: 'active', hand, score: 0 },
    { id: 'p2', name: 'Human', isBot: false, connected: true, status: 'active', hand: [C({ id: 'h', value: 1 }), C({ id: 'h2', value: 2 })], score: 0 },
  ];
  return {
    phase: 'playing', config: DEFAULT_CONFIG, players,
    drawPile: [C({ id: 'd', color: 'blue', value: 1 })],
    discardPile: [C({ id: 'top', color: 'red', value: 5 })],
    currentColor: 'red', colorLocked: false, turnIndex: 0, direction: 1,
    pending: null, duel: null, bombResponse: null, goAgain: false, winnerId: null, seed: 's', log: '', ...over,
  };
}

describe('botChooseMove', () => {
  it('plays a legal card when one exists', () => {
    const s = mk({}, [C({ id: 'a', color: 'red', value: 9 }), C({ id: 'k', value: 3 })]);
    const m = botChooseMove(s, 'b1');
    expect(m.type).toBe('play');
    expect(isMoveLegal(s, m).ok).toBe(true);
  });
  it('draws when nothing is playable', () => {
    const s = mk({}, [C({ id: 'a', color: 'blue', value: 9 })]);
    expect(botChooseMove(s, 'b1').type).toBe('draw');
  });
  it('supplies a color for a wild', () => {
    // spare is unplayable (blue on a red top) so the wild is the bot's only playable card.
    const s = mk({}, [C({ id: 'a', color: 'black', kind: 'wild', value: null }), C({ id: 'k', color: 'blue', value: 9 })]);
    const m = botChooseMove(s, 'b1');
    expect(m.type === 'play' && m.chosenColor).toBeTruthy();
  });
  it('supplies a target for a targeted card', () => {
    // spare card is unplayable (blue on a red top) so the swap is the bot's only playable card.
    const s = mk({}, [C({ id: 'a', color: 'black', kind: 'swap', value: null }), C({ id: 'k', color: 'blue', value: 9 })]);
    const m = botChooseMove(s, 'b1');
    expect(m.type === 'play' && m.targetId).toBe('p2');
  });
  it('stacks a big-enough draw against a pending stack, else draws', () => {
    const pending: PendingDraw = { total: 4, topValue: 4, source: 'blackDraw' };
    const withDraw = mk({ pending }, [C({ id: 'd6', color: 'black', kind: 'draw', value: 6 })]);
    const m = botChooseMove(withDraw, 'b1');
    expect(m.type === 'play' && m.cardIds).toEqual(['d6']);
    const noDraw = mk({ pending }, [C({ id: 'n', color: 'green', value: 9 })]);
    expect(botChooseMove(noDraw, 'b1').type).toBe('draw');
  });
});
```

- [ ] **Step 2: Run - expect FAIL**, then implement (`packages/engine/src/bot.ts`):
```ts
import { isBlack, isDraw, type Card, type CardColor } from './cards';
import { getPlayableCards } from './rules';
import { type GameState, type PlayerState } from './state';
import type { Move } from './types';

const NON_WILD: Exclude<CardColor, 'black'>[] = ['red', 'green', 'blue', 'yellow'];
const TARGETED = new Set<Card['kind']>(['duel', 'eye', 'swap', 'steal', 'gift']);
const needsColor = (c: Card) => c.kind === 'wild' || c.kind === 'drawUntilColor' || c.kind === 'duel' || c.kind === 'bomb';

function bestColor(hand: Card[]): CardColor {
  const counts: Record<string, number> = { red: 0, green: 0, blue: 0, yellow: 0 };
  for (const c of hand) if (c.color !== 'black') counts[c.color]++;
  return NON_WILD.slice().sort((a, b) => counts[b] - counts[a])[0] ?? 'red';
}
function weakest(s: GameState, botId: string): PlayerState | undefined {
  return s.players.filter(p => p.id !== botId && p.status === 'active').sort((a, b) => a.hand.length - b.hand.length)[0];
}
const rank = (c: Card) => c.kind === 'number' ? 0 : isBlack(c) ? (c.kind === 'wild' ? 3 : 2) : 1;

export function botChooseMove(state: GameState, botId: string): Move {
  const me = state.players.find(p => p.id === botId)!;

  // Responding to a bomb: bounce it with counter/shield if held, else accept the 4.
  if (state.phase === 'bombResponse') {
    if (me.hand.some(c => c.kind === 'counter')) return { type: 'counter', playerId: botId };
    if (me.hand.some(c => c.kind === 'shield')) return { type: 'shield', playerId: botId };
    return { type: 'draw', playerId: botId };
  }

  // Facing a draw stack: stack a draw (smallest that qualifies), else shield/counter, else draw.
  if (state.pending) {
    const stackable = me.hand.filter(c => isDraw(c) && (c.value ?? 0) >= state.pending!.topValue)
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];
    if (stackable) {
      const m: Extract<Move, { type: 'play' }> = { type: 'play', playerId: botId, cardIds: [stackable.id] };
      if (isBlack(stackable)) m.chosenColor = bestColor(me.hand);
      return m;
    }
    if (me.hand.some(c => c.kind === 'shield')) return { type: 'shield', playerId: botId };
    if (me.hand.some(c => c.kind === 'counter')) return { type: 'counter', playerId: botId };
    const div = me.hand.find(c => c.kind === 'div');
    if (div) return { type: 'play', playerId: botId, cardIds: [div.id] };
    return { type: 'draw', playerId: botId };
  }

  // Normal turn: pick the simplest legal single card. RD19: never go out on a black card
  // (incl. gift, which also sheds the gifted card -> would empty a 2-card hand).
  const playable = getPlayableCards(state, botId)
    .filter(c => !(me.hand.length === 1 && isBlack(c)) && !(c.kind === 'gift' && me.hand.length <= 2)
      && c.kind !== 'mult' && c.kind !== 'div');
  if (playable.length === 0) return { type: 'draw', playerId: botId };
  const card = [...playable].sort((a, b) => rank(a) - rank(b))[0];

  const m: Extract<Move, { type: 'play' }> = { type: 'play', playerId: botId, cardIds: [card.id] };
  if (needsColor(card)) m.chosenColor = bestColor(me.hand);
  if (TARGETED.has(card.kind)) m.targetId = weakest(state, botId)?.id;
  if (card.kind === 'gift') m.giftCardId = me.hand.find(c => c.id !== card.id)?.id;
  if (card.kind === 'minus') m.minusDiscard = true;
  return m;
}
```

- [ ] **Step 3: Run - expect PASS** (bot tests).

- [ ] **Step 4: Write failing redaction test** (`packages/engine/src/view.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { redactFor } from './view';
import { createGame } from './state';
import { DEFAULT_CONFIG } from './config';

describe('redactFor', () => {
  const g = createGame(
    [{ id: 'p1', name: 'A', isBot: false }, { id: 'p2', name: 'B', isBot: false }],
    DEFAULT_CONFIG, 'seed-1');
  it('reveals only the viewer hand; others are counts + status', () => {
    const v = redactFor(g, 'p1');
    expect(v.you?.hand).toHaveLength(7);
    const other = v.players.find(p => p.id === 'p2')!;
    expect(other.handCount).toBe(7);
    expect(other.status).toBe('active');
    expect((other as unknown as Record<string, unknown>).hand).toBeUndefined();
  });
  it('never leaks the draw pile, only its size', () => {
    const v = redactFor(g, 'p1');
    expect(v.drawCount).toBe(g.drawPile.length);
    expect((v as unknown as Record<string, unknown>).drawPile).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run - expect FAIL**, then implement (`packages/engine/src/view.ts`):
```ts
import type { Card, CardColor } from './cards';
import type { GameState, GamePhase, PendingDraw, DuelState, BombResponse } from './state';

export interface PublicPlayer {
  id: string; name: string; isBot: boolean; connected: boolean;
  status: 'active' | 'out'; handCount: number; score: number;
}
export interface PublicView {
  phase: GamePhase;
  players: PublicPlayer[];
  discardTop: Card;
  currentColor: CardColor;
  colorLocked: boolean;
  turnId: string;
  direction: 1 | -1;
  pending: PendingDraw | null;
  duel: DuelState | null;
  bombResponse: BombResponse | null;
  goAgain: boolean;
  drawCount: number;
  winnerId: string | null;
  log: string;
  you: { id: string; hand: Card[] } | null;
}

export function redactFor(state: GameState, viewerId: string | null): PublicView {
  const me = viewerId ? state.players.find(p => p.id === viewerId) ?? null : null;
  const turnId = state.phase === 'bombResponse' && state.bombResponse ? state.bombResponse.pending[0]
    : state.phase === 'duel' && state.duel ? state.duel.activeId
    : state.players[state.turnIndex]?.id ?? '';
  return {
    phase: state.phase,
    players: state.players.map(p => ({
      id: p.id, name: p.name, isBot: p.isBot, connected: p.connected,
      status: p.status, handCount: p.hand.length, score: p.score,
    })),
    discardTop: state.discardPile[state.discardPile.length - 1],
    currentColor: state.currentColor,
    colorLocked: state.colorLocked,
    turnId,
    direction: state.direction,
    pending: state.pending,
    duel: state.duel,
    bombResponse: state.bombResponse,
    goAgain: state.goAgain,
    drawCount: state.drawPile.length,
    winnerId: state.winnerId,
    log: state.log,
    you: me ? { id: me.id, hand: me.hand } : null,
  };
}
```

- [ ] **Step 6: Run - expect PASS**, then full suite.
Run: `npx vitest run packages/engine`
Expected: PASS (all engine suites). Milestone: the full UNO Infinity rule engine is complete and proven.

---

## Phase 2 - Backend authority (Cloud Functions + RTDB rules)

### RTDB data model (reference)

```
/rooms/{roomId}
  /meta        { code, hostId, phase: 'lobby'|'playing'|'duel'|'bombResponse'|'roundEnd'|'gameOver', maxPlayers, createdAt, config, seatCounter }
  /members/{uid} : true                         # membership set (gates room reads)
  /seats/{seatId}  { name, isBot, seatIndex, connected, handCount, status, score, turn }
  /public      { discardTop, currentColor, colorLocked, turnId, direction, pending, duel, bombResponse, goAgain, drawCount, winnerId, log }
  /chat/{pushId} { uid, name, kind: 'text'|'emote', body, ts }
  /presence/{uid} { online, lastSeen }
/hands/{roomId}/{uid}  { cards: Card[] }        # SEPARATE top-level path, readable ONLY by that uid
/peek/{roomId}/{uid}   { targetId, cards, ts }  # Eye reveal: server-written, readable ONLY by that uid
/secure/{roomId}  : full GameState              # read:false write:false (Admin SDK only)
```
Seats for humans use `seatId = uid`; bots use `seatId = bot_<n>`.

> **Why hands are a top-level `/hands/{roomId}/{uid}` and NOT `/rooms/{roomId}/hand/{uid}`:** RTDB `.read` rules cascade - a read granted at `rooms/$roomId` (member-gated) makes the ENTIRE subtree readable, and a child rule cannot revoke it. Nesting hands under the room would expose every player's hand to every member. Keeping hands on a sibling path with its own owner-only `.read` (and no ancestor read grant) is the only way to enforce per-player hand privacy.

### Task 10: RTDB security rules + rules-unit tests

**Files:**
- Modify: `database.rules.json`
- Create: `functions/test/rules.test.ts`, `functions/vitest.config.ts`
- Deps: `@firebase/rules-unit-testing`, `firebase`, and `vitest` are already declared as functions devDependencies in Task 2 Step 1 - just run `npm install` if not yet installed.

- [ ] **Step 1: Write the rules**
Replace `database.rules.json`:
```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": "auth != null && data.child('members').child(auth.uid).exists()",
        "meta":    { ".write": false },
        "seats":   { ".write": false },
        "public":  { ".write": false },
        "members": { ".write": false },
        "presence": {
          "$uid": {
            ".write": "auth != null && auth.uid == $uid",
            ".validate": "newData.hasChildren(['online','lastSeen'])"
          }
        },
        "chat": {
          "$msgId": {
            ".write": "auth != null && !data.exists() && newData.child('uid').val() == auth.uid && root.child('rooms').child($roomId).child('members').child(auth.uid).exists()",
            ".validate": "newData.hasChildren(['uid','name','kind','body','ts']) && newData.child('uid').isString() && newData.child('body').isString() && newData.child('body').val().length <= 280 && newData.child('ts').isNumber() && (newData.child('kind').val() == 'text' || newData.child('kind').val() == 'emote')"
          }
        }
      }
    },
    "hands": {
      "$roomId": {
        "$uid": {
          ".read": "auth != null && auth.uid == $uid",
          ".write": false
        }
      }
    },
    "peek": {
      "$roomId": {
        "$uid": {
          ".read": "auth != null && auth.uid == $uid",
          ".write": "auth != null && auth.uid == $uid"
        }
      }
    },
    "secure": { ".read": false, ".write": false }
  }
}
```
Key properties: only members read a room; `meta/seats/public/members` are server-written (clients cannot forge state); **a hand lives at top-level `/hands/{roomId}/{uid}` (no ancestor read grant) and is readable only by its owner** - this is the only layout that survives RTDB read-cascade; chat is append-only, self-authored, and validated (`kind` constrained, `ts` numeric); `secure` is server-only.

- [ ] **Step 2: Write failing rules test**
Create `functions/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 20000 } });
```
Create `functions/test/rules.test.ts`:
```ts
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, get, set } from 'firebase/database';
import { readFileSync } from 'node:fs';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'uno-arena-test',
    database: { rules: readFileSync('database.rules.json', 'utf8'), host: '127.0.0.1', port: 9000 },
  });
  // Seed a room with two members via the privileged context.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, 'rooms/R1/members/alice'), true);
    await set(ref(db, 'rooms/R1/members/bob'), true);
    await set(ref(db, 'rooms/R1/public'), { turnId: 'alice' });
    await set(ref(db, 'hands/R1/alice'), { cards: [] });
    await set(ref(db, 'hands/R1/bob'), { cards: [] });
  });
});
afterAll(async () => { await env.cleanup(); });

describe('RTDB rules', () => {
  it('a member can read public state', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertSucceeds(get(ref(db, 'rooms/R1/public')));
  });
  it('a non-member cannot read the room', async () => {
    const db = env.authenticatedContext('eve').database();
    await assertFails(get(ref(db, 'rooms/R1/public')));
  });
  it('a player can read their own hand', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertSucceeds(get(ref(db, 'hands/R1/alice')));
  });
  it('a player cannot read another player hand', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertFails(get(ref(db, 'hands/R1/bob')));
  });
  it('a client cannot write public state directly', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertFails(set(ref(db, 'rooms/R1/public/turnId'), 'alice'));
  });
  it('a client cannot write a hand directly', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertFails(set(ref(db, 'hands/R1/alice'), { cards: [{ id: 'x', color: 'red', kind: 'number', value: 1 }] }));
  });
  it('a member can post a chat message authored by themselves', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertSucceeds(set(ref(db, 'rooms/R1/chat/m1'),
      { uid: 'alice', name: 'Alice', kind: 'text', body: 'hi', ts: Date.now() }));
  });
});
```

- [ ] **Step 3: Run - expect FAIL** (rules not yet loaded / mismatched), then iterate until green.
Run: `npx firebase emulators:exec --only database "npx vitest run --root functions test/rules.test.ts"`
Expected: PASS (7 tests). Fix `database.rules.json` until all pass. The "cannot read another player hand" test is the critical hand-privacy assertion - it must pass. (Requires Java for the emulator; use `--root functions` so the test is found.)

### Task 11: Callable functions - room lifecycle

**Files:**
- Create: `functions/src/firebase.ts` (admin init)
- Create: `functions/src/rooms.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Admin init**
Create `functions/src/firebase.ts`:
```ts
import { initializeApp, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
if (getApps().length === 0) initializeApp();
export const db = getDatabase();
```

- [ ] **Step 2: Room lifecycle callables**
Create `functions/src/rooms.ts`:
```ts
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { ruleConfigSchema, mergeConfig, DEFAULT_CONFIG, type RuleConfig } from '@uno/engine';
import { db } from './firebase.js';

function genCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}
function requireAuth(uid?: string): string {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first');
  return uid;
}

/**
 * Atomically claim the next monotonic seat index from meta/seatCounter.
 * Monotonic (never reused after a leave), so seatIndex and bot ids never collide.
 */
async function claimSeatIndex(roomId: string): Promise<number> {
  const res = await db.ref(`rooms/${roomId}/meta/seatCounter`).transaction((c) => ((c as number) ?? 0) + 1);
  return (res.snapshot.val() as number) - 1;
}

export const createRoom = onCall(async (req) => {
  const uid = requireAuth(req.auth?.uid);
  const name = String(req.data?.name ?? 'Player').slice(0, 20);
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
        ? { code, hostId: uid, phase: 'lobby', maxPlayers: config.maxPlayers, createdAt: Date.now(), config, seatCounter: 1 }
        : undefined, // code taken -> abort, try another
    );
    if (res.committed) break;
    code = '';
  }
  if (!code) throw new HttpsError('resource-exhausted', 'Could not allocate a room code');
  const roomId = code;

  await db.ref(`rooms/${roomId}`).update({
    [`members/${uid}`]: true,
    [`seats/${uid}`]: { name, isBot: false, seatIndex: 0, connected: true, handCount: 0, status: 'active', score: 0, turn: false },
  });
  return { roomId, code };
});

export const joinRoom = onCall(async (req) => {
  const uid = requireAuth(req.auth?.uid);
  const code = String(req.data?.code ?? '').toUpperCase();
  const name = String(req.data?.name ?? 'Player').slice(0, 20);
  const roomId = code;
  const metaSnap = await db.ref(`rooms/${roomId}/meta`).get();
  if (!metaSnap.exists()) throw new HttpsError('not-found', 'Room not found');
  const meta = metaSnap.val();
  if (meta.phase !== 'lobby') throw new HttpsError('failed-precondition', 'Game already started');

  const seatsSnap = await db.ref(`rooms/${roomId}/seats`).get();
  const seats = seatsSnap.val() ?? {};
  if (seats[uid]) return { roomId }; // already in
  if (Object.keys(seats).length >= meta.maxPlayers) throw new HttpsError('resource-exhausted', 'Room is full');

  const seatIndex = await claimSeatIndex(roomId);
  await db.ref(`rooms/${roomId}`).update({
    [`members/${uid}`]: true,
    [`seats/${uid}`]: { name, isBot: false, seatIndex, connected: true, handCount: 0, status: 'active', score: 0, turn: false },
  });
  return { roomId };
});

export const addBot = onCall(async (req) => {
  const uid = requireAuth(req.auth?.uid);
  const roomId = String(req.data?.roomId ?? '');
  const metaSnap = await db.ref(`rooms/${roomId}/meta`).get();
  if (!metaSnap.exists()) throw new HttpsError('not-found', 'Room not found');
  if (metaSnap.val().hostId !== uid) throw new HttpsError('permission-denied', 'Only the host may add bots');
  if (metaSnap.val().phase !== 'lobby') throw new HttpsError('failed-precondition', 'Game already started');

  const seats = (await db.ref(`rooms/${roomId}/seats`).get()).val() ?? {};
  if (Object.keys(seats).length >= metaSnap.val().maxPlayers) throw new HttpsError('resource-exhausted', 'Room is full');

  const seatIndex = await claimSeatIndex(roomId);
  const botId = `bot_${seatIndex}`; // seatIndex is monotonic, so the id is unique
  const botNames = ['Aria', 'Rex', 'Mia', 'Leo', 'Zoe', 'Max', 'Ivy', 'Sam'];
  await db.ref(`rooms/${roomId}/seats/${botId}`).set({
    name: `Bot ${botNames[seatIndex % botNames.length]}`, isBot: true, seatIndex,
    connected: true, handCount: 0, status: 'active', score: 0, turn: false,
  });
  return { botId };
});

export const leaveRoom = onCall(async (req) => {
  const uid = requireAuth(req.auth?.uid);
  const roomId = String(req.data?.roomId ?? '');
  await db.ref(`rooms/${roomId}/members/${uid}`).remove();
  await db.ref(`rooms/${roomId}/seats/${uid}`).remove();
  await db.ref(`hands/${roomId}/${uid}`).remove();
  return { ok: true };
});
```

- [ ] **Step 3: Export from index**
Modify `functions/src/index.ts`:
```ts
import { setGlobalOptions } from 'firebase-functions/v2';
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
export { createRoom, joinRoom, addBot, leaveRoom } from './rooms.js';
```

- [ ] **Step 4: Manual integration check (emulator)**
Run: `npm run build -w functions` then `npx firebase emulators:start --only functions,database,auth`.
In the Emulator UI shell or a scratch script, call `createRoom` then `joinRoom`; confirm `/rooms/{code}/seats` shows both seats and a non-owner could not have written them directly (covered by Task 10).
Expected: build succeeds; callables create/join rooms; data shape matches the model above.

### Task 12: Gameplay callables + bot driver + disconnect handling

**Files:**
- Create: `functions/src/serde.ts`, `functions/test/serde.test.ts`
- Create: `functions/src/game.ts`
- Create: `functions/src/bots.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: RTDB <-> engine serialization helpers (pure, unit-testable)**
Create `functions/src/serde.ts` (no firebase-admin import, so it runs under plain Vitest):
```ts
import type { GameState, Card, PlayerState } from '@uno/engine';

/** RTDB stores arrays as keyed objects and drops empty ones. Restore a dense array. */
export function toArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v.filter((x) => x != null) as T[];
  if (v && typeof v === 'object')
    return Object.keys(v as Record<string, T>)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (v as Record<string, T>)[k]);
  return [];
}

/** Re-hydrate a GameState read back from RTDB into proper arrays (players, hands, piles). */
export function normalize(raw: unknown): GameState {
  const s = raw as GameState;
  s.players = toArray<PlayerState>((s as { players: unknown }).players).map((p) => ({
    ...p, hand: toArray<Card>((p as { hand: unknown }).hand),
  }));
  s.drawPile = toArray<Card>((s as { drawPile: unknown }).drawPile);
  s.discardPile = toArray<Card>((s as { discardPile: unknown }).discardPile);
  return s;
}

/** Strip `undefined` (RTDB .set/.transaction reject it). Nulls are preserved. */
export function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
```

- [ ] **Step 2: serde round-trip test (no emulator needed)**
Create `functions/test/serde.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toArray, normalize, sanitize } from '../src/serde.js';
import { createGame, applyMove, DEFAULT_CONFIG, deckTotal } from '@uno/engine';

describe('serde', () => {
  it('toArray restores a keyed-object array in numeric order', () => {
    expect(toArray({ 0: 'a', 1: 'b', 2: 'c' })).toEqual(['a', 'b', 'c']);
    expect(toArray(undefined)).toEqual([]);
    expect(toArray(['x', 'y'])).toEqual(['x', 'y']);
  });
  it('sanitize strips undefined but keeps null', () => {
    expect(sanitize({ a: undefined, b: null, c: 1 })).toEqual({ b: null, c: 1 });
  });
  it('a game survives an RTDB JSON round-trip (object-coerced) and stays playable', () => {
    const g = createGame(
      [{ id: 'p1', name: 'A', isBot: false }, { id: 'p2', name: 'B', isBot: false }],
      DEFAULT_CONFIG, 'seed-x');
    // Simulate RTDB write+read: JSON strips undefined; arrays may come back as objects.
    const roundTripped = JSON.parse(JSON.stringify(sanitize(g)));
    const restored = normalize(roundTripped);
    expect(Array.isArray(restored.players)).toBe(true);
    expect(Array.isArray(restored.drawPile)).toBe(true);
    expect(restored.players[0].hand.length).toBe(7);
    // Conservation holds and the engine can still apply a move.
    const total = restored.drawPile.length + restored.discardPile.length +
      restored.players.reduce((s, p) => s + p.hand.length, 0);
    expect(total).toBe(deckTotal(DEFAULT_CONFIG.deck)); // Infinity deck (172 by default)
    expect(() => applyMove(restored, { type: 'draw', playerId: 'p1' })).not.toThrow();
  });
});
```
Run: `npx vitest run --root functions test/serde.test.ts`
Expected: PASS. (Use `--root functions` so Vitest's `include: test/**` resolves; `-c functions/vitest.config.ts` alone keeps the cwd at the repo root and finds no tests.)

- [ ] **Step 3: Authoritative game writer (transactional)**
Create `functions/src/game.ts`:
```ts
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  createGame, applyMove, isMoveLegal, redactFor, startNextRound, topCard,
  type GameState, type Move,
} from '@uno/engine';
import { db } from './firebase.js';
import { normalize, sanitize } from './serde.js';

// --- Projection to /rooms (redacted, client-readable) -----------------------

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
  const uid = req.auth?.uid;
  const roomId = String(req.data?.roomId ?? '');
  const metaSnap = await db.ref(`rooms/${roomId}/meta`).get();
  if (!metaSnap.exists()) throw new HttpsError('not-found', 'Room not found');
  const meta = metaSnap.val();
  if (meta.hostId !== uid) throw new HttpsError('permission-denied', 'Only the host may start');
  if (meta.phase !== 'lobby') throw new HttpsError('failed-precondition', 'Game already started'); // no re-deal mid-game

  const seats = (await db.ref(`rooms/${roomId}/seats`).get()).val() ?? {};
  const ordered = Object.entries(seats)
    .map(([id, v]) => ({ id, ...(v as { name: string; isBot: boolean; seatIndex: number }) }))
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
  return { ok: true };
});

export const submitMove = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first');
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
  const roomId = String(req.data?.roomId ?? '');
  let reason = 'Round not over';
  const result = await applyAuthoritative(roomId, (state) => {
    if (state.phase !== 'roundEnd') { reason = 'Round not over'; return undefined; }
    return startNextRound(state);
  });
  if (!result) throw new HttpsError('failed-precondition', reason);
  return { ok: true };
});

export { applyAuthoritative, project };
```

- [ ] **Step 4: Bot driver (RTDB trigger) + offline auto-play**
Create `functions/src/bots.ts`:
```ts
import { onValueWritten } from 'firebase-functions/v2/database';
import { botChooseMove, isMoveLegal, applyMove } from '@uno/engine';
import { db } from './firebase.js';
import { applyAuthoritative } from './game.js';

/**
 * Fires whenever the active turn changes. If the player on turn is a bot
 * (or an offline human), the server plays for them after a short delay,
 * through the same transactional path as human moves.
 */
export const driveBots = onValueWritten('rooms/{roomId}/public/turnId', async (event) => {
  const roomId = event.params.roomId;
  const turnId = event.data.after.val() as string | null;
  if (!turnId) return;

  const phase = (await db.ref(`rooms/${roomId}/meta/phase`).get()).val();
  if (!['playing', 'duel', 'bombResponse'].includes(phase)) return; // bots act in duels & bomb responses too

  const seat = (await db.ref(`rooms/${roomId}/seats/${turnId}`).get()).val();
  const presence = (await db.ref(`rooms/${roomId}/presence/${turnId}`).get()).val();
  const isBot = seat?.isBot === true;
  const offlineHuman = !isBot && presence?.online === false; // presence seeded at startGame
  if (!isBot && !offlineHuman) return;

  await new Promise((r) => setTimeout(r, isBot ? 900 : 5000)); // bot pacing / human disconnect grace

  // Transaction guards against the turn having already advanced (e.g. a human
  // reconnected and moved during the delay); the handler aborts in that case.
  await applyAuthoritative(roomId, (state) => {
    const activeId = state.phase === 'bombResponse' && state.bombResponse ? state.bombResponse.pending[0]
      : state.phase === 'duel' && state.duel ? state.duel.activeId
      : state.players[state.turnIndex]?.id;
    if (!['playing', 'duel', 'bombResponse'].includes(state.phase) || activeId !== turnId) return undefined;
    const move = botChooseMove(state, turnId);
    if (!isMoveLegal(state, move).ok) return undefined;
    return applyMove(state, move);
  });
});
```
> Note: each committed bot move rewrites `rooms/{roomId}/public/turnId`, which re-fires `driveBots`, so consecutive bot turns chain automatically until a human is on turn. Offline humans are covered the same way (`botChooseMove` plays their actual hand). Presence is seeded online at `startGame` and flipped to `false` by the client's `onDisconnect` (Task 14), so a dropped player is picked up after the grace period; a reconnecting player who moves first wins the transaction and the bot handler aborts.

- [ ] **Step 5: Export functions**
Modify `functions/src/index.ts`:
```ts
import { setGlobalOptions } from 'firebase-functions/v2';
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
export { createRoom, joinRoom, addBot, leaveRoom } from './rooms.js';
export { startGame, submitMove, nextRound } from './game.js';
export { driveBots } from './bots.js';
```

- [ ] **Step 6: Emulator smoke test**
Run: `npm run build -w functions` then `npx firebase emulators:start --only functions,database,auth`.
Drive: createRoom -> addBot -> startGame; observe `/rooms/{id}/public` updates and that bot turns advance automatically (the `driveBots` trigger fires). Submit an illegal move via `submitMove` and confirm it is rejected with the engine's reason.
Expected: build succeeds; full game loop runs server-side; bots play; illegal moves rejected.

---

## Phase 3 - Frontend (`apps/web`)

> Visual direction is locked by `docs/visual-mockups/uno-multiplayer.html`: dark felt default with a light/dark toggle, classic Uno red/yellow/green/blue. Match its layout for landing, rule builder, lobby, and game table.

### Task 13: Firebase client + auth + nickname + theme

**Files:**
- Create: `apps/web/lib/firebase.ts`, `apps/web/lib/auth.tsx`, `apps/web/lib/functions.ts`
- Create: `apps/web/components/theme-provider.tsx`, `apps/web/components/theme-toggle.tsx`
- Modify: `apps/web/app/layout.tsx`
- Install: `npm i firebase next-themes -w apps/web`

- [ ] **Step 1: Firebase client init (with emulator wiring)**
Create `apps/web/lib/firebase.ts`:
```ts
'use client';
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app: FirebaseApp = getApps()[0] ?? initializeApp(config);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
export const functions = getFunctions(app, 'us-central1');

if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' && !(globalThis as Record<string, unknown>).__emu) {
  (globalThis as Record<string, unknown>).__emu = true;
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(rtdb, '127.0.0.1', 9000);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
```

- [ ] **Step 2: Auth context (anonymous default + Google link + nickname)**
Create `apps/web/lib/auth.tsx`:
```tsx
'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged, signInAnonymously, GoogleAuthProvider, linkWithPopup,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

interface AuthCtx { user: User | null; nickname: string; setNickname: (n: string) => void; linkGoogle: () => Promise<void>; ready: boolean }
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNick] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('nickname') ?? '' : '';
    setNick(stored);
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { await signInAnonymously(auth); return; }
      setUser(u); setReady(true);
    });
    return unsub;
  }, []);

  const setNickname = (n: string) => { setNick(n); localStorage.setItem('nickname', n); };
  const linkGoogle = async () => {
    if (auth.currentUser) await linkWithPopup(auth.currentUser, new GoogleAuthProvider()); // linkWithPopup takes a User, not Auth
  };

  return <Ctx.Provider value={{ user, nickname, setNickname, linkGoogle, ready }}>{children}</Ctx.Provider>;
}
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
};
```

- [ ] **Step 3: Callable helpers**
Create `apps/web/lib/functions.ts`:
```ts
'use client';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { Move, RuleConfig } from '@uno/engine';

export const callCreateRoom = httpsCallable<{ name: string; config: RuleConfig }, { roomId: string; code: string }>(functions, 'createRoom');
export const callJoinRoom   = httpsCallable<{ code: string; name: string }, { roomId: string }>(functions, 'joinRoom');
export const callAddBot     = httpsCallable<{ roomId: string }, { botId: string }>(functions, 'addBot');
export const callLeaveRoom  = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'leaveRoom');
export const callStartGame  = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'startGame');
export const callSubmitMove = httpsCallable<{ roomId: string; move: Move }, { ok: boolean }>(functions, 'submitMove');
export const callNextRound  = httpsCallable<{ roomId: string }, { ok: boolean }>(functions, 'nextRound');
```

- [ ] **Step 4: Theme provider + toggle**
Create `apps/web/components/theme-provider.tsx`:
```tsx
'use client';
import { ThemeProvider as NextThemes } from 'next-themes';
import type { ReactNode } from 'react';
export function ThemeProvider({ children }: { children: ReactNode }) {
  return <NextThemes attribute="class" defaultTheme="dark" enableSystem={false}>{children}</NextThemes>;
}
```
Create `apps/web/components/theme-toggle.tsx`:
```tsx
'use client';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? 'Light' : 'Dark'}
    </Button>
  );
}
```

- [ ] **Step 5: Wrap the app**
Modify `apps/web/app/layout.tsx` to wrap `{children}` with `<ThemeProvider><AuthProvider>...</AuthProvider></ThemeProvider>` and add `<Toaster />` (sonner). Add `suppressHydrationWarning` to `<html>`.
Run: `npm run dev -w apps/web` with `NEXT_PUBLIC_USE_EMULATORS=true` and emulators running; confirm an anonymous user is created (visible in Auth emulator) and theme toggle flips.
Expected: app boots, anonymous auth succeeds, theme persists.

### Task 14: Realtime hooks

**Files:**
- Create: `apps/web/lib/hooks/useRoom.ts`, `useHand.ts`, `usePresence.ts`, `useChat.ts`

- [ ] **Step 1: useRoom (meta + seats + public)**
Create `apps/web/lib/hooks/useRoom.ts`:
```ts
'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { rtdb } from '../firebase';
import type { PublicView } from '@uno/engine';

export interface SeatRow { id: string; name: string; isBot: boolean; seatIndex: number; connected: boolean; handCount: number; status: 'active' | 'out'; score: number; turn: boolean }
export interface RoomMeta { code: string; hostId: string; phase: 'lobby' | 'playing' | 'duel' | 'bombResponse' | 'roundEnd' | 'gameOver'; maxPlayers: number; config: import('@uno/engine').RuleConfig }
export type PublicState = Omit<PublicView, 'players' | 'you'>; // includes pending, duel, colorLocked, goAgain (Infinity)

export function useRoom(roomId: string | null) {
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [pub, setPub] = useState<PublicState | null>(null);

  useEffect(() => {
    if (!roomId) return;
    const u1 = onValue(ref(rtdb, `rooms/${roomId}/meta`), s => setMeta(s.val()));
    const u2 = onValue(ref(rtdb, `rooms/${roomId}/seats`), s => {
      const v = s.val() ?? {};
      setSeats(Object.entries(v).map(([id, r]) => ({ id, ...(r as Omit<SeatRow, 'id'>) })).sort((a, b) => a.seatIndex - b.seatIndex));
    });
    const u3 = onValue(ref(rtdb, `rooms/${roomId}/public`), s => setPub(s.val()));
    return () => { u1(); u2(); u3(); };
  }, [roomId]);

  return { meta, seats, pub };
}
```

- [ ] **Step 2: useHand (private, owner-only path)**
Create `apps/web/lib/hooks/useHand.ts`:
```ts
'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { rtdb } from '../firebase';
import { useAuth } from '../auth';
import type { Card } from '@uno/engine';

export function useHand(roomId: string | null): Card[] {
  const { user } = useAuth();
  const [hand, setHand] = useState<Card[]>([]);
  useEffect(() => {
    if (!roomId || !user) return;
    const u = onValue(ref(rtdb, `hands/${roomId}/${user.uid}`), s => setHand(s.val()?.cards ?? []));
    return () => u();
  }, [roomId, user]);
  return hand;
}
```

- [ ] **Step 3: usePresence (onDisconnect)**
Create `apps/web/lib/hooks/usePresence.ts`:
```ts
'use client';
import { useEffect } from 'react';
import { onDisconnect, ref, set, onValue } from 'firebase/database';
import { rtdb } from '../firebase';
import { useAuth } from '../auth';

export function usePresence(roomId: string | null) {
  const { user } = useAuth();
  useEffect(() => {
    if (!roomId || !user) return;
    const pRef = ref(rtdb, `rooms/${roomId}/presence/${user.uid}`);
    const connRef = ref(rtdb, '.info/connected');
    const u = onValue(connRef, (snap) => {
      if (snap.val() === false) return;
      onDisconnect(pRef).set({ online: false, lastSeen: Date.now() }).then(() => {
        set(pRef, { online: true, lastSeen: Date.now() });
      });
    });
    return () => u();
  }, [roomId, user]);
}
```

- [ ] **Step 4: useChat**
Create `apps/web/lib/hooks/useChat.ts`:
```ts
'use client';
import { useEffect, useState } from 'react';
import { onChildAdded, push, ref, query, limitToLast } from 'firebase/database';
import { rtdb } from '../firebase';
import { useAuth } from '../auth';

export interface ChatMsg { id: string; uid: string; name: string; kind: 'text' | 'emote'; body: string; ts: number }

export function useChat(roomId: string | null, nickname: string) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  useEffect(() => {
    if (!roomId) return;
    setMessages([]);
    const q = query(ref(rtdb, `rooms/${roomId}/chat`), limitToLast(50));
    const u = onChildAdded(q, (s) => setMessages(m => [...m, { id: s.key!, ...(s.val() as Omit<ChatMsg, 'id'>) }]));
    return () => u();
  }, [roomId]);

  const send = (kind: 'text' | 'emote', body: string) => {
    if (!user || !body.trim()) return;
    return push(ref(rtdb, `rooms/${roomId}/chat`), { uid: user.uid, name: nickname || 'Player', kind, body: body.slice(0, 280), ts: Date.now() });
  };
  return { messages, send };
}
```

- [ ] **Step 5: usePeek (Eye reveal)**
Create `apps/web/lib/hooks/usePeek.ts`: subscribe to `peek/{roomId}/{uid}`; when a value appears (server wrote a revealed hand for an Eye), expose `{ targetId, cards }` to show in a transient modal, then `remove()` the node so it fires once.
```ts
'use client';
import { useEffect, useState } from 'react';
import { onValue, ref, remove } from 'firebase/database';
import { rtdb } from '../firebase';
import { useAuth } from '../auth';
import type { Card } from '@uno/engine';

export interface Peek { targetId: string; cards: Card[] }
export function usePeek(roomId: string | null) {
  const { user } = useAuth();
  const [peek, setPeek] = useState<Peek | null>(null);
  useEffect(() => {
    if (!roomId || !user) return;
    const r = ref(rtdb, `peek/${roomId}/${user.uid}`);
    const u = onValue(r, s => { const v = s.val(); if (v) setPeek({ targetId: v.targetId, cards: v.cards ?? [] }); });
    return () => u();
  }, [roomId, user]);
  const dismiss = () => { if (roomId && user) remove(ref(rtdb, `peek/${roomId}/${user.uid}`)); setPeek(null); };
  return { peek, dismiss };
}
```
Run: `npm run dev -w apps/web` and verify hooks compile and subscribe without console errors on a seeded room.
Expected: no runtime/type errors; data flows from emulator.

### Task 15: Marketing / landing pages

**Files:**
- Modify: `apps/web/app/page.tsx` (landing)
- Create: `apps/web/app/how-to-play/page.tsx`, `apps/web/app/rules/page.tsx`, `apps/web/app/about/page.tsx`
- Create: `apps/web/components/marketing/Hero.tsx`, `CardFan.tsx`, `FeatureGrid.tsx`, `SiteHeader.tsx`

- [ ] **Step 1: Site header + landing**
Create `apps/web/components/marketing/SiteHeader.tsx` with brand, nav links (How to Play, House Rules, About), `<ThemeToggle/>`, and a "Sign in with Google" button calling `useAuth().linkGoogle()`.
Create `apps/web/components/marketing/Hero.tsx` mirroring the mockup hero (headline "Play Uno your way.", subcopy, "Create a Room" -> `/play?create=1`, "Join with Code" -> `/play?join=1`) and `CardFan.tsx` (the fanned cards) using Tailwind classes echoing the mockup colors.
Create `FeatureGrid.tsx` with the three feature cards (full rule builder, instant rooms, chat & emotes).
Replace `apps/web/app/page.tsx`:
```tsx
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { Hero } from '@/components/marketing/Hero';
import { FeatureGrid } from '@/components/marketing/FeatureGrid';
export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 pb-24">
      <SiteHeader />
      <Hero />
      <FeatureGrid />
    </main>
  );
}
```

- [ ] **Step 2: Static content pages**
Create `how-to-play`, `rules`, `about` route pages as server components with prose (game overview, how customization works, the available house rules and what each does, project info). Reuse `SiteHeader`.

- [ ] **Step 3: Verify**
Run: `npm run dev -w apps/web`; visit `/`, `/how-to-play`, `/rules`, `/about` in both themes.
Expected: pages render, match the mockup direction, links work.

### Task 16: Create/Join + Config (deck composition) UI

**Files:**
- Create: `apps/web/app/play/page.tsx`
- Create: `apps/web/components/lobby/CreateJoin.tsx`
- Create: `apps/web/components/lobby/DeckConfig.tsx`
- Create: `apps/web/components/lobby/Lobby.tsx`
- Create: `apps/web/lib/config-fields.ts`

- [ ] **Step 1: Declarative config-field metadata (drives the config UI)**
Create `apps/web/lib/config-fields.ts`. Since UNO Infinity is THE ruleset (not a toggle set), the host tunes game settings + per-card deck counts. Each field is a numeric stepper/slider over a dot-path into `RuleConfig` (`deck.*` for counts).
```ts
import type { RuleConfig } from '@uno/engine';

export type FieldType = 'number' | 'enum';
export interface ConfigField {
  path: string; type: FieldType; label: string; help?: string;
  min?: number; max?: number; options?: { value: string; label: string }[];
  group: 'Table' | 'Colored cards' | 'Black draws' | 'Math & defense' | 'Special cards' | 'Targeted cards' | 'Win';
}

export const CONFIG_FIELDS: ConfigField[] = [
  { path: 'maxPlayers', type: 'number', label: 'Max players', min: 2, max: 10, group: 'Table' },
  { path: 'startingHandSize', type: 'number', label: 'Starting hand size', min: 1, max: 15, group: 'Table' },
  { path: 'win.condition', type: 'enum', label: 'Win condition', options: [{ value: 'firstToEmpty', label: 'First to empty' }, { value: 'pointsTarget', label: 'Points target' }], group: 'Win' },
  { path: 'win.pointsTarget', type: 'number', label: 'Points target', min: 50, max: 2000, group: 'Win' },
  // Colored deck counts (per color x4)
  { path: 'deck.numberPerColor', type: 'number', label: 'Numbers (each 0-9, per color)', min: 0, max: 4, group: 'Colored cards' },
  { path: 'deck.colorDraw2PerColor', type: 'number', label: 'Colored +2 (per color)', min: 0, max: 6, group: 'Colored cards' },
  { path: 'deck.colorDraw4PerColor', type: 'number', label: 'Colored +4 (per color)', min: 0, max: 6, group: 'Colored cards' },
  { path: 'deck.playAgainPerColor', type: 'number', label: 'Play-again (per color)', min: 0, max: 6, group: 'Colored cards' },
  { path: 'deck.skipPerColor', type: 'number', label: 'Skip (per color)', min: 0, max: 6, group: 'Colored cards' },
  { path: 'deck.minusPerColor', type: 'number', label: 'Minus (per color)', min: 0, max: 6, group: 'Colored cards' },
  // Black draws (totals)
  { path: 'deck.blackDraw2', type: 'number', label: 'Black +2', min: 0, max: 10, group: 'Black draws' },
  { path: 'deck.blackDraw4', type: 'number', label: 'Black +4', min: 0, max: 10, group: 'Black draws' },
  { path: 'deck.blackDraw6', type: 'number', label: 'Black +6', min: 0, max: 10, group: 'Black draws' },
  { path: 'deck.blackDraw8', type: 'number', label: 'Black +8', min: 0, max: 10, group: 'Black draws' },
  { path: 'deck.blackDraw10', type: 'number', label: 'Black +10', min: 0, max: 10, group: 'Black draws' },
  // Math & defense
  { path: 'deck.mult', type: 'number', label: 'x2', min: 0, max: 10, group: 'Math & defense' },
  { path: 'deck.div', type: 'number', label: '/2', min: 0, max: 10, group: 'Math & defense' },
  { path: 'deck.shield', type: 'number', label: 'Shield', min: 0, max: 10, group: 'Math & defense' },
  { path: 'deck.counter', type: 'number', label: 'Counter', min: 0, max: 10, group: 'Math & defense' },
  // Special
  { path: 'deck.duel', type: 'number', label: 'Duel (+4T)', min: 0, max: 8, group: 'Special cards' },
  { path: 'deck.bomb', type: 'number', label: 'Bomb (++4)', min: 0, max: 8, group: 'Special cards' },
  { path: 'deck.reverseDraw4', type: 'number', label: 'Reverse +4', min: 0, max: 8, group: 'Special cards' },
  { path: 'deck.reverseDraw10', type: 'number', label: 'Reverse +10', min: 0, max: 8, group: 'Special cards' },
  { path: 'deck.recycle', type: 'number', label: 'Recycle', min: 0, max: 10, group: 'Special cards' },
  { path: 'deck.wild', type: 'number', label: 'Wild (color)', min: 0, max: 10, group: 'Special cards' },
  { path: 'deck.drawUntilColor', type: 'number', label: 'Draw-until-color', min: 0, max: 10, group: 'Special cards' },
  // Targeted
  { path: 'deck.eye', type: 'number', label: 'Eye (peek)', min: 0, max: 8, group: 'Targeted cards' },
  { path: 'deck.swap', type: 'number', label: 'Swap hands', min: 0, max: 8, group: 'Targeted cards' },
  { path: 'deck.steal', type: 'number', label: 'Steal', min: 0, max: 8, group: 'Targeted cards' },
  { path: 'deck.gift', type: 'number', label: 'Gift', min: 0, max: 8, group: 'Targeted cards' },
];

export function getPath(cfg: RuleConfig, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], cfg);
}
export function setPath(cfg: RuleConfig, path: string, value: unknown): RuleConfig {
  const keys = path.split('.');
  const clone = structuredClone(cfg);
  let node = clone as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) node = node[keys[i]] as Record<string, unknown>;
  node[keys[keys.length - 1]] = value;
  return clone;
}
```

- [ ] **Step 2: DeckConfig component**
Create `apps/web/components/lobby/DeckConfig.tsx`: offers presets (`DEFAULT_CONFIG`, plus a "Lite" and "Chaos" deck variant), groups `CONFIG_FIELDS` by `group`, renders a stepper/`Select` per field via `getPath`/`setPath`, shows the live `deckTotal(config.deck)` and a warning when `startingHandSize * maxPlayers + 1 > deckTotal`, and validates with `ruleConfigSchema` before enabling "Start". Props: `{ config: RuleConfig; onChange: (c: RuleConfig) => void; disabled?: boolean }`. Immutable updates only.

- [ ] **Step 3: CreateJoin + Lobby**
Create `CreateJoin.tsx`: nickname input (binds `useAuth().setNickname`), "Create Room" (calls `callCreateRoom` with current config, routes to `/play?room=<roomId>`), and "Join" (code input -> `callJoinRoom`).
Create `Lobby.tsx`: uses `useRoom(roomId)`; shows room code (copy link), seat list with host badge / bot tag / empty seats, host-only "Add bot" (`callAddBot`) and "Start Game" (`callStartGame`); when `meta.phase==='playing'` (or `'duel'`) render the game table (Task 17). Wire `usePresence(roomId)` here.
Create `apps/web/app/play/page.tsx`: a client page that reads `?room`/`?create`/`?join` and switches between `CreateJoin` (with embedded `DeckConfig`) and `Lobby`.

- [ ] **Step 4: Loading / error / empty states (required)**
Handle every async boundary explicitly:
  - **Loading:** while `useRoom().meta === null`, render a skeleton (not a blank page).
  - **Join failure:** wrap `callJoinRoom`/`callCreateRoom` in try/catch; map `HttpsError` codes to friendly copy - `not-found` -> "Room not found", `failed-precondition` -> "That game already started", `resource-exhausted` -> "Room is full" - shown inline near the code input, not just a toast.
  - **Empty/invalid route:** `/play` with an unknown `?room` shows the "Room not found" screen with a "Back to home" link.
  - **Disabled Start:** the host's "Start Game" is disabled (with reason tooltip) until `seats.length >= 2`.

- [ ] **Step 5: Accessibility (required)**
  - Config steppers are real `<button>`s with `aria-label` ("increase Black +6 count"); `Select` fields use an associated `<Label htmlFor>`; preset chips are a radio group.
  - All interactive elements reachable by keyboard with visible focus rings (Tailwind `focus-visible:ring`).
  - Color is never the only signal: see Task 17 for the current-color indicator and card labels.

- [ ] **Step 6: Verify end-to-end (emulator)**
Run dev + emulators. Create a room, adjust the deck counts, add a bot, start. Open a second browser profile, join by code. Try joining a bad code and a started game to confirm the error screens.
Expected: config changes persist into `meta.config`; second client sees seats live; host can start; error states render correctly; keyboard navigation works.

### Task 17: Game table UI (UNO Infinity)

**Files:**
- Create: `apps/web/components/game/GameTable.tsx`, `Seat.tsx`, `UnoCard.tsx`, `Hand.tsx`, `CenterPiles.tsx`
- Create: `apps/web/components/game/ColorPicker.tsx`, `TargetPicker.tsx`, `GiftPicker.tsx`, `PeekModal.tsx`, `DuelBanner.tsx`
- Create: `apps/web/lib/sound.ts`

- [ ] **Step 1: Card + sound primitives**
Create `UnoCard.tsx`: renders any Infinity `Card` (number, colored +N/playAgain/skip/minus, and black cards: +N, x2, /2, duel, bomb, reverseDraw, recycle, eye, swap, steal, gift, drawUntilColor, shield, counter, wild) with a short glyph/label per kind. Interactive cards are real `<button>`s with an `aria-label` (e.g. "Black plus six", "x2 multiplier", "Eye - peek a hand") and `focus-visible:ring`; decorative cards are `aria-hidden`. Props `{ card; selected?; playable?; dimmed?; onClick? }`. Never rely on color alone - always show the glyph/number text on the face.
Create `apps/web/lib/sound.ts`: WebAudio helper `play('deal'|'play'|'draw'|'special'|'win')`, mute toggle in `localStorage`, synth blips (no assets).

- [ ] **Step 2: Table composition**
Create `GameTable.tsx`: consumes `useRoom` + `useHand` + `usePeek`; advisory legality via `getPlayableCards` (server re-validates). It is your turn when `pub.turnId === user.uid`. Renders:
  - `Seat.tsx` per opponent: highlight on `seat.turn`; show `handCount`; show an **AUDIENCE** badge when `seat.status==='out'` (RD20); a small "1 card!" warning at one card.
  - `CenterPiles.tsx`: draw pile (count) -> `callSubmitMove({type:'draw'})` when it's your turn (this also resolves a `pub.pending` stack); discard top tinted by `currentColor`; an explicit text badge "Current: <Color>" (color not the only cue); a `pub.colorLocked` indicator; a direction arrow with `aria-label`; and when `pub.pending` is active, show the running total ("Draw 14 incoming").
  - `Hand.tsx`: multi-select capable. Tap cards to build a set; a "Play" button submits `{type:'play', cardIds:[...]}`. The UI assembles combos (a single, a pair, a run, three consecutive pairs, or a draw+x2) and disables Play unless `classifySet` accepts the selection. Unplayable cards are dimmed. RD19: if the selection would empty your hand on a black card, Play is disabled with a tooltip.
  - **Black-card prompts:** if the lead needs a color -> `ColorPicker`; if it is targeted (duel/eye/swap/steal/gift) -> `TargetPicker` (active opponents only); for `gift` also `GiftPicker` (choose the card to give).
  - **Stack response bar** (shown when `pub.pending` and it's your turn): buttons for "Draw N", "Shield" (if you hold one) -> `{type:'shield'}`, "Counter" (if you hold one) -> `{type:'counter'}`, "/2" (if you hold one), plus eligible draw/x2 plays from your hand.
  - **Bomb response bar** (shown when `pub.phase==='bombResponse'` and `pub.turnId === user.uid`, i.e. you are `bombResponse.pending[0]`): buttons "Accept (draw 4)" -> `{type:'draw'}`, "Shield" / "Counter" (if held) -> bounce 4 to the bomber. Show the running `bombResponse.bomberDraw` and the queue of players still to respond; non-responders see a "waiting for responses" state.
  - `DuelBanner.tsx`: when `pub.phase==='duel'`, show "Duel: <challenger> vs <opponent>" and whose turn it is; non-duelists see a spectating state.
  - `PeekModal.tsx`: when `usePeek().peek` is set, show the revealed hand, then `dismiss()`.
There is no UNO call/catch in Infinity (removed). All actions go through `callSubmitMove`; the UI never writes game state. Play sounds on transitions; animate with CSS transitions. While `pub === null`, render a "Dealing..." state.

- [ ] **Step 3: Move submission helper**
Within `GameTable.tsx`, wrap `callSubmitMove` to surface server `HttpsError` reasons via `toast.error(reason)` (sonner), so engine rejections are visible.

- [ ] **Step 4: Verify a full game (emulator)**
Run 1 human + bots start to finish. Confirm: turn highlight follows play; multi-card runs lock color; a draw stack with x2 reaches the right total and /2 / shield / counter resolve it; duel enters/exits correctly; bomb hits all others; targeted cards prompt for a target; Eye opens the peek modal; a player pushed past 30 cards becomes AUDIENCE and is skipped; you cannot play a black card as your last card; winner/last-standing shows.
Expected: a complete, authoritative UNO Infinity game playable against bots.

### Task 18: Chat, emotes, scoreboard / round-end, reconnection UX

**Files:**
- Create: `apps/web/components/game/ChatPanel.tsx`, `EmoteBar.tsx`, `RoundEndDialog.tsx`, `ConnectionBanner.tsx`

- [ ] **Step 1: Chat + emotes**
Create `ChatPanel.tsx` using `useChat`: message list (system vs player styling), text input -> `send('text', ...)`. Create `EmoteBar.tsx` with the emoji set from the mockup -> `send('emote', emoji)`; render emote messages as large transient reactions.

- [ ] **Step 2: Game-over / round-end**
Create `RoundEndDialog.tsx`: shown when `meta.phase==='gameOver'` (or `'roundEnd'` in points mode). Announce the winner from `pub.winnerId` - either the first to empty their hand or the last active player standing (RD18/RD20) - and list final hand counts / scores from `seats` (mark `status==='out'` seats as "out"). On `gameOver`, show "Back to lobby"; in points mode (`roundEnd`), the host gets "Next round" (`callNextRound`).

- [ ] **Step 3: Reconnection UX + audience**
Create `ConnectionBanner.tsx`: subscribe to `.info/connected`; show "Reconnecting..." when offline. On reconnect, hooks resubscribe automatically (anonymous uid persists, so the seat/hand are restored). When the local player's `seat.status==='out'`, show an "You are in the audience" banner (they can still watch + chat). Indicate other offline seats (server/bot is covering per Task 12).

- [ ] **Step 4: Verify**
Run with two clients + a bot. Send chat/emotes both ways. Kill one client mid-turn; confirm the server auto-plays for the offline human after the grace period, then reconnect and confirm the correct hand is restored. Force a player past 30 cards and confirm they drop to the audience and the game continues. Play to a winner and confirm the game-over screen.
Expected: chat/emotes live; disconnect handled; elimination -> audience works; game-over shows.

---

## Phase 4 - Deploy & docs

### Task 19: Deploy configuration + README

**Files:**
- Modify: `apphosting.yaml`, `firebase.json`
- Create: `README.md`, `docs/DEPLOY.md`

- [ ] **Step 1: Confirm functions bundling + App Hosting root**
The esbuild bundling decided in Task 2 Step 1 is what makes Functions deployable from this monorepo - `@uno/engine` and `zod` are inlined into `functions/lib/index.js`, so the deployed function has no workspace symlink or raw-`.ts` runtime dependency. Verify:
  - `functions/package.json` `main` is `lib/index.js` and `build` is the esbuild command (Task 2).
  - `firebase.json` `functions.predeploy` runs `npm --prefix functions run build` (Task 2) so the bundle is fresh on every deploy.
  - App Hosting is configured with the monorepo app root `apps/web` (set during `firebase apphosting:backends:create`).
Sanity check the bundle before deploying: `npm --prefix functions run build` then confirm `functions/lib/index.js` contains the inlined engine (e.g. `grep -c buildDeck functions/lib/index.js` > 0) and imports only `firebase-admin`/`firebase-functions`.

- [ ] **Step 2: Provision + first deploy**
Document in `docs/DEPLOY.md`:
```
# One-time
firebase login
firebase use --add                      # select / create project
firebase apphosting:backends:create     # connect apps/web, set root to apps/web
# The NEXT_PUBLIC_FIREBASE_* values live in apphosting.yaml (publishable web config).
# If you prefer secrets for any of them: firebase apphosting:secrets:set <NAME>

# Each deploy
firebase deploy --only database         # security rules
firebase deploy --only functions        # builds the esbuild bundle (predeploy) then deploys
git push                                 # App Hosting builds apps/web from the connected branch
```
Note: SSR + Functions require the Blaze (pay-as-you-go) plan.

- [ ] **Step 3: README**
Create `README.md`: project summary, architecture diagram (engine / functions / web), local dev quickstart:
```
npm install
npm run test:engine                                   # engine unit tests
npx firebase emulators:start --only functions,database,auth
# new shell:
NEXT_PUBLIC_USE_EMULATORS=true npm run dev -w apps/web
```
plus how deck/config customization works (link to `packages/engine/src/config.ts` + `docs/UNO_infinity_design.md`) and how to add a new card kind (extend `CardKind` + `DeckCounts` + `classifySet`/`isMoveLegal`/`applyEffect` + `CONFIG_FIELDS` + tests).

- [ ] **Step 4: Final verification**
Run: `npm run test:engine` (all green), `npm run build -w apps/web` (production build succeeds), `npm run build -w functions`.
Run rules tests once more: `npx firebase emulators:exec --only database "npx vitest run -c functions/vitest.config.ts"`.
Expected: engine suite green, web + functions build clean, rules tests green. Then perform the staging deploy per `docs/DEPLOY.md` and smoke-test a live game.

---

## Notes for the implementer

- **Engine is the contract.** Functions and UI both import `@uno/engine` *as TypeScript source* (web via `transpilePackages`, functions via esbuild bundling). Never duplicate Uno logic in either. New rules start in the engine with a failing test.
- **Authority boundary.** Clients only ever read `/rooms/...` and call callables. They never write game state. `/secure/{roomId}` is server-only. Treat any client-supplied `Move` as untrusted: `submitMove` enforces `move.playerId === auth.uid` and re-runs `isMoveLegal` inside a transaction.
- **Atomicity.** All authoritative mutations go through `applyAuthoritative`, an RTDB transaction on `/secure/{roomId}`, so concurrent `submitMove`/`driveBots` calls cannot drop or duplicate a move.
- **RTDB shape caveats.** (1) RTDB rejects `undefined`, so `Card.value` is `number | null` (never optional) and every write passes through `sanitize`. (2) RTDB stores arrays as keyed objects and drops empties, so every read passes through `normalize` (`functions/src/serde.ts`) which rebuilds dense arrays for `players`/hands/piles. Card `id`s preserve order.
- **Determinism.** All shuffles flow through the seeded `Rng` so games are reproducible in tests and reshuffles are stable.
- **Region must match.** The Functions region is `us-central1` in both `setGlobalOptions` (Task 12, `functions/src/index.ts`) and the client `getFunctions(app, 'us-central1')` (Task 13, `apps/web/lib/firebase.ts`). If you change it, change both - a mismatch makes every callable 404 silently.
- **Hand privacy.** Hands live at top-level `/hands/{roomId}/{uid}` (owner-only `.read`), NOT under `/rooms` - RTDB read rules cascade, so nesting them under the member-readable room would leak every hand.
- **Eye/steal/swap/gift are server-authoritative.** All randomness (steal pick) and the Eye reveal happen in Cloud Functions; the Eye hand is delivered only via the owner-only `/peek/{roomId}/{uid}` node, never a game-readable path.
- **Out of scope (deferred):** a fully general timed out-of-turn reaction window (the bomb `++4` IS counterable via the sequential `bombResponse` phase per RD12, but other cards have no free-for-all interrupts), points-target multi-round scoring (firstToEmpty single round ships first, per RD18), persistent accounts/profiles beyond optional Google link, public room browser, matchmaking queue, friends, persistent stats/leaderboards, mobile-native apps. The classic UNO ruleset is replaced and not shipped.



