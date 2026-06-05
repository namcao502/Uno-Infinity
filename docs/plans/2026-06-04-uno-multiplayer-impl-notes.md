# UNO Infinity - Implementation Notes

Running log of deviations, decisions, and tradeoffs during s3-implement of
`docs/plans/2026-06-04-uno-multiplayer.md`. One entry per task.

Environment verified: node v22.17.1, npm 10.9.2, npm registry reachable.

---

## Deploy fix (post-s4, first real `firebase deploy` to project `uno-infinity`)
- **Bug:** `firebase deploy --only functions` failed in Cloud Build with `npm error 404 ... '@uno/engine@*' is not in this registry`. Firebase's Gen2 functions buildpack runs a full `npm install` (including `devDependencies`); `functions/package.json` listed the workspace package `@uno/engine` under devDependencies, which does not exist on the public npm registry.
- **Fix:** removed `"@uno/engine": "*"` from `functions/package.json` devDependencies. The engine is already inlined into `lib/index.js` by the esbuild predeploy, and esbuild resolves `@uno/engine` at build time via the root workspace `node_modules` symlink (it does not need the package.json declaration). Verified: `npm --prefix functions run build` still produces the 567.5kb bundle with the engine inlined (`grep -c buildDeck` = 2), then `firebase deploy --only functions --force` deployed all 8 functions (7 callables + driveBots) to us-central1 successfully. `--force` also set the Artifact Registry cleanup policy.
- **Plan impact:** the plan's `functions/package.json` (Task 2) should drop `@uno/engine` from devDependencies for the same reason. Local typecheck/test/build never caught this because the workspace symlink exists locally; only the isolated Cloud Build surfaced it.
- **Also configured for deploy:** `.firebaserc` default project `uno-arena-dev` -> `uno-infinity`; `apps/web/.env.local` + `apphosting.yaml` filled with the real publishable web config; RTDB rules deployed.

---

## Task 1: Monorepo + Next.js + Tailwind/shadcn scaffold
- **Status:** DONE (structure verified directly; `npm run build -w apps/web` passed). Reviews: scaffold is tool-generated + built clean, accepted on direct inspection rather than separate review subagents.
- **Deviation (IMPORTANT, affects later UI tasks):** create-next-app installed **Next.js 16** + **Tailwind v4**, not the planned Next 15 + Tailwind v3. Consequences:
  - **No `tailwind.config.ts`** — Tailwind v4 is configured in CSS (`@import "tailwindcss"` + `@theme` in `apps/web/app/globals.css`). The plan's Task 1 file list named `tailwind.config.ts`; it does not exist by design. Utility classes still work normally, so Tasks 16/17 UI remain valid, but **dark mode** (next-themes `attribute="class"`, Task 13) needs Tailwind v4's `@custom-variant dark (&:where(.dark, .dark *))` in globals.css rather than a `darkMode: 'class'` config key. Flag this to the Task 13/16/17 implementers.
- **Deviation:** create-next-app flag `--src-dir=false` is now `--no-src-dir`; `--no-turbopack` is honored for dev but the production build still reports Turbopack (cosmetic).
- **Decision:** create-next-app v16 auto-created `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`; left in place (harmless).
- **Note:** `@uno/engine` symlink hoisted to root `node_modules/@uno/engine` (standard workspace behavior); dep listed in `apps/web/package.json`. `index.ts` re-exports files created in Tasks 3-9 (won't typecheck until then — expected).

## Task 2: Firebase config files + emulators
- **Status:** DONE. Config files are verbatim from the plan; created directly (deterministic content) rather than via a subagent. Verified: `npm install` pulled the functions workspace deps; `npm --prefix functions run build` (esbuild) produces a valid `functions/lib/index.js` from the placeholder entry.
- **Deviation:** Step 4 "verify emulators boot" was NOT run — the Firebase emulators require a JVM (Java) and `firebase-tools`, which aren't confirmed in this environment. The emulator config in `firebase.json` is correct as written; emulator-dependent verification (rules tests in Task 10, callable smoke tests in Tasks 11-12) is deferred to whenever firebase-tools+Java are available. Engine tasks (3-9) need none of this.
- **Decision:** Wrote all config files myself instead of dispatching an implementer subagent — they are exact JSON/YAML from the plan with no judgment calls, so a subagent adds cost without value. Engine/logic tasks will use the full implement+review loop.

## Tasks 3-6: Engine — rng, cards, config, state, types, combos, rules
- **Status:** DONE. Implemented by transcribing the plan's (5x-reviewed) verbatim code into `packages/engine/src/*` and verifying with the real Vitest suite (running the tests IS the spec-compliance check, stronger than a subagent re-reading code). Installed `zod` into the engine workspace. Full engine suite so far: **33 tests passing** (rng 2, cards 5, config 5, state 5, combos 6, rules 10).
- **Deviation (test fix, found by running the suite):** two `rules.test.ts` tests in the plan were stale relative to guards added during the s2 rounds and FAILED on first run:
  - "shield/counter need a pending" handed p1 a lone number card and expected `shield` legal — but the shield/counter guard now requires *holding* a shield/counter card. Rewrote the test to hold a shield card + a spare and cover the no-shield / no-pending / ok cases.
  - "targeted cards need a valid active opponent" handed p1 a lone black `swap` and expected the targeted play legal — but RD19 forbids finishing on a black card (it was the last card). Added a spare card so swap isn't the last.
  The **implementation (`rules.ts`) is correct** per the resolved decisions; only the tests were wrong. Fixed in both `packages/engine/src/rules.test.ts` and the plan. (s2 reviews are pre-implementation and never ran the suite, so these slipped through — exactly what s3's run-the-tests step catches.)
- **Decision:** included `startNextRound` in `state.ts` now (the plan appends it in Task 8 Step 4) to avoid a later edit; harmless and self-contained.
- **Note:** `cardOf`/`mk` test helpers and all card literals carry explicit `value` (number|null); engine `tsconfig` is `noEmit` typecheck-only; tests run via `npx vitest run --root packages/engine`.

## Tasks 7-8: Engine — moves.ts (apply engine, draw-stack, duel, bomb, targeted)
- **Status:** DONE. Assembled the FINAL `moves.ts` directly from Task 7 (core) + Task 8 (duel-aware `advance`, full `applyEffect`/`endDuel`/`resolveBombResponse`/`finishBomb`/`applyRecycle`) rather than transcribing the intermediate-then-patch sequence — the plan splits one file across two tasks with "replace minimal bodies" instructions, so building the end state once is cleaner and identical. **All 16 move tests pass first run** (core 8, special 8), covering x2/`/2` math, shield/counter, RD20 elimination, duel enter/draw-end/`/2`-end, and the bomb response phase (accept + counter, 4-per-counter).
- **Decision:** improved the core `shield` test to give p1 an actual `shield` card so it verifies the card is *consumed* (the plan's version handed p1 only a number; `applyMove` doesn't run legality, so it passed without consuming anything). Synced the improvement back into the plan. Engine `applyMove` intentionally does NOT call `isMoveLegal` — legality is the server's gate (`submitMove`); the pure engine assumes validated moves, as designed.
- **Deviation:** none in engine logic — the 5 s2 review rounds caught the bugs pre-implementation, so the transcribed code ran green without changes.

## Task 9: Engine — bot.ts + view.ts (bots + redaction)
- **Status:** DONE. **ENGINE MILESTONE: full suite 56 tests passing across 10 files; `tsc --noEmit` clean.**
- **Deviation (test fixes, found by running suite + typecheck):**
  - bot.test "supplies a color for a wild" and "supplies a target for a targeted card" each gave the bot a *playable number* as the spare. The bot's `rank` heuristic correctly prefers plain numbers over wild/targeted black cards, so it played the number and never set chosenColor/targetId — the assertions failed. Fixed the tests to give an *unplayable* spare (blue 9 on a red top) so the black card is the bot's only playable option. The **bot impl is correct** (preferring numbers is sound strategy).
  - view.test used `(x as Record<string, unknown>)` which `tsc` rejects (TS2352, insufficient overlap). Changed to `as unknown as Record<string, unknown>`. Runtime (vitest/esbuild) didn't catch it because it doesn't typecheck — the `tsc --noEmit` step did. Fixed in file + plan.
- **Note:** engine is consumed as source by web/functions; no build artifact. The whole engine (`packages/engine/src/*`) is done: rng, cards, config, state, types, combos, rules, moves, bot, view + index.

## Tasks 10-11: Backend — security rules, room callables
- **Status:** DONE (typecheck + esbuild bundle verified). **Emulator-dependent verification DEFERRED:** Java is not installed in this environment (firebase-tools 15.14.0 is), so the Firebase emulators cannot run here. Task 10's rules-unit tests (`functions/test/rules.test.ts`) and the Task 11 callable smoke test require the emulator and must be run on a machine with Java (`npx firebase emulators:exec --only database "npx vitest run -c functions/vitest.config.ts"`).
- **Deviation (BLOCKER-class, fixed; latent plan bug):** the plan's `functions/tsconfig.json` used `moduleResolution: NodeNext`, but `tsc --noEmit` then FAILS — NodeNext applies extension-required rules to `@uno/engine`'s Bundler-style source (`./cards` etc.) and reports "no exported member" for every engine export. The esbuild **bundle** was unaffected (engine inlined, 535 kb, deploy-ready), but the `typecheck` script was broken. Changed functions tsconfig to `module: ESNext` + `moduleResolution: Bundler` (functions ARE esbuild-bundled, so Bundler resolution is the correct match). Now `npm --prefix functions run typecheck` exits 0 and the bundle still builds. Synced to the plan (Task 2).
- **Verified:** `npm --prefix functions run build` -> `functions/lib/index.js` 535 kb with the engine inlined (`grep buildDeck` hits); `npm --prefix functions run typecheck` clean. createRoom/joinRoom/addBot/leaveRoom written verbatim from the plan.
- **Note:** `rooms.ts` imports `mergeConfig` which it doesn't use (kept to match the plan; harmless, no `noUnusedLocals`).

## Task 12: Backend — serde, game.ts (transactional callables + eye reveal), bots.ts
- **Status:** DONE (serde test green, functions typecheck clean, esbuild bundle 567 kb). Emulator smoke test (createRoom->addBot->startGame->bot turns) DEFERRED (no Java).
- **Verified:** `npx vitest run --root functions test/serde.test.ts` -> 3 passing (toArray/sanitize + the RTDB JSON round-trip that proves a game survives object-coercion and stays playable). `npm --prefix functions run typecheck` exit 0. `npm --prefix functions run build` -> `lib/index.js` 567 kb, engine inlined.
- **Deviation (test-runner command, fixed in plan):** the plan's functions test commands `npx vitest run -c functions/vitest.config.ts functions/test/serde.test.ts` find NO tests — `-c <config>` keeps the cwd at the repo root, so Vitest's `include: ['test/**']` looks at `./test/**` (repo root), not `functions/test`. Correct invocation is `npx vitest run --root functions test/serde.test.ts`. Fixed both the serde (Task 12) and rules (Task 10) run commands in the plan.
- **Note:** game.ts/bots.ts written verbatim; `applyAuthoritative` transaction, eye-peek reveal, bomb/duel-aware bot driver, presence seeding all present. End-to-end game-loop behavior is only checkable with the emulator (deferred).

## Task 13: Web — firebase client, auth, theme, layout
- **Status:** DONE. Verified with a real `next build` (dummy `NEXT_PUBLIC_*` env so firebase `getDatabase` gets a valid URL): compiles, typechecks, prerenders static pages.
- **Deviation (bug in plan, found by build typecheck):** `auth.tsx` `linkGoogle` called `linkWithPopup(auth, ...)` but Firebase v11 `linkWithPopup` takes a **User**, not the Auth instance (`Type 'Auth' is not assignable to 'User'`). Fixed to `if (auth.currentUser) await linkWithPopup(auth.currentUser, new GoogleAuthProvider())`. Synced to plan.
- **Note:** dark mode needed NO change — shadcn's Tailwind-v4 init already wrote `@custom-variant dark (&:is(.dark *))` + the `.dark` token block in `globals.css`, and next-themes `attribute="class"` toggles `.dark`. My Task 1 concern was unfounded.
- **Build note:** `next build` requires the 5 `NEXT_PUBLIC_FIREBASE_*` vars (firebase initializes at import in the client layout, prerendered at build). Used dummy values for verification; real values go in `.env.local` (local) / `apphosting.yaml` (deploy). bash cwd is now `apps/web` after the build `cd`.

## Task 14: Web — realtime hooks (useRoom/useHand/usePresence/useChat/usePeek)
- **Status:** DONE (transcribed verbatim; type-checked as part of the Phase 3 `next build` once consumed by the UI). No deviations.
- **Decision (process):** Tasks 15-18 (UI components, prose-specified in the plan) are authored DIRECTLY rather than via implementer subagents — I already hold the full context (specs, visual mockup, engine/hook/functions APIs, Next 16 + Tailwind v4 + shadcn constraints), so direct authoring + one `next build` verification is faster than briefing/debugging subagents, and browser behavior can't be verified in this environment anyway. UI is built to "compiles + matches spec/mockup" standard; interactive behavior to be verified locally with emulators.

## Task 15: Web — marketing/landing pages
- **Status:** DONE. `next build` green (7 static routes: /, /about, /how-to-play, /rules + not-found). SiteHeader (client, Google-link button), Hero + CardFan, FeatureGrid, and the three content pages authored to match the mockup (dark felt + Uno colors via Tailwind arbitrary values).
- **Deviation (IMPORTANT for Tasks 16-18):** the installed shadcn is **Base UI**-based (`@base-ui/react/button`), NOT Radix — its `Button` has **no `asChild`** prop. Links-styled-as-buttons must use the exported `buttonVariants(...)` as a `className` on `<Link>` (with `cn()` to merge extra classes), e.g. `<Link className={cn(buttonVariants({ size:'lg' }), 'bg-[#f4c430] ...')}>`. The build typecheck caught the `asChild` misuse. Brand named "UNO INFINITY" (mockup said "UNO ARENA").

## Tasks 16-18: Web — lobby/deck-config UI + game table + chat/endgame
- **Status:** DONE. Full `next build` green (8 routes incl. /play). All UI compiles + typechecks. Interactive/browser behavior to be verified locally with emulators.
- **Decisions/Deviations (UI authoring):**
  - **`config-fields.ts`** transcribed verbatim. **DeckConfig** uses steppers (Base UI `Button` with `aria-label`) + a native `<select>` for the enum (avoids Base UI Select API friction); presets Default/Lite/Chaos via `setPath`.
  - **`/play` Suspense split:** `useSearchParams` requires a Suspense boundary in Next 16, so `app/play/page.tsx` (server) wraps a new client `components/lobby/PlayClient.tsx` that routes to `CreateJoin` or `Lobby`. (Plan said "play/page.tsx is the client page"; the Suspense rule forced the split.)
  - **Client-side advisory legality** uses the engine's exported pure `isPlayable(card, top, currentColor, colorLocked)` + `classifySet` (they need only public state + your hand) - the plan's "getPlayableCards" needs full GameState which the client lacks, so I used the lower-level pure fns instead.
  - **Game table consolidation:** `GameTable.tsx` inlines Seat/CenterPiles/Hand/ColorPicker/TargetPicker/GiftPicker/PeekModal/DuelBanner (plan listed them as separate files) for cohesion; kept `UnoCard`, `ChatPanel`, `ConnectionBanner`, `RoundEndDialog` as separate files. Overlays use a plain fixed div, not shadcn Dialog (Base UI Dialog API friction). `RoundEndDialog` covers gameOver + points-mode roundEnd.
  - **Lobby "room not found":** since `useRoom` can't distinguish "loading" from "absent", Lobby shows a 4s loading state then a "Room not found / Back to home" fallback.
  - Multi-card play supported via tap-to-select + "Play selected" (validated client-side by `classifySet`); response/bomb bars and targeting/color/gift overlays wired to `callSubmitMove`.
- **Build note:** `next build` needs the 5 dummy `NEXT_PUBLIC_FIREBASE_*` env vars (firebase inits at import). No `tailwind.config.ts` (v4); dark mode via shadcn's `@custom-variant` + next-themes.

## Task 19: Deploy config + README + final verification
- **Status:** DONE. `README.md` + `docs/DEPLOY.md` written; `firebase.json` predeploy + `apphosting.yaml` + functions esbuild bundling confirmed from Task 2.
- **Final verification (all green where runnable):** engine `npm run test:engine` -> 56/56; `npm --prefix functions run typecheck` clean; `npm --prefix functions run build` -> `lib/index.js` with engine inlined (`grep -c buildDeck` = 2); `npx vitest run --root functions test/serde.test.ts` -> 3/3; `next build` -> 8 routes compiled + typechecked.

---

## IMPLEMENTATION COMPLETE - summary of what is verified vs deferred

**Verified in this environment (objective):**
- Engine: 56 unit tests + typecheck (the entire rule system - draw stacks, x2/÷2, duel, bomb-response, RD19/RD20, combos, bots, redaction).
- Functions: typecheck clean + esbuild bundle (engine inlined) + serde round-trip test.
- Web: full production `next build` (typecheck + compile + prerender of all 8 routes).

**DEFERRED - require tools not in this environment (run locally):**
- **Java / Firebase emulators** (not installed here): Task 10 RTDB rules-unit tests, and the callable/bot-driver/game-loop emulator smoke tests (Tasks 11-12, 16-18). Commands are in README/DEPLOY. The hand-privacy rules test is the critical one to run.
- **Browser**: interactive behavior of the lobby + game table (clicking cards, pickers, duel/bomb flow, chat, reconnection) - build-verified only, not click-tested.
- **Live deploy**: `firebase deploy` (needs a Blaze project).

**Cross-cutting deviations from the plan (all synced back into the plan + noted above):**
1. Next.js 16 + Tailwind v4 (not 15/v3); no `tailwind.config.ts`; shadcn is Base UI-based (no `asChild` -> use `buttonVariants`).
2. functions `tsconfig` switched NodeNext -> Bundler (NodeNext can't typecheck the Bundler-style engine source).
3. `linkWithPopup(auth.currentUser, ...)` (plan passed `auth`).
4. several plan test literals were stale vs late-added guards (shield-holds-card, RD19-last-card, bot prefers numbers, view.test cast) - fixed.
5. UI: `/play` Suspense split (PlayClient), client legality via pure `isPlayable`/`classifySet`, game subcomponents consolidated into `GameTable`, native `<select>` + plain overlays instead of shadcn Select/Dialog.

