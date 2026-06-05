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
