# Deploying Last Card

Requires the Firebase **Blaze** (pay-as-you-go) plan (SSR App Hosting + Cloud Functions).

## One-time setup

```
firebase login
firebase use --add                      # select / create the Firebase project
firebase apphosting:backends:create     # connect the repo; set the app root to the repository root (.)
```

Set the web config. The five `NEXT_PUBLIC_FIREBASE_*` values are publishable web config and live in
`apphosting.yaml` (fill in the real values from the Firebase console). If you prefer secrets for any:

```
firebase apphosting:secrets:set <NAME>
```

## Each deploy

```
firebase deploy --only database         # RTDB security rules (database.rules.json)
firebase deploy --only functions        # predeploy runs `npm --prefix functions run build` (esbuild), then deploys
git push                                 # App Hosting builds the app at the repo root from the connected branch
```

## Why esbuild bundling for functions

`@last-card/engine` is consumed as TypeScript source via an npm-workspace symlink, which does NOT survive
`firebase deploy`'s isolated `npm ci`. esbuild inlines the engine (and `zod`) into a single
self-contained `functions/lib/index.js`, keeping only `firebase-admin`/`firebase-functions` external.
`firebase.json` `functions.predeploy` rebuilds the bundle on every deploy.

Sanity check before deploying:

```
npm --prefix functions run build
grep -c buildDeck functions/lib/index.js   # > 0  => engine is inlined
```

## Notes

- Region is `asia-southeast1` in both `functions/src/firebase.ts` (`setGlobalOptions`) and the client
  (`lib/firebase.ts` `getFunctions(app, 'asia-southeast1')`). Keep them in sync - a mismatch makes every
  callable 404 silently.
- `functions/src/firebase.ts` (not `index.ts`) holds `setGlobalOptions`: the function modules evaluate
  before `index.ts`'s body runs, so the region must be set in the file they all import first.
- The functions runtime is node 22, set consistently across `firebase.json` (`nodejs22`),
  `functions/package.json` (`engines.node: "22"`), and the esbuild build target (`node22`). Keep these
  three aligned if you bump the runtime.
- The RTDB rules tests and emulator smoke tests require **Java** (the Firebase emulators run on a JVM).
