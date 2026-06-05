# Deploying UNO Infinity

Requires the Firebase **Blaze** (pay-as-you-go) plan (SSR App Hosting + Cloud Functions).

## One-time setup

```
firebase login
firebase use --add                      # select / create the Firebase project
firebase apphosting:backends:create     # connect apps/web; set the app root to apps/web
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
git push                                 # App Hosting builds apps/web from the connected branch
```

## Why esbuild bundling for functions

`@uno/engine` is consumed as TypeScript source via an npm-workspace symlink, which does NOT survive
`firebase deploy`'s isolated `npm ci`. esbuild inlines the engine (and `zod`) into a single
self-contained `functions/lib/index.js`, keeping only `firebase-admin`/`firebase-functions` external.
`firebase.json` `functions.predeploy` rebuilds the bundle on every deploy.

Sanity check before deploying:

```
npm --prefix functions run build
grep -c buildDeck functions/lib/index.js   # > 0  => engine is inlined
```

## Notes

- Region is `us-central1` in both `functions/src/index.ts` (`setGlobalOptions`) and the client
  (`apps/web/lib/firebase.ts` `getFunctions(app, 'us-central1')`). Keep them in sync.
- The RTDB rules tests and emulator smoke tests require **Java** (the Firebase emulators run on a JVM).
